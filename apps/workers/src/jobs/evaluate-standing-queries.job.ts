import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  standingQueries,
  signals,
  organizations,
  notifications,
  type StandingQuery,
} from "@outrival/db";
import { judgeStandingQuery, AI_CONFIG } from "@outrival/ai";
import {
  PLAN_LIMITS,
  hashSignalIdSet,
  normalizeSignalIdSet,
  signalSetsEqual,
} from "@outrival/shared";
import { loggedAi } from "../lib/analytics";
import { groqQueue } from "../lib/queues";
import { decideDispatch } from "../lib/notification-dispatcher";
import { matchesStandingQuery, nextHysteresisState } from "../lib/standing-queries";
import { getResend, ALERT_FROM } from "../lib/resend";
import { darkEmailShell } from "../lib/email-shell";
import { escapeHtml } from "../lib/escape-html";

// Standing-query re-evaluation (docs/ask-outrival.md). Event-triggered from
// generate-signal (never a blind cron): a new signal re-evaluates ONLY the active
// queries whose watched competitors/categories it touches, above their severity
// floor and outside their cooldown. Each re-evaluation re-runs the question through
// the SAME Ask pipeline via the API's internal endpoint (workers can't import the
// API-private tool registry), then compares the SETS of cited signal ids — never
// the answer text. A different set is arbitrated by the fast-tier judge, and an
// alert fires only when the material change persists 2 evaluations (hysteresis).

const WEB_URL = process.env.WEB_URL ?? "https://outrival.app";

const InputSchema = z.object({
  orgId: z.string(),
  competitorId: z.string(),
  category: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  signalId: z.string(),
});

interface AskRunResult {
  answer: string;
  citations: Array<{ type: "competitor" | "signal"; id: string; label: string }>;
}

// Re-run the question through the API's internal Ask endpoint. Null = the run
// failed or wasn't grounded — the caller leaves the query's state untouched.
async function rerunAsk(query: StandingQuery): Promise<AskRunResult | null> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? process.env.BETTER_AUTH_URL ?? "";
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  if (!apiBase || !secret) {
    logger.warn("Standing-query re-eval skipped: INTERNAL_API_SECRET or API url unset");
    return null;
  }
  const res = await fetch(`${apiBase}/api/internal/ask/run`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify({
      orgId: query.orgId,
      userId: query.userId,
      question: query.question,
      context: query.context ?? null,
    }),
    // Two pool AI calls behind this — give it room without hanging the job.
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    logger.warn("Internal ask run failed", { status: res.status, queryId: query.id });
    return null;
  }
  const body = (await res.json()) as Partial<AskRunResult>;
  if (typeof body.answer !== "string" || !Array.isArray(body.citations)) return null;
  return { answer: body.answer, citations: body.citations };
}

async function fetchInsights(orgId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.query.signals.findMany({
    where: and(inArray(signals.id, ids.slice(0, 10)), eq(signals.orgId, orgId)),
    columns: { insight: true },
  });
  return rows.map((r) => r.insight);
}

async function alertStandingQuery(
  query: StandingQuery,
  changeSummary: string,
  trigger: z.infer<typeof InputSchema>,
): Promise<void> {
  const decision = await decideDispatch(query.orgId, {
    severity: trigger.severity,
    competitorId: trigger.competitorId,
    category: trigger.category,
  });

  // In-app notification always (unless the org muted this severity outright).
  if (decision.channel !== "muted") {
    await db.insert(notifications).values({
      orgId: query.orgId,
      type: "standing_query",
      title: "A question you watch has a new answer",
      body: changeSummary || query.question,
      linkUrl: "/dashboard/ask",
    });
  }

  // Immediate email mirrors the send-alert entitlement: realtime-alert plans only,
  // best-effort — the in-app notification already carries the change.
  if (decision.send && decision.channel === "email_immediate") {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, query.orgId),
      columns: { plan: true, alertsEnabled: true, digestEmail: true },
    });
    if (!org?.alertsEnabled || !org.digestEmail) return;
    if (!PLAN_LIMITS[org.plan].features.realtimeAlerts) return;
    try {
      const html = darkEmailShell(
        `<p style="font-size: 12px; color: #a3a3a3; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px;">Watched question update</p>
  <h2 style="margin: 0 0 12px; font-family: Syne, sans-serif; color: #fafafa;">${escapeHtml(query.question)}</h2>
  ${changeSummary ? `<p style="color: #d4d4d4; margin: 0 0 16px;">${escapeHtml(changeSummary)}</p>` : ""}
  <a href="${WEB_URL}/dashboard/ask" style="color: #818cf8;">See the updated answer →</a>`,
      );
      await getResend().emails.send({
        from: ALERT_FROM,
        to: org.digestEmail,
        subject: "A question you watch has a new answer",
        html,
      });
    } catch (err) {
      logger.warn("Standing-query alert email failed (non-fatal)", { error: String(err) });
    }
  }
}

export const evaluateStandingQueriesJob = task({
  id: "evaluate-standing-queries",
  // The judge shares the free-tier AI lane; the internal ask run also lands on the
  // pool. Serializing keeps classify→signal from being starved.
  queue: groqQueue,
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting evaluate-standing-queries", { ...input });

    const candidates = await db.query.standingQueries.findMany({
      where: and(
        eq(standingQueries.orgId, input.orgId),
        eq(standingQueries.isActive, true),
      ),
    });
    const matched = candidates.filter((q) =>
      matchesStandingQuery(
        {
          competitorId: input.competitorId,
          category: input.category,
          severity: input.severity,
        },
        q,
      ),
    );
    if (matched.length === 0) {
      logger.log("No standing query matched", { orgId: input.orgId });
      return { evaluated: 0, alerted: 0 };
    }

    let evaluated = 0;
    let alerted = 0;
    for (const query of matched) {
      try {
        const fresh = await rerunAsk(query);
        if (!fresh) continue; // transient failure — leave the query untouched

        evaluated++;
        const freshSignalIds = normalizeSignalIdSet(
          fresh.citations.filter((c) => c.type === "signal").map((c) => c.id),
        );

        // Same cited-signal set → same substance by construction. A reformulated
        // answer can NEVER alert. Also disarms a previously armed counter (the
        // change didn't persist).
        if (signalSetsEqual(query.currentSignalIds, freshSignalIds)) {
          await db
            .update(standingQueries)
            .set({ lastEvaluatedAt: new Date(), pendingCount: 0, updatedAt: new Date() })
            .where(eq(standingQueries.id, query.id));
          continue;
        }

        // Different sets: the fast judge decides whether the substance moved or the
        // synthesis just rotated its evidence.
        const currentSet = new Set(query.currentSignalIds);
        const freshSet = new Set(freshSignalIds);
        const addedSignals = await fetchInsights(
          query.orgId,
          freshSignalIds.filter((id) => !currentSet.has(id)),
        );
        const removedSignals = await fetchInsights(
          query.orgId,
          query.currentSignalIds.filter((id) => !freshSet.has(id)),
        );
        const judgement = await loggedAi(
          "standing_query_judge",
          AI_CONFIG.classificationFast,
          () =>
            judgeStandingQuery({
              question: query.question,
              baselineAnswer: query.currentAnswer,
              freshAnswer: fresh.answer,
              addedSignals,
              removedSignals,
            }),
          { competitorId: input.competitorId },
        ).catch((err) => {
          logger.warn("Standing-query judge failed (non-fatal)", { error: String(err) });
          return null;
        });
        if (!judgement) {
          // Judge unavailable: stamp the evaluation but keep the hysteresis state —
          // a transient AI failure must neither reset nor advance the counter.
          await db
            .update(standingQueries)
            .set({ lastEvaluatedAt: new Date(), updatedAt: new Date() })
            .where(eq(standingQueries.id, query.id));
          continue;
        }

        const { pendingCount, alert } = nextHysteresisState(
          query.pendingCount,
          judgement.materiallyChanged,
        );

        if (!alert) {
          await db
            .update(standingQueries)
            .set({ lastEvaluatedAt: new Date(), pendingCount, updatedAt: new Date() })
            .where(eq(standingQueries.id, query.id));
          continue;
        }

        // Confirmed material change: promote the fresh answer to baseline and alert.
        await db
          .update(standingQueries)
          .set({
            currentAnswer: fresh.answer,
            currentCitations: fresh.citations,
            currentSignalIds: freshSignalIds,
            currentHash: hashSignalIdSet(freshSignalIds),
            pendingCount: 0,
            lastEvaluatedAt: new Date(),
            lastAlertedAt: new Date(),
            lastChangeSummary: judgement.changeSummary || null,
            updatedAt: new Date(),
          })
          .where(eq(standingQueries.id, query.id));
        await alertStandingQuery(query, judgement.changeSummary, input);
        alerted++;
        logger.log("Standing query alerted", { queryId: query.id });
      } catch (err) {
        // One query's failure never blocks the others; the cooldown makes a
        // Trigger retry of this job cheap for already-evaluated queries.
        logger.warn("Standing-query evaluation failed (non-fatal)", {
          queryId: query.id,
          error: String(err),
        });
      }
    }

    logger.log("Completed evaluate-standing-queries", {
      matched: matched.length,
      evaluated,
      alerted,
    });
    return { evaluated, alerted };
  },
});
