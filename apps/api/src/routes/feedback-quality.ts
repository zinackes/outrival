import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  qualityFeedback,
  signals,
  battleCards,
  competitorCandidates,
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

// Fires the visible side-effect of a "not_useful" verdict. Every mutation is
// scoped to the user's org so feedback can never touch another workspace's data.
async function triggerImmediateAction(
  input: FeedbackInput,
  ctx: { userId: string; orgId: string },
): Promise<ImmediateAction | null> {
  if (input.verdict !== "not_useful") return null;

  switch (input.targetType) {
    case "signal": {
      await db
        .update(signals)
        .set({ hiddenForUserAt: new Date() })
        .where(and(eq(signals.id, input.targetId), eq(signals.orgId, ctx.orgId)));
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
            eq(competitorCandidates.id, input.targetId),
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
          and(eq(battleCards.id, input.targetId), eq(battleCards.orgId, ctx.orgId)),
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
          .where(and(eq(signals.id, input.targetId), eq(signals.orgId, ctx.orgId)));
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
  row: { targetType: string; targetId: string; verdict: string },
  orgId: string,
): Promise<void> {
  if (row.verdict !== "not_useful") return;

  switch (row.targetType) {
    case "signal":
      await db
        .update(signals)
        .set({ hiddenForUserAt: null })
        .where(and(eq(signals.id, row.targetId), eq(signals.orgId, orgId)));
      return;
    case "discovery_suggestion":
      await db
        .update(competitorCandidates)
        .set({ status: "new" })
        .where(
          and(
            eq(competitorCandidates.id, row.targetId),
            eq(competitorCandidates.orgId, orgId),
          ),
        );
      return;
    case "battle_card":
      await db
        .update(battleCards)
        .set({ flaggedForRegenerationAt: null })
        .where(and(eq(battleCards.id, row.targetId), eq(battleCards.orgId, orgId)));
      return;
    case "severity_classification":
      await db
        .update(signals)
        .set({ severityOverride: null, severityOverriddenBy: null })
        .where(and(eq(signals.id, row.targetId), eq(signals.orgId, orgId)));
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
  // replaces the first so the user can change their mind.
  const existing = await db.query.qualityFeedback.findFirst({
    where: and(
      eq(qualityFeedback.userId, user.id),
      eq(qualityFeedback.targetType, data.targetType),
      eq(qualityFeedback.targetId, data.targetId),
    ),
  });

  let feedbackId: string;
  if (existing) {
    feedbackId = existing.id;
    await db
      .update(qualityFeedback)
      .set({
        verdict: data.verdict,
        reason: data.reason ?? null,
        npsScore: data.npsScore ?? null,
        freeText: data.freeText ?? null,
        metadata: data.metadata ?? null,
        createdAt: new Date(),
      })
      .where(eq(qualityFeedback.id, existing.id));
  } else {
    const [inserted] = await db
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
      .returning({ id: qualityFeedback.id });
    feedbackId = inserted!.id;
  }

  const immediateAction = await triggerImmediateAction(data, { userId: user.id, orgId });

  // PostHog server capture is a no-op when the key is absent (consent gating lives
  // in the web client; the server only records when configured).
  await captureServerEvent(user.id, "quality_feedback_given", {
    target_type: data.targetType,
    verdict: data.verdict,
    reason: data.reason,
  });

  return c.json({ ok: true, feedbackId, immediateAction });
});

// GET /api/feedback-quality/nps-status — whether the periodic NPS prompt may show.
// Eligible iff the user hasn't answered (or dismissed) an NPS prompt within the
// configured window (default 30 days). Server-side so it holds across devices.
feedbackQualityRouter.get("/nps-status", async (c) => {
  const user = c.get("user");
  const intervalDays = Number(process.env.FEEDBACK_NPS_INTERVAL_DAYS ?? 30);
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
  await revertImmediateAction(row, orgId);

  return c.json({ ok: true });
});
