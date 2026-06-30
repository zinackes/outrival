import { Hono } from "hono";
import { z } from "zod";
import { tasks } from "@trigger.dev/sdk/v3";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, competitors, aiVisibilityPrompts } from "@outrival/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isFeatureAllowed } from "../lib/plan";
import { analyticsQueryResult, sql } from "../lib/analytics-safe";

// AI Visibility / "Share of Model" (docs/ai-visibility.md, phase 4). Read the org's
// latest visibility run (share-of-voice leaderboard + per-prompt breakdown + a
// SoV-over-time trend) and manage the tracked prompt set. Premium feature
// (features.aiVisibility, pro+) → 403 plan_locked_feature, parsed into a paywall on
// the web. ai_visibility_results carries org_id, so every read filters by it directly.

type Variables = { user: { id: string } };
export const aiVisibilityRouter = new Hono<{ Variables: Variables }>();
aiVisibilityRouter.use("*", authMiddleware);

const TREND_ENGINE = "perplexity";
const MAX_TREND_LINES = 6;

const num = (v: unknown): number => Number(v ?? 0) || 0;
const pct = (v: unknown): number => Math.round(num(v) * 100);

aiVisibilityRouter.get("/", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const plan = await getOrgPlan(orgId);
  if (!isFeatureAllowed(plan, "aiVisibility")) {
    return c.json({ error: "plan_locked_feature", feature: "aiVisibility", plan }, 403);
  }
  c.header("Cache-Control", "private, max-age=30");

  // Roster (relational, org-scoped) — names + which competitor is the self product.
  const roster = await db
    .select({ id: competitors.id, name: competitors.name, type: competitors.type })
    .from(competitors)
    .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
  const nameById = new Map(roster.map((r) => [r.id, r.name]));
  const selfId = roster.find((r) => r.type === "self")?.id ?? null;

  // Tracked prompts (for the editor + breakdown labels).
  const promptRows = await db
    .select({
      id: aiVisibilityPrompts.id,
      prompt: aiVisibilityPrompts.prompt,
      isActive: aiVisibilityPrompts.isActive,
      origin: aiVisibilityPrompts.origin,
    })
    .from(aiVisibilityPrompts)
    .where(eq(aiVisibilityPrompts.orgId, orgId))
    .orderBy(desc(aiVisibilityPrompts.createdAt));
  const promptText = new Map(promptRows.map((p) => [p.id, p.prompt]));
  const enabled = promptRows.some((p) => p.isActive);

  // Latest run = the run_id of the most recent row for this org.
  const latestRows = await analyticsQueryResult<{ runId: string; recordedAt: string }>(sql`
    SELECT run_id AS "runId", recorded_at AS "recordedAt"
    FROM ai_visibility_results
    WHERE org_id = ${orgId}
    ORDER BY recorded_at DESC
    LIMIT 1`);
  const latestRunId = latestRows.rows[0]?.runId ?? null;
  const lastRunAt = latestRows.rows[0]?.recordedAt ?? null;

  type LbRow = { engine: string; competitorId: string; mentions: number; total: number; avgRank: number | null };
  type RawRow = { promptId: string; engine: string; competitorId: string; mentioned: number; rank: number | null; answerExcerpt: string | null };
  type TrendRow = { recordedAt: string; competitorId: string; sov: number };

  let degraded = !latestRows.ok;
  let lbRows: LbRow[] = [];
  let rawRows: RawRow[] = [];
  let trendRows: TrendRow[] = [];

  if (latestRunId) {
    const [lb, raw] = await Promise.all([
      analyticsQueryResult<LbRow>(sql`
        SELECT engine,
               competitor_id AS "competitorId",
               count(*) FILTER (WHERE mentioned = 1) AS mentions,
               count(DISTINCT prompt_id) AS total,
               avg(rank) FILTER (WHERE mentioned = 1) AS "avgRank"
        FROM ai_visibility_results
        WHERE run_id = ${latestRunId}
        GROUP BY engine, competitor_id`),
      analyticsQueryResult<RawRow>(sql`
        SELECT prompt_id AS "promptId", engine, competitor_id AS "competitorId",
               mentioned, rank, answer_excerpt AS "answerExcerpt"
        FROM ai_visibility_results
        WHERE run_id = ${latestRunId}`),
    ]);
    lbRows = lb.rows;
    rawRows = raw.rows;
    degraded = degraded || !lb.ok || !raw.ok;

    const trend = await analyticsQueryResult<TrendRow>(sql`
      SELECT recorded_at AS "recordedAt", competitor_id AS "competitorId",
             (count(*) FILTER (WHERE mentioned = 1))::float / nullif(count(DISTINCT prompt_id), 0) AS sov
      FROM ai_visibility_results
      WHERE org_id = ${orgId} AND engine = ${TREND_ENGINE}
      GROUP BY recorded_at, competitor_id
      ORDER BY recorded_at`);
    trendRows = trend.rows;
    degraded = degraded || !trend.ok;
  }

  // --- Leaderboard: per engine, subjects sorted by share-of-voice desc. ---
  const byEngine = new Map<string, { engine: string; totalPrompts: number; subjects: LbRow[] }>();
  for (const r of lbRows) {
    let e = byEngine.get(r.engine);
    if (!e) {
      e = { engine: r.engine, totalPrompts: num(r.total), subjects: [] };
      byEngine.set(r.engine, e);
    }
    e.subjects.push(r);
  }
  const leaderboard = [...byEngine.values()].map((e) => ({
    engine: e.engine,
    totalPrompts: e.totalPrompts,
    subjects: e.subjects
      .filter((s) => nameById.has(s.competitorId))
      .map((s) => ({
        competitorId: s.competitorId,
        name: nameById.get(s.competitorId) ?? "Unknown",
        isSelf: s.competitorId === selfId,
        mentions: num(s.mentions),
        sov: e.totalPrompts > 0 ? num(s.mentions) / e.totalPrompts : 0,
        avgRank: s.avgRank == null ? null : num(s.avgRank),
      }))
      .sort((a, b) => b.sov - a.sov),
  }));

  // --- Per-prompt breakdown (evidence): one row per prompt, cells per engine. ---
  const promptGroups = new Map<string, RawRow[]>();
  for (const r of rawRows) {
    const arr = promptGroups.get(r.promptId) ?? [];
    arr.push(r);
    promptGroups.set(r.promptId, arr);
  }
  const breakdown = [...promptGroups.entries()].map(([promptId, rows]) => {
    const engines = new Map<string, RawRow[]>();
    for (const r of rows) engines.set(r.engine, [...(engines.get(r.engine) ?? []), r]);
    return {
      promptId,
      prompt: promptText.get(promptId) ?? "(removed prompt)",
      cells: [...engines.entries()].map(([engine, er]) => {
        const selfRow = er.find((r) => r.competitorId === selfId);
        return {
          engine,
          selfMentioned: !!selfRow && selfRow.mentioned === 1,
          selfRank: selfRow?.mentioned === 1 ? selfRow.rank : null,
          mentioned: er
            .filter((r) => r.mentioned === 1 && r.competitorId !== selfId && nameById.has(r.competitorId))
            .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
            .map((r) => nameById.get(r.competitorId) ?? "Unknown"),
          excerpt: er.find((r) => r.answerExcerpt)?.answerExcerpt ?? null,
        };
      }),
    };
  });

  // --- Trend: SoV-over-time lines for self + top competitors (recharts-ready rows). ---
  const topEngine = leaderboard.find((l) => l.engine === TREND_ENGINE) ?? leaderboard[0];
  const trendKeys = (topEngine?.subjects ?? [])
    .slice()
    .sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0) || b.sov - a.sov)
    .slice(0, MAX_TREND_LINES)
    .map((s) => s.name);
  const trendKeySet = new Set(trendKeys);
  const byTime = new Map<string, Record<string, string | number>>();
  for (const r of trendRows) {
    const name = nameById.get(r.competitorId);
    if (!name || !trendKeySet.has(name)) continue;
    const t = String(r.recordedAt).slice(0, 10);
    const row = byTime.get(t) ?? { t };
    row[name] = pct(r.sov);
    byTime.set(t, row);
  }
  const trend = [...byTime.values()];

  return c.json({
    enabled,
    lastRunAt,
    leaderboard,
    breakdown,
    trendKeys,
    trend,
    prompts: promptRows,
    degraded,
  });
});

// --- Prompt editor CRUD (org-scoped; ownership enforced in the WHERE). ---

const PromptBody = z.object({ prompt: z.string().trim().min(3).max(200) });

aiVisibilityRouter.post("/prompts", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const plan = await getOrgPlan(orgId);
  if (!isFeatureAllowed(plan, "aiVisibility")) {
    return c.json({ error: "plan_locked_feature", feature: "aiVisibility", plan }, 403);
  }
  const parsed = PromptBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_prompt" }, 400);
  const [row] = await db
    .insert(aiVisibilityPrompts)
    .values({ orgId, prompt: parsed.data.prompt, origin: "user" })
    .returning({
      id: aiVisibilityPrompts.id,
      prompt: aiVisibilityPrompts.prompt,
      isActive: aiVisibilityPrompts.isActive,
      origin: aiVisibilityPrompts.origin,
    });
  return c.json({ prompt: row }, 201);
});

const PatchBody = z.object({ isActive: z.boolean().optional(), prompt: z.string().trim().min(3).max(200).optional() });

aiVisibilityRouter.patch("/prompts/:id", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_patch" }, 400);
  const [row] = await db
    .update(aiVisibilityPrompts)
    .set(parsed.data)
    .where(and(eq(aiVisibilityPrompts.id, c.req.param("id")), eq(aiVisibilityPrompts.orgId, orgId)))
    .returning({
      id: aiVisibilityPrompts.id,
      prompt: aiVisibilityPrompts.prompt,
      isActive: aiVisibilityPrompts.isActive,
      origin: aiVisibilityPrompts.origin,
    });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ prompt: row });
});

aiVisibilityRouter.delete("/prompts/:id", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  await db
    .delete(aiVisibilityPrompts)
    .where(and(eq(aiVisibilityPrompts.id, c.req.param("id")), eq(aiVisibilityPrompts.orgId, orgId)));
  return c.json({ ok: true });
});

// Run now (also the "enable" path: the job seeds default prompts when the org has
// none, so the first run bootstraps the prompt set).
aiVisibilityRouter.post("/run", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const plan = await getOrgPlan(orgId);
  if (!isFeatureAllowed(plan, "aiVisibility")) {
    return c.json({ error: "plan_locked_feature", feature: "aiVisibility", plan }, 403);
  }
  const handle = await tasks.trigger("scrape-ai-visibility", { orgId });
  return c.json({ runId: handle.id });
});
