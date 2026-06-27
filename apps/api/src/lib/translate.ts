import { z } from "zod";
import { createHash } from "node:crypto";
import { complete, AI_CONFIG } from "@outrival/ai";

// On-demand translation of scraped competitor copy (foreign homepage facts) to
// English, via the existing AI provider pool (Cerebras free → Groq → …, patch-22).
// No extra dependency / account / key: the pool is already configured for the
// pipeline, and the volume here is tiny (a headline + a few value props + ≤3
// testimonials, only when a user clicks Translate on a foreign site).
//
// Cached in-process by content hash: the homepage facts only change on re-scrape,
// so identical input → instant cache hit, and new scraped copy naturally misses
// and re-translates. Per-instance cache (single VPS); fine at this scale.

const SYSTEM_PROMPT =
  "You are a professional translation engine. You receive a JSON array of short " +
  "text fragments scraped from a company's homepage (a headline, value-proposition " +
  "phrases, customer testimonials), each in some source language. Translate every " +
  "fragment into natural, fluent English. Preserve meaning and tone. Keep product " +
  "names, brand names and proper nouns unchanged. Do not add, merge, split, reorder " +
  "or omit fragments. Return ONLY a JSON object of the form " +
  '{"translations": ["...", "..."]} containing exactly the same number of strings, ' +
  "in the same order as the input.";

const MAX_CHARS_PER_ITEM = 5000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // facts change on re-scrape, not on a timer
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, { translations: string[]; expires: number }>();

const ResponseSchema = z.object({ translations: z.array(z.string()) });

export type TranslateResult =
  | { ok: true; translations: string[]; detectedLanguage: string | null }
  | { ok: false; error: "translation_failed" };

function cacheGet(key: string): string[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.translations;
}

function cacheSet(key: string, translations: string[]): void {
  // Cheap FIFO eviction — Map preserves insertion order, so the first key is oldest.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { translations, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Translate an ordered list of strings to English. Returns an array of the same
 * length and order (empty input → empty output string). Identical inputs are
 * de-duplicated before the model call, then mapped back. Results are cached by the
 * de-duplicated input's content hash. `detectedLanguage` is always null here (the
 * caller already knows the source language from <html lang>).
 */
export async function translateToEnglish(texts: string[]): Promise<TranslateResult> {
  // Unique, non-empty inputs only — repeated value props / quotes collapse to one
  // model entry; empties never reach the model.
  const unique = [
    ...new Set(texts.map((t) => t.trim()).filter((t) => t.length > 0)),
  ].map((t) => t.slice(0, MAX_CHARS_PER_ITEM));
  if (unique.length === 0) {
    return { ok: true, translations: texts.map(() => ""), detectedLanguage: null };
  }

  const key = createHash("sha256").update(JSON.stringify(unique)).digest("hex");

  let translated = cacheGet(key);
  if (!translated) {
    let raw: string;
    try {
      raw = await complete(AI_CONFIG.classification, {
        system: SYSTEM_PROMPT,
        prompt: JSON.stringify(unique),
        json: true,
      });
    } catch (err) {
      console.error("Translation model call failed", { error: String(err) });
      return { ok: false, error: "translation_failed" };
    }

    let parsed: z.infer<typeof ResponseSchema>;
    try {
      parsed = ResponseSchema.parse(JSON.parse(raw));
    } catch {
      return { ok: false, error: "translation_failed" };
    }
    // Guard against the model dropping/merging fragments — a misaligned array would
    // map the wrong English onto the wrong field.
    if (parsed.translations.length !== unique.length) {
      return { ok: false, error: "translation_failed" };
    }
    translated = parsed.translations;
    cacheSet(key, translated);
  }

  const map = new Map<string, string>();
  unique.forEach((original, i) => map.set(original, translated[i] ?? original));

  return {
    ok: true,
    // Re-expand to the caller's original order/length; empties stay empty. The map
    // is keyed by the sliced+trimmed form, so re-derive it per input.
    translations: texts.map((t) => {
      const k = t.trim().slice(0, MAX_CHARS_PER_ITEM);
      return k ? map.get(k) ?? t : "";
    }),
    detectedLanguage: null,
  };
}
