import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import {
  db,
  competitors,
  organizations,
  aiVisibilityPrompts,
  products,
  productCompetitors,
  monitors,
  snapshots,
  changes,
} from "@outrival/db";
import { computeHash, uploadToR2 } from "@outrival/shared";
import { extractAiVisibility, AI_CONFIG, type Classification } from "@outrival/ai";
import { queryEngine, type Engine } from "../lib/ai-visibility/engines";
import {
  insertAiVisibilityResults,
  getPreviousAiVisibilityRun,
  loggedAi,
  type AiVisibilityResultRow,
} from "../lib/analytics";
import { aggregate, computeDeltas, type VisibilityDelta } from "../lib/ai-visibility/diff";
import { notifyJobComplete } from "../lib/job-complete";

// AI Visibility / "Share of Model" — phases 2+3 (docs/ai-visibility.md). For one org,
// PER PRODUCT (patch-28 phase B): for each active SKU, query each engine once per its
// tracked prompts, parse which of its roster subjects (that product's self + linked
// competitors) the answer mentions, append the verdicts to ai_visibility_results tagged
// with product_id, then diff against that product's previous run and emit signals on
// meaningful shifts (self drops out / a competitor overtakes you / a competitor newly
// appears). Independent of the scrape-monitor pipeline.

const InputSchema = z.object({
  orgId: z.string(),
  // Set by the on-demand "Run now" route → drop a durable "run complete" notification
  // when the run lands (it resolves ~a minute later, off the page). The weekly
  // scheduler omits it, so an automated run stays silent.
  notifyOnComplete: z.boolean().optional(),
});

// gemini first — it's the FREE default (Google Search grounding free tier). perplexity
// only runs if PERPLEXITY_API_KEY is set (else queryEngine returns null and it's skipped),
// so no key = gemini-only = $0. OpenAI + Google AIO land in phase 5.
const ENGINES: Engine[] = ["gemini", "perplexity"];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Seed a small starter prompt set from a product's self when it has none yet, so a run
// works before the user curates prompts. Idempotent: only seeds when the product has
// zero prompts. Same shape the enable flow uses.
function defaultPrompts(selfName: string | null, category: string | null): string[] {
  const out: string[] = [];
  if (category) {
    out.push(`best ${category} tools`, `top ${category} software`, `${category} software comparison`);
  }
  if (selfName) out.push(`best alternatives to ${selfName}`, `tools like ${selfName}`);
  return [...new Set(out)].slice(0, 5);
}

export const scrapeAiVisibilityJob = task({
  id: "scrape-ai-visibility",
  maxDuration: 300,
  retry: { maxAttempts: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const { orgId, notifyOnComplete } = InputSchema.parse(payload);

    // Kill-switch: explicit "false" disables; missing key disables (no cost incurred).
    if (process.env.AI_VISIBILITY_ENABLED === "false") {
      logger.log("ai-visibility disabled by kill-switch, skipping", { orgId });
      return { skipped: true, reason: "disabled" };
    }
    const maxPrompts = Number(process.env.AI_VISIBILITY_MAX_PROMPTS ?? 10);

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) throw new AbortTaskRunError(`Org ${orgId} not found`);
    logger.log("Starting scrape-ai-visibility", { orgId, plan: org.plan });

    // patch-28 (phase B): AI Visibility is per-product. Track each active SKU
    // independently — its own self, its own linked competitors, its own prompt set,
    // its own SoV baseline. One shared runId groups the whole sweep; rows are tagged
    // with product_id so reads + the diff scope to a single product.
    const productList = await db.query.products.findMany({
      where: and(eq(products.orgId, orgId), ne(products.status, "archived")),
      columns: { id: true, name: true, selfCompetitorId: true },
      orderBy: (p, { asc, desc }) => [desc(p.isPrimary), asc(p.position), asc(p.createdAt)],
    });
    if (productList.length === 0) {
      logger.log("No active products, skipping", { orgId });
      return { skipped: true, reason: "no_products" };
    }

    const runId = crypto.randomUUID();
    const now = new Date();
    let totalRows = 0;
    let totalPrompts = 0;
    let totalQueries = 0;
    let signalled = 0;

    for (const product of productList) {
      // Roster for this product = its self product + its linked competitors (non-deleted).
      const self = await db.query.competitors.findFirst({
        where: and(eq(competitors.id, product.selfCompetitorId), isNull(competitors.deletedAt)),
        columns: { id: true, name: true, category: true, url: true },
      });
      const linked = await db
        .select({ id: competitors.id, name: competitors.name, url: competitors.url })
        .from(productCompetitors)
        .innerJoin(competitors, eq(competitors.id, productCompetitors.competitorId))
        .where(
          and(eq(productCompetitors.productId, product.id), isNull(competitors.deletedAt)),
        );
      const roster = [
        ...(self ? [{ id: self.id, name: self.name, url: self.url }] : []),
        ...linked,
      ];
      if (roster.length === 0) {
        logger.log("Product has empty roster, skipping", { orgId, productId: product.id });
        continue;
      }

      // Prompts for this product (active), or a seeded starter set from its self.
      let prompts = await db.query.aiVisibilityPrompts.findMany({
        where: and(
          eq(aiVisibilityPrompts.orgId, orgId),
          eq(aiVisibilityPrompts.productId, product.id),
          eq(aiVisibilityPrompts.isActive, true),
        ),
      });
      if (prompts.length === 0) {
        const seeds = defaultPrompts(self?.name ?? null, self?.category ?? null);
        if (seeds.length === 0) {
          logger.log("No prompts and nothing to seed for product, skipping", {
            orgId,
            productId: product.id,
          });
          continue;
        }
        await db.insert(aiVisibilityPrompts).values(
          seeds.map((p) => ({ orgId, productId: product.id, prompt: p, origin: "auto" })),
        );
        prompts = await db.query.aiVisibilityPrompts.findMany({
          where: and(
            eq(aiVisibilityPrompts.orgId, orgId),
            eq(aiVisibilityPrompts.productId, product.id),
            eq(aiVisibilityPrompts.isActive, true),
          ),
        });
        logger.log("Seeded default prompts", { orgId, productId: product.id, count: seeds.length });
      }
      prompts = prompts.slice(0, maxPrompts);

      const subjectNames = roster.map((c) => c.name);
      const productRows: AiVisibilityResultRow[] = [];

      for (const prompt of prompts) {
        for (const engine of ENGINES) {
          const res = await queryEngine(engine, prompt.prompt);
          if (!res) continue; // missing key / API error — best-effort, skip
          totalQueries++;

          const extraction = await loggedAi("extract_ai_visibility", AI_CONFIG.classification, () =>
            extractAiVisibility(res.answer, subjectNames),
          );
          if (!extraction) continue;

          // Index the model's verdicts by normalized subject name (identity is trusted
          // from the ROSTER, never the model — unmatched names are ignored).
          const verdict = new Map(extraction.mentions.map((m) => [norm(m.name), m]));
          const excerpt = res.answer.slice(0, 2000);

          // One row per roster subject, mentioned or not, so share-of-voice is derivable.
          const rows: AiVisibilityResultRow[] = roster.map((c) => {
            const v = verdict.get(norm(c.name));
            return {
              org_id: orgId,
              prompt_id: prompt.id,
              competitor_id: c.id,
              product_id: product.id,
              engine,
              mentioned: v?.mentioned ?? false,
              rank: v?.mentioned ? v.rank : null,
              cited: v?.mentioned ? v.cited : null,
              sentiment_score: v?.mentioned ? v.sentiment : null,
              answer_excerpt: excerpt,
              run_id: runId,
              recorded_at: now,
            };
          });
          await insertAiVisibilityResults(rows);
          productRows.push(...rows);
        }
      }
      totalRows += productRows.length;
      totalPrompts += prompts.length;

      // Phase 3 diff: against THIS product's previous run, signal on meaningful shifts.
      if (productRows.length > 0) {
        const prevRows = await getPreviousAiVisibilityRun(orgId, runId, product.id);
        if (prevRows && prevRows.length > 0) {
          const currAgg = aggregate(
            productRows.map((r) => ({
              competitorId: r.competitor_id,
              engine: r.engine,
              promptId: r.prompt_id,
              mentioned: r.mentioned,
              rank: r.rank ?? null,
            })),
          );
          const deltas = computeDeltas(aggregate(prevRows), currAgg, self?.id ?? null);
          if (deltas.length > 0) {
            const nameById = new Map(roster.map((c) => [c.id, c.name]));
            const urlById = new Map(roster.map((c) => [c.id, c.url ?? null]));
            signalled += await emitVisibilitySignals(deltas, nameById, urlById);
          }
        }
      }
    }

    logger.log("Completed scrape-ai-visibility", {
      orgId,
      products: productList.length,
      prompts: totalPrompts,
      queries: totalQueries,
      rowsWritten: totalRows,
      signalled,
    });

    if (notifyOnComplete) {
      await notifyJobComplete({
        orgId,
        title: "AI Visibility run complete",
        body: `We checked ${totalPrompts} prompt${totalPrompts === 1 ? "" : "s"} across ${productList.length} product${productList.length === 1 ? "" : "s"}. Your latest results are ready to view.`,
        linkUrl: "/dashboard/ai-visibility",
      });
    }

    return {
      products: productList.length,
      prompts: totalPrompts,
      queries: totalQueries,
      rowsWritten: totalRows,
      signalled,
      runId,
    };
  },
});

const ENGINE_LABEL: Record<string, string> = { perplexity: "Perplexity", gemini: "Gemini" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

function deltaCopy(d: VisibilityDelta, name: string): { diffText: string; reason: string } {
  const engine = ENGINE_LABEL[d.engine] ?? d.engine;
  switch (d.type) {
    case "self_dropped":
      return {
        diffText: `Your product is no longer mentioned in ${engine} AI answers for any tracked prompt (it appeared in ${pct(d.subjectBefore)} of prompts last run).`,
        reason: `Your product dropped out of ${engine} AI answers`,
      };
    case "overtaken":
      return {
        diffText: `${name} now appears in ${pct(d.subjectAfter)} of ${engine} AI answers vs your ${pct(d.selfAfter)} — overtaking your product since the last run (previously ${pct(d.subjectBefore)} vs your ${pct(d.selfBefore)}).`,
        reason: `${name} overtook your product in ${engine} AI answers`,
      };
    case "competitor_appeared":
      return {
        diffText: `${name} started appearing in ${engine} AI answers (${pct(d.subjectAfter)} of tracked prompts), where it was absent last run.`,
        reason: `${name} newly appeared in ${engine} AI answers`,
      };
  }
}

// Anchor each meaningful shift into the existing signal pipeline. The ai_visibility
// monitor is infra (isActive=false → never scheduled / handled by getScraper); it and
// the snapshot exist only to satisfy the changes FK chain, exactly like tech_stack.
async function emitVisibilitySignals(
  deltas: VisibilityDelta[],
  nameById: Map<string, string>,
  urlById: Map<string, string | null>,
): Promise<number> {
  let emitted = 0;
  for (const d of deltas) {
    const name = nameById.get(d.competitorId) ?? "A competitor";
    const { diffText, reason } = deltaCopy(d, name);

    let monitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.competitorId, d.competitorId),
        eq(monitors.sourceType, "ai_visibility"),
      ),
    });
    if (!monitor) {
      [monitor] = await db
        .insert(monitors)
        .values({
          competitorId: d.competitorId,
          sourceType: "ai_visibility",
          frequency: "weekly", // unused — this monitor is never scheduled
          isActive: false,
          config: {},
        })
        .returning();
    }
    if (!monitor) continue;

    const prevSnapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.monitorId, monitor.id),
      orderBy: desc(snapshots.scrapedAt),
    });

    // R2 before DB (snapshots.r2Key is NOT NULL). The "snapshot" is the evidence text.
    const timestamp = new Date().toISOString();
    const r2Key = `snapshots/${d.competitorId}/ai_visibility/${timestamp}`;
    await uploadToR2(`${r2Key}.txt`, diffText, "text/plain; charset=utf-8", { compress: true });

    const [snapshot] = await db
      .insert(snapshots)
      .values({
        monitorId: monitor.id,
        r2Key,
        contentHash: computeHash(`${d.type}:${d.engine}:${d.competitorId}:${diffText}`),
        status: "success",
        scrapedAt: new Date(),
        resolvedUrl: urlById.get(d.competitorId) ?? null,
      })
      .returning();
    if (!snapshot) continue;

    const [change] = await db
      .insert(changes)
      .values({
        monitorId: monitor.id,
        snapshotBeforeId: prevSnapshot?.id ?? null,
        snapshotAfterId: snapshot.id,
        diffText,
        diffType: "text",
        rawDiff: {
          aiVisibility: {
            type: d.type,
            engine: d.engine,
            subjectAfter: d.subjectAfter,
            selfAfter: d.selfAfter,
          },
        },
        detectedAt: new Date(),
      })
      .returning();
    if (!change) continue;

    const classification: Classification = {
      category: "content",
      severity: d.severity,
      is_significant: true,
      reason,
      humanChangeBefore: pct(d.subjectBefore),
      humanChangeAfter: pct(d.subjectAfter),
    };
    await tasks.trigger("generate-signal", { changeId: change.id, classification });
    emitted++;
  }
  return emitted;
}
