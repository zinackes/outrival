import { Hono } from "hono";
import { z } from "zod";
import { scrapeAiVisibility } from "@outrival/queue";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, competitors, aiVisibilityPrompts, aiVisibilityTeasers } from "@outrival/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { enqueueJob } from "../lib/queue";
import { getOrgPlan, isFeatureAllowed } from "../lib/plan";
import { primaryProductId, productSelfCompetitorId, productCompetitorIds } from "../lib/products";
import { analyticsQueryResult, sql } from "../lib/analytics-safe";

// AI Visibility / "Share of Model" (docs/ai-visibility.md, phase 4). Read the org's
// latest visibility run (share-of-voice leaderboard + per-prompt breakdown + a
// SoV-over-time trend) and manage the tracked prompt set. Premium feature
// (features.aiVisibility, pro+) → 403 plan_locked_feature, parsed into a paywall on
// the web. ai_visibility_results carries org_id, so every read filters by it directly.
//
// Multi-SKU (patch-28, phase B): AI Visibility is per-product. `?productId=` (or the
// primary product for "all products") scopes prompts, results, "you" (the product's
// self) and the leaderboard subjects (self + linked competitors). Prompts and result
// rows carry product_id; legacy orgs with no product fall back to org-level reads.

type Variables = { user: { id: string } };
export const aiVisibilityRouter = new Hono<{ Variables: Variables }>();
aiVisibilityRouter.use("*", authMiddleware);

// The engine the trend chart + leaderboard default to. gemini is the free default
// engine (Google Search grounding free tier), so it's the one with data out of the box.
const TREND_ENGINE = "gemini";
const MAX_TREND_LINES = 6;

const num = (v: unknown): number => Number(v ?? 0) || 0;
const pct = (v: unknown): number => Math.round(num(v) * 100);

// Onboarding TEASER (Lever 7) — the ONE ungated read in this router: a free one-time
// "share of model" taste any plan sees at day 0. Returns "pending" until the worker
// writes its terminal row, "unavailable" when there's nothing to show (no engine key /
// empty roster / no answers), else the aggregated payload the day-0 card renders.
aiVisibilityRouter.get("/teaser", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const row = await db.query.aiVisibilityTeasers.findFirst({
    where: eq(aiVisibilityTeasers.orgId, orgId),
  });
  if (!row) return c.json({ status: "pending" });
  if (row.status !== "ready" || !row.result) return c.json({ status: "unavailable" });
  return c.json({ status: "ready", ...(row.result as Record<string, unknown>) });
});

aiVisibilityRouter.get("/", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const plan = await getOrgPlan(orgId);
  if (!isFeatureAllowed(plan, "aiVisibility")) {
    return c.json({ error: "plan_locked_feature", feature: "aiVisibility", plan }, 403);
  }
  c.header("Cache-Control", "private, max-age=30");

  // Resolve the product in focus (phase B): an explicit ?productId= or, for "all
  // products", the org's primary product — the page is per-product now. "You" + the
  // in-scope subject set + the prompt/result filters all key off it. Legacy orgs with
  // no product fall through to org-level (productId stays undefined, no scoping).
  let productId = c.req.query("productId") || undefined;
  if (!productId) productId = (await primaryProductId(orgId)) ?? undefined;

  // Result rows carry product_id (phase B); scope every analytics read to the product
  // in focus. Empty fragment for legacy org-level orgs (no product) → unfiltered.
  const productFilter = productId ? sql`AND product_id = ${productId}` : sql``;

  // Everything below keys off orgId (+ the resolved productId) and is otherwise
  // independent. Fan the round-trips out: this read backs the whole page, and
  // serialised on a cold Neon connection each hop re-paid the wake-up latency.
  const [roster, scopedSelfId, linked, promptRows, latestRows] = await Promise.all([
    // Roster (relational, org-scoped) — names for every subject the run wrote rows for.
    db
      .select({ id: competitors.id, name: competitors.name, type: competitors.type })
      .from(competitors)
      .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt))),
    productId ? productSelfCompetitorId(orgId, productId) : Promise.resolve(null),
    productId ? productCompetitorIds(orgId, productId) : Promise.resolve([] as string[]),
    // Tracked prompts for this product (the editor + breakdown labels).
    db
      .select({
        id: aiVisibilityPrompts.id,
        prompt: aiVisibilityPrompts.prompt,
        isActive: aiVisibilityPrompts.isActive,
        origin: aiVisibilityPrompts.origin,
      })
      .from(aiVisibilityPrompts)
      .where(
        and(
          eq(aiVisibilityPrompts.orgId, orgId),
          productId ? eq(aiVisibilityPrompts.productId, productId) : undefined,
        ),
      )
      .orderBy(desc(aiVisibilityPrompts.createdAt)),
    // Recent runs with their mention counts. We DISPLAY the most recent run that actually
    // produced mentions, not merely the most recent one: a degraded run (e.g. the free-tier
    // engine quota is exhausted so it answers nothing nameable) writes a full roster of
    // mentioned=0 rows and would otherwise blank the whole board to 0%. Fall back to the
    // latest run overall only when none in the window has mentions (a genuinely empty org).
    analyticsQueryResult<{ runId: string; recordedAt: string; mentions: number }>(sql`
      SELECT run_id AS "runId", max(recorded_at) AS "recordedAt",
             count(*) FILTER (WHERE mentioned = 1) AS mentions
      FROM ai_visibility_results
      WHERE org_id = ${orgId} ${productFilter}
      GROUP BY run_id
      ORDER BY max(recorded_at) DESC
      LIMIT 10`),
  ]);
  const nameById = new Map(roster.map((r) => [r.id, r.name]));

  // In-scope subject set = the product's self + its linked competitors (phase B). scopeIds
  // keeps the product-scoped self only; selfId itself falls back to the org's type="self"
  // competitor for legacy no-product orgs (matching the pre-parallelised order).
  let selfId: string | null = scopedSelfId;
  const scopeIds: Set<string> | null = productId
    ? new Set([...(scopedSelfId ? [scopedSelfId] : []), ...linked])
    : null;
  if (!selfId) selfId = roster.find((r) => r.type === "self")?.id ?? null;
  const inScope = (id: string) => !scopeIds || scopeIds.has(id);

  const promptText = new Map(promptRows.map((p) => [p.id, p.prompt]));
  const enabled = promptRows.some((p) => p.isActive);

  // Prefer the latest run that has any mention; fall back to the newest run overall so a
  // brand-new org still renders its roster. lastRunAt tracks the DISPLAYED run so the
  // "as of" date always matches the numbers shown, never a newer empty run.
  const runsMeta = latestRows.rows;
  const displayRun = runsMeta.find((r) => num(r.mentions) > 0) ?? runsMeta[0];
  const latestRunId = displayRun?.runId ?? null;
  const lastRunAt = displayRun?.recordedAt ?? null;

  type LbRow = { engine: string; competitorId: string; mentions: number; total: number; avgRank: number | null };
  type RawRow = { promptId: string; engine: string; competitorId: string; mentioned: number; promptNamed: number; rank: number | null; answerExcerpt: string | null };
  type TrendRow = { recordedAt: string; competitorId: string; sov: number };

  let degraded = !latestRows.ok;
  let lbRows: LbRow[] = [];
  let rawRows: RawRow[] = [];
  let trendRows: TrendRow[] = [];

  if (latestRunId) {
    const [lb, raw] = await Promise.all([
      // Organic share-of-voice: a subject named IN the prompt (prompt_named = 1) is a
      // seeded, contaminated pair — excluded from both its mention count and its prompt
      // denominator, so the denominator is per-subject (each subject's un-naming prompts).
      analyticsQueryResult<LbRow>(sql`
        SELECT engine,
               competitor_id AS "competitorId",
               count(*) FILTER (WHERE mentioned = 1 AND prompt_named = 0) AS mentions,
               count(DISTINCT prompt_id) FILTER (WHERE prompt_named = 0) AS total,
               avg(rank) FILTER (WHERE mentioned = 1 AND prompt_named = 0) AS "avgRank"
        FROM ai_visibility_results
        WHERE org_id = ${orgId} AND run_id = ${latestRunId} ${productFilter}
        GROUP BY engine, competitor_id`),
      analyticsQueryResult<RawRow>(sql`
        SELECT prompt_id AS "promptId", engine, competitor_id AS "competitorId",
               mentioned, prompt_named AS "promptNamed", rank, answer_excerpt AS "answerExcerpt"
        FROM ai_visibility_results
        WHERE org_id = ${orgId} AND run_id = ${latestRunId} ${productFilter}`),
    ]);
    lbRows = lb.rows;
    rawRows = raw.rows;
    degraded = degraded || !lb.ok || !raw.ok;

    // Exclude degraded runs (the engine named nobody across the whole roster — a quota /
    // outage artifact, not a real "everyone at 0%") so the SoV-over-time lines don't
    // nosedive to 0 on runs that carry no information. Consistent with the leaderboard.
    const trend = await analyticsQueryResult<TrendRow>(sql`
      SELECT recorded_at AS "recordedAt", competitor_id AS "competitorId",
             (count(*) FILTER (WHERE mentioned = 1 AND prompt_named = 0))::float
               / nullif(count(DISTINCT prompt_id) FILTER (WHERE prompt_named = 0), 0) AS sov
      FROM ai_visibility_results
      WHERE org_id = ${orgId} AND engine = ${TREND_ENGINE} ${productFilter}
        AND run_id IN (
          SELECT run_id FROM ai_visibility_results
          WHERE org_id = ${orgId} AND engine = ${TREND_ENGINE} ${productFilter}
          GROUP BY run_id HAVING count(*) FILTER (WHERE mentioned = 1) > 0)
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
      e = { engine: r.engine, totalPrompts: 0, subjects: [] };
      byEngine.set(r.engine, e);
    }
    // Each subject's `total` now excludes the prompts that named it, so they differ per
    // subject; the engine's headline prompt count is the largest (a never-named subject,
    // e.g. the self on un-branded prompts, sees every prompt).
    e.totalPrompts = Math.max(e.totalPrompts, num(r.total));
    e.subjects.push(r);
  }
  const leaderboard = [...byEngine.values()].map((e) => ({
    engine: e.engine,
    totalPrompts: e.totalPrompts,
    subjects: e.subjects
      .filter((s) => nameById.has(s.competitorId) && inScope(s.competitorId))
      .map((s) => ({
        competitorId: s.competitorId,
        name: nameById.get(s.competitorId) ?? "Unknown",
        isSelf: s.competitorId === selfId,
        mentions: num(s.mentions),
        // Per-subject organic denominator (its own un-naming prompts), not the engine total.
        sov: num(s.total) > 0 ? num(s.mentions) / num(s.total) : 0,
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
  // Only surface prompts that still exist (active or paused) — a deleted prompt's rows
  // linger in the append-only run table, so drop them instead of showing "(removed)".
  const visibleGroups = [...promptGroups.entries()].filter(([promptId]) =>
    promptText.has(promptId),
  );
  const breakdown = visibleGroups.map(([promptId, rows]) => {
    const engines = new Map<string, RawRow[]>();
    for (const r of rows) engines.set(r.engine, [...(engines.get(r.engine) ?? []), r]);
    return {
      promptId,
      prompt: promptText.get(promptId) ?? "(removed prompt)",
      cells: [...engines.entries()].map(([engine, er]) => {
        const selfRow = er.find((r) => r.competitorId === selfId);
        // A subject named IN this prompt is seeded, not organically surfaced — don't
        // credit it as a mention in the evidence view (mirrors the SoV exclusion).
        const organic = selfRow?.mentioned === 1 && selfRow.promptNamed !== 1;
        return {
          engine,
          selfMentioned: organic,
          selfRank: organic ? selfRow.rank : null,
          mentioned: er
            .filter(
              (r) =>
                r.mentioned === 1 &&
                r.promptNamed !== 1 &&
                r.competitorId !== selfId &&
                nameById.has(r.competitorId) &&
                inScope(r.competitorId),
            )
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

const PromptBody = z.object({
  prompt: z.string().trim().min(3).max(200),
  productId: z.string().optional(),
});

aiVisibilityRouter.post("/prompts", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const plan = await getOrgPlan(orgId);
  if (!isFeatureAllowed(plan, "aiVisibility")) {
    return c.json({ error: "plan_locked_feature", feature: "aiVisibility", plan }, 403);
  }
  const parsed = PromptBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_prompt" }, 400);
  // Attach to the active product (phase B). Validate ownership: productSelfCompetitorId
  // is null for a forged/foreign id → fall back to the primary product.
  let productId: string | undefined = parsed.data.productId;
  if (productId && !(await productSelfCompetitorId(orgId, productId))) productId = undefined;
  if (!productId) productId = (await primaryProductId(orgId)) ?? undefined;
  const [row] = await db
    .insert(aiVisibilityPrompts)
    .values({ orgId, productId, prompt: parsed.data.prompt, origin: "user" })
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
  // notifyOnComplete → the worker drops a durable "run complete" notification when it
  // lands (~a minute later, off the page); the weekly scheduler omits it so automated
  // runs stay silent.
  const jobId = await enqueueJob(scrapeAiVisibility, { orgId, notifyOnComplete: true });
  return c.json({ runId: jobId });
});
