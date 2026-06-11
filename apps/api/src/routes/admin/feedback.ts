import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, feedback, users, auditLog, qualityFeedback } from "@outrival/db";
import { getBytesFromR2 } from "@outrival/shared";
import { logAudit, type AdminVariables } from "./shared";

export const feedbackRouter = new Hono<{ Variables: AdminVariables }>();

// --- Feedback (rich view, patch-05) ---
feedbackRouter.get("/feedback", async (c) => {
  const status = c.req.query("status");
  const valid = status === "new" || status === "reviewed" || status === "resolved";
  const rows = await db
    .select({
      id: feedback.id,
      type: feedback.type,
      message: feedback.message,
      pageUrl: feedback.pageUrl,
      consoleErrors: feedback.consoleErrors,
      screenshotR2Key: feedback.screenshotR2Key,
      userAgent: feedback.userAgent,
      status: feedback.status,
      createdAt: feedback.createdAt,
      orgId: feedback.orgId,
      userEmail: users.email,
    })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .where(valid ? eq(feedback.status, status) : undefined)
    .orderBy(desc(feedback.createdAt))
    .limit(100);

  return c.json({ feedback: rows });
});

// Stream a feedback screenshot from R2 (admin-only — the route is gated above).
feedbackRouter.get("/feedback/:id/screenshot", async (c) => {
  const id = c.req.param("id");
  const row = await db.query.feedback.findFirst({ where: eq(feedback.id, id) });
  if (!row?.screenshotR2Key) return c.json({ error: "Not found" }, 404);
  try {
    const bytes = await getBytesFromR2(row.screenshotR2Key);
    const contentType = row.screenshotR2Key.endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

feedbackRouter.patch("/feedback/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ status: z.enum(["new", "reviewed", "resolved"]) }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input" }, 400);

  const [updated] = await db
    .update(feedback)
    .set({ status: parsed.data.status })
    .where(eq(feedback.id, id))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);

  await logAudit(c.get("user").email, "update_feedback", "feedback", id, {
    status: parsed.data.status,
  });

  return c.json({ ok: true });
});

// --- Audit log (most recent admin actions) ---
feedbackRouter.get("/audit-log", async (c) => {
  const rows = await db.query.auditLog.findMany({
    orderBy: desc(auditLog.createdAt),
    limit: 100,
  });
  return c.json({ auditLog: rows });
});

// --- Quality feedback ops (patch-21) ---

type VerdictKey = "useful" | "not_useful" | "neutral";

// Verdict mix per AI output type + the org-wide NPS over the last 30 days.
feedbackRouter.get("/feedback-quality/stats", async (c) => {
  const period = c.req.query("period") === "30d" ? 30 : 7;
  const cutoff = new Date(Date.now() - period * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      targetType: qualityFeedback.targetType,
      verdict: qualityFeedback.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(qualityFeedback)
    .where(gte(qualityFeedback.createdAt, cutoff))
    .groupBy(qualityFeedback.targetType, qualityFeedback.verdict);

  const byType: Record<
    string,
    { useful: number; not_useful: number; neutral: number; total: number; notUsefulRate: number }
  > = {};
  for (const r of rows) {
    const t = (byType[r.targetType] ??= {
      useful: 0,
      not_useful: 0,
      neutral: 0,
      total: 0,
      notUsefulRate: 0,
    });
    t[r.verdict as VerdictKey] += r.count;
    t.total += r.count;
  }
  for (const t of Object.values(byType)) {
    t.notUsefulRate = t.total > 0 ? t.not_useful / t.total : 0;
  }

  // NPS always over a fixed 30-day window (the prompt is monthly).
  const npsCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const npsRows = await db
    .select({ score: qualityFeedback.npsScore })
    .from(qualityFeedback)
    .where(and(eq(qualityFeedback.targetType, "nps"), gte(qualityFeedback.createdAt, npsCutoff)));
  const scores = npsRows
    .map((r) => r.score)
    .filter((s): s is number => typeof s === "number");
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const nps = {
    score:
      scores.length > 0
        ? Math.round(((promoters - detractors) / scores.length) * 100)
        : null,
    responses: scores.length,
    average:
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null,
    promoters,
    detractors,
  };

  return c.json({ period, byType, nps });
});

// Patterns worth fixing: per type over 14 days, flag a high not-useful rate above
// a minimum sample, with the top reasons for context (never an auto-adjustment).
feedbackRouter.get("/feedback-quality/patterns", async (c) => {
  const minCount = Number(process.env.FEEDBACK_AGGREGATE_MIN_COUNT ?? 5);
  const windowDays = 14;
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const verdictRows = await db
    .select({
      targetType: qualityFeedback.targetType,
      verdict: qualityFeedback.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(qualityFeedback)
    .where(gte(qualityFeedback.createdAt, cutoff))
    .groupBy(qualityFeedback.targetType, qualityFeedback.verdict);

  const reasonRows = await db
    .select({
      targetType: qualityFeedback.targetType,
      reason: qualityFeedback.reason,
      count: sql<number>`count(*)::int`,
    })
    .from(qualityFeedback)
    .where(and(gte(qualityFeedback.createdAt, cutoff), eq(qualityFeedback.verdict, "not_useful")))
    .groupBy(qualityFeedback.targetType, qualityFeedback.reason);

  const totals: Record<string, { total: number; notUseful: number }> = {};
  for (const r of verdictRows) {
    const t = (totals[r.targetType] ??= { total: 0, notUseful: 0 });
    t.total += r.count;
    if (r.verdict === "not_useful") t.notUseful += r.count;
  }

  const reasonsByType: Record<string, Array<{ reason: string; count: number }>> = {};
  for (const r of reasonRows) {
    (reasonsByType[r.targetType] ??= []).push({
      reason: r.reason ?? "unspecified",
      count: r.count,
    });
  }

  const patterns = Object.entries(totals)
    .map(([targetType, t]) => ({
      targetType,
      total: t.total,
      notUseful: t.notUseful,
      notUsefulRate: t.total > 0 ? t.notUseful / t.total : 0,
      topReasons: (reasonsByType[targetType] ?? []).sort((a, b) => b.count - a.count).slice(0, 3),
    }))
    .filter((p) => p.total >= minCount && p.notUsefulRate > 0.6)
    .sort((a, b) => b.notUsefulRate - a.notUsefulRate);

  return c.json({ windowDays, minCount, patterns });
});
