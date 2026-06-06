import * as cheerio from "cheerio";

/**
 * Structured-data primitives (patch-30, structured-first stage). Pure cheerio —
 * no browser — so this subpath never pulls Patchright/Chromium. The mappers
 * (mappers.ts) turn these nodes into the same shapes the AI extractors produce,
 * letting a scrape resolve with ZERO AI whenever a site ships schema.org markup.
 */

type JsonLdNode = Record<string, unknown>;

/**
 * Parse every `<script type="application/ld+json">` block. Tolerant by design:
 * malformed JSON is skipped (sites ship broken blocks), arrays are flattened, and
 * `@graph` containers are expanded so a single block holding many entities yields
 * each one. Never throws — a bad page just yields fewer nodes.
 */
export function extractJsonLd(html: string): JsonLdNode[] {
  const $ = cheerio.load(html);
  const nodes: JsonLdNode[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // broken block — ignore, don't fail the whole extraction
    }
    collect(parsed, nodes);
  });
  return nodes;
}

function collect(value: unknown, out: JsonLdNode[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as JsonLdNode;
    const graph = obj["@graph"];
    if (Array.isArray(graph)) collect(graph, out);
    out.push(obj);
  }
}

/** schema.org `@type` is a string or a string[]; match case-insensitively. */
export function hasType(node: JsonLdNode, type: string): boolean {
  const t = node["@type"];
  const target = type.toLowerCase();
  if (typeof t === "string") return t.toLowerCase() === target;
  if (Array.isArray(t)) {
    return t.some((x) => typeof x === "string" && x.toLowerCase() === target);
  }
  return false;
}

export function findByType(nodes: JsonLdNode[], type: string): JsonLdNode[] {
  return nodes.filter((n) => hasType(n, type));
}

/**
 * Coerce a schema.org scalar to a trimmed string. Values arrive as strings,
 * numbers, `{ "@value": x }` wrappers, or single-element arrays — normalize all.
 */
export function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? asText(value[0]) : null;
  if (typeof value === "object") {
    const v = (value as JsonLdNode)["@value"];
    if (v != null) return asText(v);
  }
  return null;
}

/** Parse a price-like value ("$29.00", "29,00", 29) to a float, or null. */
export function asPrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = asText(value);
  if (!s) return null;
  // Strip currency symbols/letters and thousands separators, keep the last
  // decimal separator. Handles "1,299.00", "1.299,00", "€29".
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  let normalized: string;
  if (hasDot && hasComma) {
    // Both present: the rightmost separator is the decimal; the other is grouping.
    normalized =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    // Single separator: "1,234"/"12,345,678" is grouping; "29,99" is a decimal.
    normalized = /^\d{1,3}(,\d{3})+$/.test(cleaned)
      ? cleaned.replace(/,/g, "")
      : cleaned.replace(",", ".");
  } else if (hasDot) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(cleaned) ? cleaned.replace(/\./g, "") : cleaned;
  } else {
    normalized = cleaned;
  }
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export type { JsonLdNode };
