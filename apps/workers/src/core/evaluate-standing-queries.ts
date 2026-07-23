import { logger } from "../lib/job-logger";
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
import { PLAN_LIMITS, hashSignalIdSet } from "@outrival/shared";
import { loggedAi } from "../lib/analytics";
import { decideDispatch } from "../lib/notification-dispatcher";
import { evaluateFreshAnswer, matchesStandingQuery } from "../lib/standing-queries";
import { getResend, ALERT_FROM } from "../lib/resend";
import { emailShell, e } from "../lib/email-shell";
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
      const html = emailShell(
        `<p ${e("muted", "font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px;")}>Watched question update</p>
  <h2 ${e("text", "margin:0 0 12px;")}>${escapeHtml(query.question)}</h2>
  ${changeSummary ? `<p ${e("muted", "margin:0 0 16px;")}>${escapeHtml(changeSummary)}</p>` : ""}
  <a href="${WEB_URL}/dashboard/ask" ${e("accent")}>See the updated answer →</a>`,
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

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/evaluate-standing-queries.job.ts (deleted at the
// cutover). Only the header and the signature change.
export async function runEvaluateStandingQueries(payload: z.input<typeof InputSchema>) {
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

        const { outcome, freshSignalIds } = await evaluateFreshAnswer(query, fresh, {
          judge: (judgeInput) =>
            loggedAi(
              "standing_query_judge",
              AI_CONFIG.classificationFast,
              () => judgeStandingQuery(judgeInput),
              { competitorId: input.competitorId },
            ),
          fetchInsights,
        });

        switch (outcome.action) {
          case "no_change":
            await db
              .update(standingQueries)
              .set({ lastEvaluatedAt: new Date(), pendingCount: 0, updatedAt: new Date() })
              .where(eq(standingQueries.id, query.id));
            break;
          case "judge_unavailable":
            await db
              .update(standingQueries)
              .set({ lastEvaluatedAt: new Date(), updatedAt: new Date() })
              .where(eq(standingQueries.id, query.id));
            break;
          case "pending":
            await db
              .update(standingQueries)
              .set({
                lastEvaluatedAt: new Date(),
                pendingCount: outcome.pendingCount,
                updatedAt: new Date(),
              })
              .where(eq(standingQueries.id, query.id));
            break;
          case "alert":
            // Confirmed material change: promote the fresh answer to baseline, alert.
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
                lastChangeSummary: outcome.changeSummary || null,
                updatedAt: new Date(),
              })
              .where(eq(standingQueries.id, query.id));
            await alertStandingQuery(query, outcome.changeSummary, input);
            alerted++;
            logger.log("Standing query alerted", { queryId: query.id });
            break;
        }
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
}
