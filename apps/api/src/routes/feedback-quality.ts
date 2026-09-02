import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  qualityFeedback,
  signals,
  battleCards,
  competitorCandidates,
  users,
} from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { captureServerEvent } from "../lib/posthog";
import { errorBody } from "../lib/errors";

// Quality feedback on AI outputs (patch-21). Inline 1-click verdict on the six
// AI output points; the reason is always optional. A "not_useful" verdict fires
// an immediate, user-visible action; deleting the feedback reverts it.

type Variables = { user: { id: string } };

export const feedbackQualityRouter = new Hono<{ Variables: Variables }>();

feedbackQualityRouter.use("*", authMiddleware);

const targetTypes = [
  "signal",
  "discovery_suggestion",
  "battle_card",
  "digest",
  "severity_classification",
  "nps",
] as const;

const reasons = [
  "irrelevant",
  "incorrect",
  "trivial",
  "too_high_severity",
  "too_low_severity",
  "duplicate",
  "outdated",
  "other",
] as const;

const feedbackInputSchema = z.object({
  targetType: z.enum(targetTypes),
  targetId: z.string().min(1),
  verdict: z.enum(["useful", "not_useful", "neutral"]),
  reason: z.enum(reasons).optional(),
  freeText: z.string().max(1000).optional(),
  npsScore: z.number().int().min(0).max(10).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type FeedbackInput = z.infer<typeof feedbackInputSchema>;

interface ImmediateAction {
  type: string;
  description: string;
}

// Fires the visible side-effect of a "not_useful" verdict, over a SET of targets:
// the feed dismisses a whole selection at once, and one statement per row meant one
// request per row from the browser (`code:PER-40`). The single-verdict route calls it
// with a one-element list, so there is one code path either way. Every mutation is
// scoped to the user's org so feedback can never touch another workspace's data.
async function triggerImmediateAction(
  input: Omit<FeedbackInput, "targetId"> & { targetIds: string[] },
  ctx: { userId: string; orgId: string },
): Promise<ImmediateAction | null> {
  if (input.verdict !== "not_useful" || input.targetIds.length === 0) return null;

  switch (input.targetType) {
    case "signal": {
      await db
        .update(signals)
        .set({ hiddenForUserAt: new Date() })
        .where(and(inArray(signals.id, input.targetIds), eq(signals.orgId, ctx.orgId)));
      return {
        type: "signal_hidden",
        description: "This signal has been hidden from your feed.",
      };
    }

    case "discovery_suggestion": {
      await db
        .update(competitorCandidates)
        .set({ status: "dismissed" })
        .where(
          and(
            inArray(competitorCandidates.id, input.targetIds),
            eq(competitorCandidates.orgId, ctx.orgId),
          ),
        );
      return {
        type: "suggestion_rejected",
        description: "This competitor won't be suggested to you again.",
      };
    }

    case "battle_card": {
      await db
        .update(battleCards)
        .set({ flaggedForRegenerationAt: new Date() })
        .where(
          and(inArray(battleCards.id, input.targetIds), eq(battleCards.orgId, ctx.orgId)),
        );
      return {
        type: "battle_card_flagged",
        description: "This battle card is flagged for regeneration.",
      };
    }

    case "severity_classification": {
      const targetSeverity =
        input.reason === "too_high_severity"
          ? "low"
          : input.reason === "too_low_severity"
            ? "high"
            : null;
      if (targetSeverity) {
        await db
          .update(signals)
          .set({ severityOverride: targetSeverity, severityOverriddenBy: ctx.userId })
          .where(and(inArray(signals.id, input.targetIds), eq(signals.orgId, ctx.orgId)));
        return { type: "severity_adjusted", description: "The severity has been adjusted." };
      }
      return null;
    }

    case "digest":
    case "nps":
      return null;
  }
}

// Undoes the immediate action when a user cancels their feedback, so the UI stays
// coherent ("not useful" hid it → deleting un-hides it). Org-scoped like above.
async function revertImmediateAction(
  row: { targetType: string; targetIds: string[]; verdict: string },
  orgId: string,
): Promise<void> {
  if (row.verdict !== "not_useful" || row.targetIds.length === 0) return;

  switch (row.targetType) {
    case "signal":
      await db
        .update(signals)
        .set({ hiddenForUserAt: null })
        .where(and(inArray(signals.id, row.targetIds), eq(signals.orgId, orgId)));
      return;
    case "discovery_suggestion":
      await db
        .update(competitorCandidates)
        .set({ status: "new" })
        .where(
          and(
            inArray(competitorCandidates.id, row.targetIds),
            eq(competitorCandidates.orgId, orgId),
          ),
        );
      return;
    case "battle_card":
      await db
        .update(battleCards)
        .set({ flaggedForRegenerationAt: null })
        .where(and(inArray(battleCards.id, row.targetIds), eq(battleCards.orgId, orgId)));
      return;
    case "severity_classification":
      await db
        .update(signals)
        .set({ severityOverride: null, severityOverriddenBy: null })
        .where(and(inArray(signals.id, row.targetIds), eq(signals.orgId, orgId)));
      return;
    default:
      return;
  }
}

// POST /api/feedback-quality — upsert the verdict + fire the immediate action.
feedbackQualityRouter.post("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = feedbackInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      errorBody("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input"),
      400,
    );
  }
  const data = parsed.data;

  // Upsert on (user, targetType, targetId): a second verdict on the same target
  // replaces the first so the user can change their mind. One statement, onto the
  // unique index that now backs that triple — the read-then-branch it replaces let
  // a double-click see "no row" twice and insert twice, and every reader
  // downstream counts rows without deduping (`code:COR-15`).
  const [row] = await db
    .insert(qualityFeedback)
    .values({
      userId: user.id,
      orgId,
      targetType: data.targetType,
      targetId: data.targetId,
      verdict: data.verdict,
      reason: data.reason ?? null,
      npsScore: data.npsScore ?? null,
      freeText: data.freeText ?? null,
      metadata: data.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: [
        qualityFeedback.userId,
        qualityFeedback.targetType,
        qualityFeedback.targetId,
      ],
      // orgId stays as first written: the pair is scoped by user, and a user
      // cannot move org without the row being cascaded away with them.
      set: {
        verdict: data.verdict,
        reason: data.reason ?? null,
        npsScore: data.npsScore ?? null,
        freeText: data.freeText ?? null,
        metadata: data.metadata ?? null,
        createdAt: new Date(),
      },
    })
    .returning({ id: qualityFeedback.id });
  const feedbackId = row!.id;

  const immediateAction = await triggerImmediateAction(
    { ...data, targetIds: [data.targetId] },
    { userId: user.id, orgId },
  );

  // PostHog server capture is a no-op when the key is absent (consent gating lives
  // in the web client; the server only records when configured).
  await captureServerEvent(user.id, "quality_feedback_given", {
    target_type: data.targetType,
    verdict: data.verdict,
    reason: data.reason,
  });

  return c.json({ ok: true, feedbackId, immediateAction });
});

// POST /api/feedback-quality/bulk — the same verdict on many targets at once.
// The signals feed dismisses a shift-selected range, and it did so by firing one POST
// per row plus one DELETE per row on Undo (`code:PER-40`). One upsert and one
// side-effect statement instead; the returned ids are what the Undo sends back.
const bulkFeedbackSchema = feedbackInputSchema
  .omit({ targetId: true, npsScore: true })
  .extend({ targetIds: z.array(z.string().min(1)).min(1).max(500) });

feedbackQualityRouter.post("/bulk", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = bulkFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      errorBody("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input"),
      400,
    );
  }
  const data = parsed.data;
  // De-duplicated: the same target twice in one payload would be two conflicting
  // rows in a single statement, which Postgres refuses outright.
  const targetIds = [...new Set(data.targetIds)];

  const rows = await db
    .insert(qualityFeedback)
    .values(
      targetIds.map((targetId) => ({
        userId: user.id,
        orgId,
        targetType: data.targetType,
        targetId,
        verdict: data.verdict,
        reason: data.reason ?? null,
        freeText: data.freeText ?? null,
        metadata: data.metadata ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [
        qualityFeedback.userId,
        qualityFeedback.targetType,
        qualityFeedback.targetId,
      ],
      set: {
        verdict: data.verdict,
        reason: data.reason ?? null,
        freeText: data.freeText ?? null,
        metadata: data.metadata ?? null,
        createdAt: new Date(),
      },
    })
    .returning({ id: qualityFeedback.id });

  const immediateAction = await triggerImmediateAction(
    { ...data, targetIds },
    { userId: user.id, orgId },
  );

  await captureServerEvent(user.id, "quality_feedback_given_bulk", {
    target_type: data.targetType,
    verdict: data.verdict,
    reason: data.reason,
    count: rows.length,
  });

  return c.json({ ok: true, feedbackIds: rows.map((r) => r.id), immediateAction });
});

// POST /api/feedback-quality/bulk-delete — cancel many verdicts and revert their
// actions. POST rather than DELETE: the ids travel in a body, which DELETE cannot
// carry portably. Grouped by (targetType, verdict) so a mixed batch still reverts
// with one statement per kind rather than one per row.
feedbackQualityRouter.post("/bulk-delete", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500)
    : [];
  if (!ids.length) return c.json({ ok: true, count: 0 });

  // Only the author's own rows, so a forged id list cannot revert someone else's.
  const rows = await db
    .delete(qualityFeedback)
    .where(and(eq(qualityFeedback.userId, user.id), inArray(qualityFeedback.id, ids)))
    .returning({
      targetType: qualityFeedback.targetType,
      targetId: qualityFeedback.targetId,
      verdict: qualityFeedback.verdict,
    });

  const groups = new Map<string, { targetType: string; verdict: string; targetIds: string[] }>();
  for (const row of rows) {
    const key = `${row.targetType}|${row.verdict}`;
    const group = groups.get(key);
    if (group) group.targetIds.push(row.targetId);
    else groups.set(key, { ...row, targetIds: [row.targetId] });
  }
  for (const group of groups.values()) await revertImmediateAction(group, orgId);

  return c.json({ ok: true, count: rows.length });
});

// GET /api/feedback-quality/nps-status — whether the periodic NPS prompt may show.
// Three gates, all server-side so they hold across devices:
//   1. tenure   — the account is at least FEEDBACK_NPS_MIN_ACCOUNT_AGE_DAYS old
//   2. value    — the org has at least FEEDBACK_NPS_MIN_SIGNALS signals to judge
//   3. interval — no NPS answer (or dismissal) within FEEDBACK_NPS_INTERVAL_DAYS
// Asking on the way out of onboarding measures the signup flow, not the product:
// the user has nothing to score yet, and the one prompt per 30 days is burnt.
feedbackQualityRouter.get("/nps-status", async (c) => {
  const user = c.get("user");
  const intervalDays = Number(process.env.FEEDBACK_NPS_INTERVAL_DAYS ?? 30);
  const minAccountAgeDays = Number(process.env.FEEDBACK_NPS_MIN_ACCOUNT_AGE_DAYS ?? 14);
  const minSignals = Number(process.env.FEEDBACK_NPS_MIN_SIGNALS ?? 3);

  const account = await db.query.users.findFirst({
    where: eq(users.id, user.id),
    columns: { createdAt: true },
  });
  const ageCutoff = new Date(Date.now() - minAccountAgeDays * 24 * 60 * 60 * 1000);
  if (!account || account.createdAt > ageCutoff) {
    return c.json({ eligible: false });
  }

  if (minSignals > 0) {
    const orgId = await ensureUserOrg(user.id);
    // Capped probe, not a count(*): we only need "are there at least N".
    const seen = await db
      .select({ id: signals.id })
      .from(signals)
      .where(eq(signals.orgId, orgId))
      .limit(minSignals);
    if (seen.length < minSignals) {
      return c.json({ eligible: false });
    }
  }

  const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);
  const last = await db.query.qualityFeedback.findFirst({
    where: and(
      eq(qualityFeedback.userId, user.id),
      eq(qualityFeedback.targetType, "nps"),
    ),
    orderBy: desc(qualityFeedback.createdAt),
  });

  return c.json({ eligible: !last || last.createdAt < cutoff });
});

// GET /api/feedback-quality?targetType=&targetId= — current user's verdict, if any.
feedbackQualityRouter.get("/", async (c) => {
  const user = c.get("user");
  const targetType = c.req.query("targetType");
  const targetId = c.req.query("targetId");
  if (!targetType || !targetId) {
    return c.json(errorBody("invalid_input", "targetType and targetId are required"), 400);
  }
  const parsedType = z.enum(targetTypes).safeParse(targetType);
  if (!parsedType.success) {
    return c.json(errorBody("invalid_input", "Unknown targetType"), 400);
  }

  const row = await db.query.qualityFeedback.findFirst({
    where: and(
      eq(qualityFeedback.userId, user.id),
      eq(qualityFeedback.targetType, parsedType.data),
      eq(qualityFeedback.targetId, targetId),
    ),
  });

  return c.json({ feedback: row ?? null });
});

// DELETE /api/feedback-quality/:id — cancel a verdict and revert its action.
feedbackQualityRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const row = await db.query.qualityFeedback.findFirst({
    where: eq(qualityFeedback.id, id),
  });
  // Only the author can delete their own feedback.
  if (!row || row.userId !== user.id) {
    return c.json(errorBody("not_found", "That feedback doesn't exist."), 404);
  }

  await db.delete(qualityFeedback).where(eq(qualityFeedback.id, id));
  await revertImmediateAction({ ...row, targetIds: [row.targetId] }, orgId);

  return c.json({ ok: true });
});
