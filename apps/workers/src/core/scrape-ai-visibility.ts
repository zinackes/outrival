import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  competitors,
  organizations,
  aiVisibilityPrompts,
  aiVisibilityResults,
  products,
  productCompetitors,
  monitors,
  snapshots,
  changes,
} from "@outrival/db";
import {
  computeHash,
  uploadToR2,
  visibilityHumanChange,
  visibilityHumanChangeSides,
  VISIBILITY_MIN_RUNS,
  VISIBILITY_WINDOW_DAYS,
} from "@outrival/shared";
import { extractAiVisibility, AI_CONFIG, type Classification } from "@outrival/ai";
import { EngineQuotaError, queryEngine, type Engine } from "../lib/ai-visibility/engines";
import { insertAiVisibilityResults, loggedAi, type AiVisibilityResultRow } from "../lib/analytics";
import { promptNamesSubject } from "../lib/ai-visibility/diff";
import {
  computeVisibilityShifts,
  shiftRawDiff,
  subjectsInCooldown,
  type SubjectShift,
} from "../lib/ai-visibility/shift";
import { textNamesSubject } from "../lib/ai-visibility/match";
import { buildVisibilityPromptInput, seedVisibilityPrompts } from "../lib/ai-visibility/seed";
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
  // The daily drip enqueues ONE product at a time, because it only schedules what the
  // day's free-tier budget can pay for and a product's share-of-voice is meaningless
  // over half its prompt set. Absent on the on-demand "Run now" route, which still
  // sweeps every active product of the org.
  productId: z.string().optional(),
  // Set by the on-demand "Run now" route → drop a durable "run complete" notification
  // when the run lands (it resolves ~a minute later, off the page). The scheduler
  // omits it, so an automated run stays silent.
  notifyOnComplete: z.boolean().optional(),
});

// gemini first — it's the FREE default (Google Search grounding free tier). perplexity
// only runs if PERPLEXITY_API_KEY is set (else queryEngine returns null and it's skipped),
// so no key = gemini-only = $0. OpenAI + Google AIO land in phase 5.
const ENGINES: Engine[] = ["gemini", "perplexity"];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/scrape-ai-visibility.job.ts (deleted at the
// cutover). The body is byte-identical to the pre-migration job — only the
// header and the signature change, so the two runtimes cannot drift.
export async function runScrapeAiVisibility(payload: z.input<typeof InputSchema>) {
    const { orgId, productId, notifyOnComplete } = InputSchema.parse(payload);

    // Kill-switch: explicit "false" disables; missing key disables (no cost incurred).
    if (process.env.AI_VISIBILITY_ENABLED === "false") {
      logger.log("ai-visibility disabled by kill-switch, skipping", { orgId });
      return { skipped: true, reason: "disabled" };
    }
    const maxPrompts = Number(process.env.AI_VISIBILITY_MAX_PROMPTS ?? 10);
    // Minimum RUNS a window must hold, on BOTH sides, before a shift between them is
    // trustworthy enough to signal on (P5). This replaced a per-run prompt floor: the
    // floor guarded against a quota-starved sweep faking a swing, but it could not guard
    // against the engine simply answering differently on two healthy runs, which is the
    // failure that actually filled the feed.
    const minRuns = Number(process.env.AI_VISIBILITY_MIN_RUNS_FOR_SIGNAL ?? VISIBILITY_MIN_RUNS);

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) throw new AbortTaskRunError(`Org ${orgId} not found`);
    logger.log("Starting scrape-ai-visibility", { orgId, plan: org.plan });

    // patch-28 (phase B): AI Visibility is per-product. Track each active SKU
    // independently — its own self, its own linked competitors, its own prompt set,
    // its own SoV baseline. One shared runId groups the whole sweep; rows are tagged
    // with product_id so reads + the diff scope to a single product.
    const productList = await db.query.products.findMany({
      where: and(
        eq(products.orgId, orgId),
        ne(products.status, "archived"),
        ...(productId ? [eq(products.id, productId)] : []),
      ),
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
    // Engines that reported a quota wall this run — skipped for every later prompt.
    const exhausted = new Set<Engine>();

    for (const product of productList) {
      // Roster for this product = its self product + its linked competitors (non-deleted).
      const self = await db.query.competitors.findFirst({
        where: and(eq(competitors.id, product.selfCompetitorId), isNull(competitors.deletedAt)),
        columns: { id: true, name: true, category: true, url: true, selfProfile: true },
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
        const promptInput = buildVisibilityPromptInput(
          self ?? { name: null, category: null },
          linked.map((c) => c.name),
        );
        const seeds = await seedVisibilityPrompts(promptInput, maxPrompts);
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
      // Least-recently-answered first. It costs one query and it removes a starvation
      // mode: if a run is ever cut short, it is cut short on the prompts that were
      // just refreshed, never on the same tail every time.
      prompts = (await orderByOldestCheck(prompts)).slice(0, maxPrompts);

      const subjectNames = roster.map((c) => c.name);
      const productRows: AiVisibilityResultRow[] = [];

      for (const prompt of prompts) {
        for (const engine of ENGINES) {
          if (exhausted.has(engine)) continue;
          let res;
          try {
            // The prompt's row id is the model key: which of the engine's models
            // answers must not change from one run to the next, or the trend line
            // silently changes writer and reads as a share-of-voice move.
            res = await queryEngine(engine, prompt.prompt, prompt.id);
          } catch (err) {
            if (!(err instanceof EngineQuotaError)) throw err;
            // Quota is per project, so the remaining prompts of this run would all
            // 429 too. Drop the engine here instead of hammering a closed door.
            exhausted.add(engine);
            logger.warn("Engine quota exhausted, skipping it for the rest of the run", {
              orgId,
              engine,
              body: err.body,
            });
            continue;
          }
          if (!res) continue; // missing key / API error — best-effort, skip
          totalQueries++;

          const extraction = await loggedAi(
            "extract_ai_visibility",
            AI_CONFIG.classification,
            () => extractAiVisibility(res.answer, subjectNames),
            { orgId },
          );
          if (!extraction) continue;

          // Index the model's verdicts by normalized subject name (identity is trusted
          // from the ROSTER, never the model — unmatched names are ignored).
          const verdict = new Map(extraction.mentions.map((m) => [norm(m.name), m]));
          const excerpt = res.answer.slice(0, 2000);

          // One row per roster subject, mentioned or not, so share-of-voice is derivable.
          const rows: AiVisibilityResultRow[] = roster.map((c) => {
            const v = verdict.get(norm(c.name));
            // Deterministic guard: trust the model's mentioned=true only when the
            // subject's name actually appears in the answer. The classifier tends to
            // confirm any name handed to it in <subjects>, inventing phantom mentions
            // (especially the self) — this drops those false positives.
            const mentioned = (v?.mentioned ?? false) && textNamesSubject(res.answer, c.name);
            return {
              org_id: orgId,
              prompt_id: prompt.id,
              competitor_id: c.id,
              product_id: product.id,
              engine,
              mentioned,
              // Seeded when the prompt itself names this subject → excluded from organic SoV.
              prompt_named: promptNamesSubject(prompt.prompt, c.name),
              rank: mentioned ? v?.rank ?? null : null,
              cited: mentioned ? v?.cited ?? null : null,
              sentiment_score: mentioned ? v?.sentiment ?? null : null,
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

      // P5: signal on the WINDOW, never on this run. The rows this run just wrote are
      // part of the current window's average — the sweep is the trigger to re-measure,
      // not the thing being measured.
      if (productRows.length > 0) {
        const shifts = await computeVisibilityShifts({
          orgId,
          productId: product.id,
          rosterIds: roster.map((c) => c.id),
          selfId: self?.id ?? null,
          now,
          minRuns,
        });
        if (shifts.length > 0) {
          const cooling = await subjectsInCooldown(shifts.map((s) => s.competitorId), now);
          const fresh = shifts.filter((s) => !cooling.has(s.competitorId));
          const nameById = new Map(roster.map((c) => [c.id, c.name]));
          const urlById = new Map(roster.map((c) => [c.id, c.url ?? null]));
          signalled += await emitVisibilitySignals(fresh, nameById, urlById);
        }
      }
    }

    // A run is DEGRADED when no engine ever answered (totalQueries === 0): a missing
    // engine key, an API error, or an exhausted quota makes queryEngine return null
    // for every prompt, so nothing is written and the board stays empty. Don't let
    // that masquerade as a successful, populated run — it's the difference between
    // "your latest results are ready" and "we couldn't reach the answer engine".
    const engineReached = totalQueries > 0;

    logger.log("Completed scrape-ai-visibility", {
      orgId,
      products: productList.length,
      prompts: totalPrompts,
      queries: totalQueries,
      rowsWritten: totalRows,
      signalled,
      degraded: !engineReached,
    });

    if (notifyOnComplete) {
      await notifyJobComplete(
        engineReached
          ? {
              orgId,
              title: "AI Visibility run complete",
              body: `We checked ${totalPrompts} prompt${totalPrompts === 1 ? "" : "s"} across ${productList.length} product${productList.length === 1 ? "" : "s"}. Your latest results are ready to view.`,
              linkUrl: "/dashboard/ai-visibility",
            }
          : {
              orgId,
              title: "AI Visibility run couldn't reach the answer engine",
              body: "The AI answer engine didn't respond, so this run produced no results. This is usually a temporary engine or quota issue — try again shortly.",
              linkUrl: "/dashboard/ai-visibility",
            },
      );
    }

    return {
      products: productList.length,
      prompts: totalPrompts,
      queries: totalQueries,
      rowsWritten: totalRows,
      signalled,
      degraded: !engineReached,
      runId,
    };
}

/**
 * Sort a product's prompts by when each was last answered, oldest first (never
 * answered sorts to the front). Best-effort: on a read error the caller's original
 * order stands, which is exactly today's behaviour.
 */
async function orderByOldestCheck<T extends { id: string }>(prompts: T[]): Promise<T[]> {
  if (prompts.length < 2) return prompts;
  try {
    const rows = await db
      .select({
        promptId: aiVisibilityResults.promptId,
        lastAt: sql<string>`max(${aiVisibilityResults.recordedAt})`,
      })
      .from(aiVisibilityResults)
      .where(inArray(aiVisibilityResults.promptId, prompts.map((p) => p.id)))
      .groupBy(aiVisibilityResults.promptId);
    const lastAt = new Map(rows.map((r) => [r.promptId, new Date(r.lastAt).getTime()]));
    return [...prompts].sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0));
  } catch (err) {
    logger.warn("ai-visibility: could not order prompts by last check", { err: String(err) });
    return prompts;
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * What the feed reads, and what the classifier is handed.
 *
 * `diffText` opens on the locked line so the change reads the same everywhere it is
 * quoted, then states who it is about. The engines and the answer count travel with
 * the rate because a percentage without its denominator invites a confidence the
 * sample does not carry.
 */
function shiftCopy(s: SubjectShift, name: string): { diffText: string; reason: string } {
  const subject = s.isSelf ? "Your product" : name;
  const { current, previous, driver, direction } = s.shift;
  const headline = visibilityHumanChange(s.shift);
  const verb = direction === "down" ? "fell" : "rose";

  if (driver === "mention_rate") {
    return {
      diffText:
        `${headline}. ${subject} ${verb} from being named in ${previous.mentions} of ` +
        `${previous.answers} AI answers over the previous ${VISIBILITY_WINDOW_DAYS} days to ` +
        `${current.mentions} of ${current.answers} over the last ${VISIBILITY_WINDOW_DAYS}.`,
      reason: s.isSelf
        ? `Your product's AI answer visibility ${verb} to ${pct(current.mentionRate)}`
        : `${name}'s AI answer visibility ${verb} to ${pct(current.mentionRate)}`,
    };
  }
  return {
    diffText:
      `${headline}. When named, ${subject} now appears at position ` +
      `${current.avgRank?.toFixed(1) ?? "—"} on average, against ` +
      `${previous.avgRank?.toFixed(1) ?? "—"} over the previous ${VISIBILITY_WINDOW_DAYS} days.`,
    reason: s.isSelf
      ? `Your product ${verb} in AI answer ordering`
      : `${name} ${verb} in AI answer ordering`,
  };
}

// Anchor each meaningful shift into the existing signal pipeline. The ai_visibility
// monitor is infra (isActive=false → never scheduled / handled by getScraper); it and
// the snapshot exist only to satisfy the changes FK chain, exactly like tech_stack.
async function emitVisibilitySignals(
  shifts: SubjectShift[],
  nameById: Map<string, string>,
  urlById: Map<string, string | null>,
): Promise<number> {
  let emitted = 0;
  for (const s of shifts) {
    const name = nameById.get(s.competitorId) ?? "A competitor";
    const { diffText, reason } = shiftCopy(s, name);
    const sides = visibilityHumanChangeSides(s.shift);

    let monitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.competitorId, s.competitorId),
        eq(monitors.sourceType, "ai_visibility"),
      ),
    });
    if (!monitor) {
      [monitor] = await db
        .insert(monitors)
        .values({
          competitorId: s.competitorId,
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
    const r2Key = `snapshots/${s.competitorId}/ai_visibility/${timestamp}`;
    await uploadToR2(`${r2Key}.txt`, diffText, "text/plain; charset=utf-8", { compress: true });

    const [snapshot] = await db
      .insert(snapshots)
      .values({
        monitorId: monitor.id,
        r2Key,
        contentHash: computeHash(`ai_visibility_shift:${s.competitorId}:${diffText}`),
        status: "success",
        scrapedAt: new Date(),
        resolvedUrl: urlById.get(s.competitorId) ?? null,
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
        rawDiff: shiftRawDiff(s),
        detectedAt: new Date(),
      })
      .returning();
    if (!change) continue;

    // MEDIUM, always. A share-of-model move is measured through an LLM's own
    // variance, and no amount of averaging makes it the kind of fact that should
    // page anyone — the severity guard demotes ai_visibility criticals anyway, and
    // claiming "high" here would only spend the reader's trust on a rate.
    const classification: Classification = {
      category: "content",
      severity: "medium",
      is_significant: true,
      reason,
      humanChangeBefore: sides.before,
      humanChangeAfter: sides.after,
    };
    await generateSignal.enqueue({ changeId: change.id, classification });
    emitted++;
  }
  return emitted;
}
