import * as cheerio from "cheerio";

const DEFAULT_MAX = Number(process.env.PRUNE_HTML_MAX_CHARS ?? 40000);

/**
 * What the data the generator is looking for LOOKS like, so an overflowing skeleton
 * can be windowed around it instead of truncated at the head. A currency next to
 * digits for pricing; nothing for other kinds, which keeps their behaviour identical.
 */
export const SELECTOR_ANCHORS: Record<string, RegExp | undefined> = {
  pricing: /[€$£¥]\s?\d|\d[\d.,]*\s?[€$£¥]/,
  // `jobs` has no anchor on purpose: a board's rows carry no token as distinctive
  // as a currency, and a wrong guess would move the window off the listing. Absent
  // anchor means the head slice, which is exactly today's behaviour.
};

/** Skeleton kept ahead of the anchor, so the section heading and the first plan
 *  name are in view and the generator can name a container, not just a price.
 *  Clamped to a quarter of the budget at call time: the point of the window is what
 *  comes AFTER the anchor, and an unclamped lead-in can consume the whole of a small
 *  budget and end the window on the very token it was aimed at. */
const ANCHOR_LEAD_IN = 4000;

/**
 * Prune rendered HTML to the structural skeleton the selector generator needs
 * (patch-30, self-heal input). Unlike extractContent (text only), this KEEPS tags
 * and class/id/data-* attributes — the generator reasons over them to emit CSS
 * selectors — but strips script/style/svg/head noise and truncates long text nodes
 * (copy is irrelevant to selector shape and blows the token budget). The ≈67%
 * token reduction the patch calls for, adapted to the selector-generation case.
 *
 * `anchor` fixes what the head slice got wrong. A pricing table sits below the nav,
 * the hero and the feature grid, and a tag-heavy skeleton reaches the cap long
 * before it reaches the prices — so the generator was handed a page with no pricing
 * in it and answered, correctly, that there was none. Measured on prod 2026-08-01:
 * 79 of the 90 pricing parsers that never validated hold a literally EMPTY spec
 * (`{version:1, fields:{}}`), the exact answer the prompt asks for when the data is
 * absent, while the AI floor — which is handed the page as TEXT — extracts pricing
 * from those same pages. Every page whose parser ever validated has under 21k of
 * text; the ones that come back empty run to 940k.
 *
 * This is the same repair `focusPricingText` already applies to the extraction
 * prompt's own input, for the same reason, and it is inert below the cap: a skeleton
 * that fits is returned exactly as before.
 *
 * Pure cheerio, capped at PRUNE_HTML_MAX_CHARS. Never throws.
 */
export function pruneHtmlForSelectors(
  html: string,
  opts: { maxChars?: number; anchor?: RegExp } = {},
): string {
  const maxChars = opts.maxChars ?? DEFAULT_MAX;
  try {
    const $ = cheerio.load(html);
    $(
      "script, style, noscript, svg, template, link, meta, iframe, object, embed, canvas, head",
    ).remove();
    // Selectors don't depend on copy: clip long text nodes to keep the skeleton
    // legible while slashing tokens.
    $("*")
      .contents()
      .each((_, node) => {
        if (node.type === "text" && node.data && node.data.length > 120) {
          node.data = `${node.data.slice(0, 120)}…`;
        }
      });
    const body = $("body").html() ?? $.root().html() ?? "";
    const collapsed = body.replace(/\s+/g, " ").trim();
    if (collapsed.length <= maxChars) return collapsed;
    return windowAroundAnchor(collapsed, maxChars, opts.anchor);
  } catch {
    return html.slice(0, maxChars);
  }
}

/**
 * Head slice unless the anchor is present and already past the cap — the only case
 * where the head is known to be the wrong window. Keeping the head whenever the
 * anchor falls inside it preserves the document's opening, which is where a
 * generator finds the outer containers it names in `list`.
 */
function windowAroundAnchor(collapsed: string, maxChars: number, anchor?: RegExp): string {
  if (!anchor) return collapsed.slice(0, maxChars);
  const idx = collapsed.search(anchor);
  if (idx < 0 || idx < maxChars) return collapsed.slice(0, maxChars);
  const leadIn = Math.min(ANCHOR_LEAD_IN, Math.floor(maxChars / 4));
  const start = Math.max(0, idx - leadIn);
  return collapsed.slice(start, start + maxChars);
}
