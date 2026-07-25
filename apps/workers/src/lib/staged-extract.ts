import { and, eq } from "drizzle-orm";
import type { ZodType } from "zod";
import { logger } from "./job-logger";
import { db, parserExtractors } from "@outrival/db";
import {
  normalizeDomain,
  ExtractorSpecSchema,
  type SourceType,
  type ExtractorSpec,
  type ExtractionResolution,
} from "@outrival/shared";
import { replayExtractor } from "@outrival/scrapers/cached-extractor";
import { pruneHtmlForSelectors } from "@outrival/scrapers/prune-html";
import { generateExtractor, AI_CONFIG, type ExtractorKind } from "@outrival/ai";
import { logExtractionRun, loggedAi } from "./analytics";
import { shouldTrustCachedExtractor } from "./extractor-trust";
import { normalizeReplayOutput } from "./replay-normalize";

/**
 * The staged extraction orchestrator (patch-30). Moves AI off the hot path: tries
 * structured-first (0 AI) → a cached deterministic parser (0 AI) → AI self-heal
 * (regenerates + caches the parser, rare) → and only then the direct AI extraction
 * that is the CURRENT behaviour. That last stage is the FLOOR: nothing the new
 * stages do can produce a worse result than today, and STAGED_EXTRACTION_ENABLED=false
 * skips straight to it. Every call logs its resolution to the extraction_runs table.
 */

const STAGED_ENABLED = process.env.STAGED_EXTRACTION_ENABLED !== "false";
const HEAL_COOLDOWN_MS =
  Number(process.env.EXTRACTOR_HEAL_COOLDOWN_HOURS ?? 12) * 3_600_000;

// R8 — a cached spec expires and is regenerated against the current DOM, so a
// drifted selector producing wrong-but-plausible data can't be trusted forever.
// See lib/extractor-trust.
const EXTRACTOR_REVALIDATE_MS =
  Number(process.env.EXTRACTOR_REVALIDATE_INTERVAL_DAYS ?? 14) * 86_400_000;
const EXTRACTOR_MAX_FAILURES = Number(process.env.EXTRACTOR_MAX_CONSECUTIVE_FAILURES ?? 5);

export interface StagedExtractInput<T> {
  /** Selector-generatable source. Reviews are handled separately (see §8). */
  kind: ExtractorKind; // "pricing" | "jobs"
  sourceType: SourceType;
  competitorId: string;
  html: string;
  url: string | null;
  /** Validates the assembled shape (the source's own Zod schema). */
  schema: ZodType<T>;
  /** "Did a stage actually extract data?" gate — rejects empty/implausible results
   *  for structured/cache/heal so the pipeline keeps falling through. NOT applied
   *  to the AI fallback (an empty result there is a legitimate "no public data"). */
  plausible: (data: T) => boolean;
  /** Structured-first mapper (schema.org → shape | null). */
  structuredFn: (html: string) => unknown;
  /** Current direct AI extraction — the floor. Already logged to ai_runs by caller? No:
   *  wrapped here in loggedAi under `aiFallbackTask`. */
  aiFallback: (text: string) => Promise<T | null>;
  aiFallbackTask: string; // ai_runs task name, e.g. "extract_pricing"
  htmlToText: (html: string) => string;
}

export interface StagedExtractResult<T> {
  data: T | null;
  resolution: ExtractionResolution;
  version: number;
}

export async function stagedExtract<T>(
  input: StagedExtractInput<T>,
): Promise<StagedExtractResult<T>> {
  const domain = normalizeDomain(input.url);

  const validateSchema = (raw: unknown): T | null => {
    const parsed = input.schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  };
  const stageOk = (raw: unknown): T | null => {
    const data = validateSchema(raw);
    return data !== null && input.plausible(data) ? data : null;
  };

  const finish = async (
    data: T | null,
    resolution: ExtractionResolution,
    version: number,
  ): Promise<StagedExtractResult<T>> => {
    await logExtractionRun({
      competitor_id: input.competitorId,
      source_type: input.sourceType,
      domain: domain ?? "",
      resolution,
      extractor_version: version,
      ai_used: resolution === "heal" || resolution === "ai_fallback" ? 1 : 0,
      recorded_at: new Date(),
    });
    return { data, resolution, version };
  };

  const runFallback = async (): Promise<T | null> =>
    validateSchema(
      await loggedAi(
        input.aiFallbackTask,
        AI_CONFIG.classification,
        () => input.aiFallback(input.htmlToText(input.html)),
        { competitorId: input.competitorId },
      ),
    );

  // Flag off, or no host to key the cache on → straight to today's behaviour.
  if (!STAGED_ENABLED || !domain) {
    return finish(await runFallback(), "ai_fallback", 0);
  }

  // 1. Structured-first (schema.org JSON-LD): zero AI.
  const structured = stageOk(input.structuredFn(input.html));
  if (structured) return finish(structured, "structured", 0);

  // 2. Cached parser replay: zero AI.
  const cached = await db.query.parserExtractors.findFirst({
    where: and(
      eq(parserExtractors.domain, domain),
      eq(parserExtractors.sourceType, input.sourceType),
    ),
  });
  const cachedSpec = cached ? ExtractorSpecSchema.safeParse(cached.spec) : null;
  if (cached && cachedSpec?.success) {
    // R8: an expired (or repeatedly failing) spec is skipped entirely so the ladder
    // falls through to self-heal, which regenerates the selectors from the CURRENT
    // DOM. `lastValidatedAt` is therefore NOT stamped on a plain cache hit — only
    // upsertExtractor (a fresh generation) stamps it, otherwise it could never age.
    const trusted = shouldTrustCachedExtractor({
      lastValidatedAt: cached.lastValidatedAt,
      consecutiveFailures: cached.consecutiveFailures,
      now: Date.now(),
      revalidateMs: EXTRACTOR_REVALIDATE_MS,
      maxFailures: EXTRACTOR_MAX_FAILURES,
    });
    if (trusted) {
      const replayed = stageOk(
        normalizeReplayOutput(input.kind, replayExtractor(input.html, cachedSpec.data)),
      );
      if (replayed) {
        await db
          .update(parserExtractors)
          .set({ consecutiveFailures: 0 })
          .where(eq(parserExtractors.id, cached.id));
        return finish(replayed, "cache", cached.version);
      }
      await db
        .update(parserExtractors)
        .set({ consecutiveFailures: cached.consecutiveFailures + 1 })
        .where(eq(parserExtractors.id, cached.id));
    } else {
      logger.log("cached extractor due for revalidation — regenerating", {
        sourceType: input.sourceType,
        domain,
        consecutiveFailures: cached.consecutiveFailures,
      });
    }
  }

  // 3. AI self-heal: regenerate the parser (the only new AI call). Skipped while a
  //    freshly-failed extractor is in cooldown, so a durably-broken page doesn't
  //    burn a call every run — it rides the ai_fallback floor until cooldown lapses.
  const inCooldown =
    cached?.lastHealAttemptAt != null &&
    Date.now() - cached.lastHealAttemptAt.getTime() < HEAL_COOLDOWN_MS;
  if (!inCooldown) {
    try {
      const spec = await loggedAi(
        "generate_extractor",
        AI_CONFIG.classification,
        () => generateExtractor(input.kind, pruneHtmlForSelectors(input.html)),
        { competitorId: input.competitorId },
      );
      if (spec) {
        const version = (cached?.version ?? 0) + 1;
        const persisted: ExtractorSpec = { ...spec, version };
        const healed = stageOk(
          normalizeReplayOutput(input.kind, replayExtractor(input.html, persisted)),
        );
        if (healed) {
          await upsertExtractor(domain, input.sourceType, persisted, version, cached?.healCount ?? 0);
          return finish(healed, "heal", version);
        }
      }
      // Generated but didn't validate → persist the attempt so the cooldown arms
      // (nullable lastValidatedAt marks it never-validated) instead of re-paying the
      // generator on every scrape of a page we can't parse.
      if (spec) {
        const version = (cached?.version ?? 0) + 1;
        await db
          .insert(parserExtractors)
          .values({
            domain, sourceType: input.sourceType,
            spec: { ...spec, version }, version,
            healCount: cached?.healCount ?? 0,
            consecutiveFailures: (cached?.consecutiveFailures ?? 0) + 1,
            lastValidatedAt: null,
            lastHealAttemptAt: new Date(), updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [parserExtractors.domain, parserExtractors.sourceType],
            set: { lastHealAttemptAt: new Date(), consecutiveFailures: (cached?.consecutiveFailures ?? 0) + 1, updatedAt: new Date() },
          });
      } else if (cached) {
        // parse-failed generation: stamp the existing row only (nothing new to store)
        await db.update(parserExtractors)
          .set({ lastHealAttemptAt: new Date() })
          .where(eq(parserExtractors.id, cached.id));
      }
    } catch (err) {
      logger.warn("self-heal generate-extractor failed (non-fatal)", {
        sourceType: input.sourceType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. AI fallback — the floor (exactly today's extraction).
  return finish(await runFallback(), "ai_fallback", 0);
}

async function upsertExtractor(
  domain: string,
  sourceType: SourceType,
  spec: ExtractorSpec,
  version: number,
  priorHealCount: number,
): Promise<void> {
  const now = new Date();
  await db
    .insert(parserExtractors)
    .values({
      domain,
      sourceType,
      spec,
      version,
      healCount: priorHealCount + 1,
      consecutiveFailures: 0,
      lastValidatedAt: now,
      lastHealAttemptAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [parserExtractors.domain, parserExtractors.sourceType],
      set: {
        spec,
        version,
        healCount: priorHealCount + 1,
        consecutiveFailures: 0,
        lastValidatedAt: now,
        lastHealAttemptAt: now,
        updatedAt: now,
      },
    });
}
