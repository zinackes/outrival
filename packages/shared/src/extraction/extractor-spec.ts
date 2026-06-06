import { z } from "zod";

/**
 * A cached, deterministic extractor for one (domain, sourceType) couple
 * (patch-30, "cache de parser" stage). Generated once by the AI self-heal step
 * (@outrival/ai), persisted in Postgres (`parser_extractors`), then replayed on
 * every subsequent scrape WITHOUT any AI call (@outrival/scrapers `replayExtractor`).
 *
 * The spec is a CLOSED, declarative format — never code. The replayer only ever
 * runs a CSS selector + one whitelisted transform per field, so a generated or
 * persisted spec can never execute arbitrary logic (no eval, no XPath functions).
 * That keeps the cheapest hot-path stage safe to feed from an LLM.
 */

// Whitelisted value transforms. A field reads a node (text or attribute), then
// applies exactly one of these. Adding a transform here is the only way to widen
// what a cached extractor can do — keep the set small and total.
export const EXTRACTOR_TRANSFORMS = ["text", "trim", "number", "lower"] as const;
export type ExtractorTransform = (typeof EXTRACTOR_TRANSFORMS)[number];

export const ExtractorFieldSchema = z.object({
  /** CSS selector, resolved relative to each list item (or to the document when
   *  the spec has no `list`). Bounded length so a generated spec stays sane. */
  selector: z.string().min(1).max(400),
  /** Attribute to read instead of the text node, e.g. "href", "content",
   *  "datetime". Omitted → the element's text content. */
  attr: z.string().min(1).max(60).optional(),
  /** Post-processing applied to the raw value. Default: "trim". "number" strips
   *  currency symbols / thousands separators and parses a float (null if none). */
  transform: z.enum(EXTRACTOR_TRANSFORMS).optional(),
  /** Value substituted when the selector matches nothing — keeps an otherwise
   *  valid item from being dropped (e.g. department → "Other"). */
  default: z.union([z.string(), z.number(), z.null()]).optional(),
  /** When true, a missing match yields null for this field instead of dropping
   *  the whole item. Mutually useful with optional schema fields downstream. */
  nullable: z.boolean().optional(),
});
export type ExtractorField = z.infer<typeof ExtractorFieldSchema>;

export const ExtractorSpecSchema = z.object({
  /** Monotonic version, bumped on every self-heal regeneration. */
  version: z.number().int().positive(),
  /** CSS selector for the repeated item container (pricing plans, job rows…).
   *  Omitted → the extractor yields a single object from `fields` at document
   *  scope (e.g. review aggregate score + count). */
  list: z.string().min(1).max(400).optional(),
  /** Field name → how to extract it. The downstream Zod schema (PricingSchema,
   *  JobsSchema…) validates the assembled object/array. */
  fields: z.record(z.string(), ExtractorFieldSchema),
});
export type ExtractorSpec = z.infer<typeof ExtractorSpecSchema>;

/** The four resolution stages, logged per extraction to the `extraction_runs`
 *  table — the dashboard's direct arbiter of AI cost (patch-30). */
export const EXTRACTION_RESOLUTIONS = ["structured", "cache", "heal", "ai_fallback"] as const;
export type ExtractionResolution = (typeof EXTRACTION_RESOLUTIONS)[number];
