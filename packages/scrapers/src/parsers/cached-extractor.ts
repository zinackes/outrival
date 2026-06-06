import * as cheerio from "cheerio";
import type { ExtractorSpec, ExtractorField, ExtractorTransform } from "@outrival/shared";
import { asPrice } from "../structured-data/json-ld";

/**
 * Deterministically replay a cached ExtractorSpec against fresh HTML (patch-30,
 * "cache de parser" stage). Pure cheerio, ZERO AI: each field runs one CSS selector
 * + one whitelisted transform. Never throws — a bad spec or a relaid-out page
 * yields null/[] so the caller falls through to AI self-heal.
 *
 * The output is `unknown`: the worker validates it against the source's own Zod
 * schema (PricingSchema / JobsSchema / …) before trusting it. With `spec.list` →
 * an array of row objects; without → a single object (e.g. review aggregate).
 */
export function replayExtractor(
  html: string,
  spec: ExtractorSpec,
): Record<string, unknown>[] | Record<string, unknown> | null {
  try {
    const $ = cheerio.load(html);
    type Selection = ReturnType<typeof $>;

    // `select` resolves a field selector within the current scope (a list row, or
    // the whole document). Closing over it keeps cheerio node types out of the API.
    const buildRow = (select: (selector: string) => Selection): Record<string, unknown> | null => {
      const out: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(spec.fields)) {
        const el = select(field.selector).first();
        if (el.length === 0) {
          if (field.default !== undefined) {
            out[name] = field.default;
            continue;
          }
          if (field.nullable) {
            out[name] = null;
            continue;
          }
          return null; // required field missing → drop the whole row
        }
        const raw = field.attr ? (el.attr(field.attr) ?? null) : el.text();
        out[name] = applyTransform(raw, field.transform);
      }
      return out;
    };

    if (spec.list) {
      const rows: Record<string, unknown>[] = [];
      $(spec.list).each((_, el) => {
        const $row = $(el);
        const row = buildRow((selector) => $row.find(selector));
        if (row) rows.push(row);
      });
      return rows; // [] is a valid "found none" — the caller's plausibility decides
    }

    return buildRow((selector) => $(selector));
  } catch {
    return null;
  }
}

function applyTransform(raw: string | null, transform?: ExtractorTransform): unknown {
  if (raw == null) return null;
  switch (transform) {
    case "number":
      return asPrice(raw); // strips currency / separators, returns float | null
    case "lower":
      return raw.trim().toLowerCase();
    case "text":
      return raw; // verbatim, no trim
    case "trim":
    default:
      return raw.trim();
  }
}

// Re-export so the worker imports field/spec helpers from one place if needed.
export type { ExtractorSpec, ExtractorField };
