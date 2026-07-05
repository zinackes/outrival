import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import {
  db,
  organizations,
  competitors,
  products,
  productCompetitors,
  aiVisibilityTeasers,
} from "@outrival/db";
import { extractAiVisibility, AI_CONFIG } from "@outrival/ai";
import { queryEngine, type Engine } from "../lib/ai-visibility/engines";
import { aggregate } from "../lib/ai-visibility/diff";
import { loggedAi } from "../lib/analytics";

// AI Visibility onboarding TEASER (Lever 7, docs/post-onboarding-activation.md). A
// ONE-TIME, free "share of model" taste at day 0: does the user's product show up in
// AI answer engines for buyer-intent questions in its category — and how often vs its
// top competitor? Runs on the FREE Gemini grounding tier (never a paid call without an
// explicit key). Best-effort and terminal: it always writes exactly one row per org
// (status ready|unavailable), so the day-0 card resolves instead of polling forever.

const InputSchema = z.object({ orgId: z.string() });

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// ≤3 buyer-intent prompts from the product's category (mirrors the tracked feature's
// defaultPrompts, capped tighter — the teaser spends at most 3 free grounded queries).
function teaserPrompts(selfName: string | null, category: string | null): string[] {
  const out: string[] = [];
  if (category) {
    out.push(`best ${category} tools`, `top ${category} software`, `${category} software comparison`);
  } else if (selfName) {
    out.push(`best alternatives to ${selfName}`, `tools like ${selfName}`);
  }
  return [...new Set(out)];
}

export const aiVisibilityTeaserJob = task({
  id: "ai-visibility-teaser",
  maxDuration: 120,
  // Best-effort, not idempotent past the terminal row it writes: never auto-retry
  // (a retry would re-spend free-tier quota and could double-run).
  retry: { maxAttempts: 1 },

  async run(payload: z.input<typeof InputSchema>) {
    const { orgId } = InputSchema.parse(payload);

    // Terminal writer — one row per org (org_id is unique). "unavailable" makes the
    // card hide deterministically; "ready" carries the payload it renders.
    const writeTeaser = async (
      status: "ready" | "unavailable",
      engine: Engine | null,
      result: unknown,
    ) => {
      await db
        .insert(aiVisibilityTeasers)
        .values({ orgId, status, engine, result })
        .onConflictDoUpdate({
          target: aiVisibilityTeasers.orgId,
          set: { status, engine, result, updatedAt: new Date() },
        });
    };

    // Kill-switches: either the whole feature or the teaser specifically.
    if (
      process.env.AI_VISIBILITY_ENABLED === "false" ||
      process.env.AI_VISIBILITY_TEASER_ENABLED === "false"
    ) {
      await writeTeaser("unavailable", null, null);
      return { skipped: "disabled" };
    }

    // One-run-ever guard: the row's presence is the flag.
    const existing = await db.query.aiVisibilityTeasers.findFirst({
      where: eq(aiVisibilityTeasers.orgId, orgId),
    });
    if (existing) return { skipped: "already_ran" };

    // Engine: free Gemini grounding first; paid Perplexity only if its key is present.
    // No key at all → unavailable (never a surprise bill).
    const engine: Engine | null = process.env.GEMINI_API_KEY
      ? "gemini"
      : process.env.PERPLEXITY_API_KEY
        ? "perplexity"
        : null;
    if (!engine) {
      await writeTeaser("unavailable", null, null);
      return { skipped: "no_engine_key" };
    }

    try {
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
      if (!org) {
        await writeTeaser("unavailable", engine, null);
        return { skipped: "no_org" };
      }

      // Primary product's roster: its self product + its linked competitors.
      const product = await db.query.products.findFirst({
        where: and(eq(products.orgId, orgId), ne(products.status, "archived")),
        orderBy: (p) => [desc(p.isPrimary), asc(p.position), asc(p.createdAt)],
        columns: { id: true, selfCompetitorId: true },
      });
      const self = product
        ? await db.query.competitors.findFirst({
            where: and(eq(competitors.id, product.selfCompetitorId), isNull(competitors.deletedAt)),
            columns: { id: true, name: true, category: true },
          })
        : null;
      const rivals = product
        ? await db
            .select({ id: competitors.id, name: competitors.name })
            .from(productCompetitors)
            .innerJoin(competitors, eq(competitors.id, productCompetitors.competitorId))
            .where(
              and(eq(productCompetitors.productId, product.id), isNull(competitors.deletedAt)),
            )
        : [];

      // Need the user's product AND at least one rival for the comparative framing.
      if (!self || rivals.length === 0) {
        await writeTeaser("unavailable", engine, null);
        return { skipped: "empty_roster" };
      }

      const maxPrompts = Number(process.env.AI_VISIBILITY_TEASER_MAX_PROMPTS ?? 3);
      const prompts = teaserPrompts(self.name, self.category).slice(0, maxPrompts);
      if (prompts.length === 0) {
        await writeTeaser("unavailable", engine, null);
        return { skipped: "no_prompts" };
      }

      const roster = [{ id: self.id, name: self.name }, ...rivals];
      const subjectNames = roster.map((c) => c.name);
      const rows: {
        competitorId: string;
        engine: string;
        promptId: string;
        mentioned: boolean;
        rank: number | null;
      }[] = [];
      const citations = new Set<string>();

      for (const prompt of prompts) {
        const res = await queryEngine(engine, prompt);
        if (!res) continue; // missing key / API error — best-effort skip
        const extraction = await loggedAi("extract_ai_visibility", AI_CONFIG.classification, () =>
          extractAiVisibility(res.answer, subjectNames),
        );
        if (!extraction) continue;
        const verdict = new Map(extraction.mentions.map((m) => [norm(m.name), m]));
        for (const c of roster) {
          const v = verdict.get(norm(c.name));
          rows.push({
            competitorId: c.id,
            engine,
            promptId: prompt,
            mentioned: v?.mentioned ?? false,
            rank: v?.mentioned ? v.rank : null,
          });
        }
        for (const u of res.citations.slice(0, 3)) citations.add(u);
      }

      if (rows.length === 0) {
        await writeTeaser("unavailable", engine, null);
        return { skipped: "no_answers" };
      }

      // Share of voice for this single engine: self vs the strongest rival.
      const engineAgg = aggregate(rows).get(engine);
      const sovOf = (id: string) => engineAgg?.subjects.get(id) ?? { mentions: 0, sov: 0, avgRank: null };
      const selfAgg = sovOf(self.id);
      const rankedRivals = rivals
        .map((r) => ({ name: r.name, ...sovOf(r.id) }))
        .sort((a, b) => b.mentions - a.mentions || b.sov - a.sov);
      const topRival = rankedRivals[0] ?? null;

      const selfMentioned = selfAgg.mentions > 0;
      const topRivalMentions = topRival?.mentions ?? 0;
      const leader: "self" | "rival" | "none" =
        selfAgg.mentions > 0 && selfAgg.mentions >= topRivalMentions
          ? "self"
          : topRivalMentions > 0
            ? "rival"
            : "none";
      // "Recommended Nx more often": only meaningful when a rival leads AND the user is
      // mentioned at least once (else the card uses the stronger "not mentioned" framing).
      const ratio =
        leader === "rival" && selfAgg.mentions > 0
          ? Math.max(2, Math.round(topRivalMentions / selfAgg.mentions))
          : null;

      const result = {
        engine,
        promptsRun: engineAgg?.totalPrompts ?? prompts.length,
        self: { name: self.name, mentions: selfAgg.mentions, sov: selfAgg.sov },
        topRival: topRival
          ? { name: topRival.name, mentions: topRival.mentions, sov: topRival.sov }
          : null,
        selfMentioned,
        leader,
        ratio,
        citations: [...citations].slice(0, 3),
      };
      await writeTeaser("ready", engine, result);
      logger.log("Completed ai-visibility-teaser", { orgId, engine, leader, ratio });
      return { ok: true, leader };
    } catch (err) {
      // Never leave the card pending: any failure resolves to "unavailable".
      logger.error("ai-visibility-teaser failed, marking unavailable", {
        orgId,
        error: String(err),
      });
      await writeTeaser("unavailable", engine, null);
      return { ok: false };
    }
  },

  // Safety net for a HARD kill (maxDuration timeout / crash): those terminate the run
  // OUTSIDE the in-run try/catch, so no terminal row is written and the day-0 card
  // polls "pending" forever. Runs once after retries are exhausted — resolve the card
  // to "unavailable". onConflictDoNothing so we never clobber a "ready" a prior run wrote.
  async onFailure({ payload }) {
    const parsed = InputSchema.safeParse(payload);
    if (!parsed.success) return;
    await db
      .insert(aiVisibilityTeasers)
      .values({ orgId: parsed.data.orgId, status: "unavailable", engine: null, result: null })
      .onConflictDoNothing({ target: aiVisibilityTeasers.orgId });
  },
});
