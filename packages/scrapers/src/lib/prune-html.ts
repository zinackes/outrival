import * as cheerio from "cheerio";

const DEFAULT_MAX = Number(process.env.PRUNE_HTML_MAX_CHARS ?? 40000);

/**
 * Prune rendered HTML to the structural skeleton the selector generator needs
 * (patch-30, self-heal input). Unlike extractContent (text only), this KEEPS tags
 * and class/id/data-* attributes — the generator reasons over them to emit CSS
 * selectors — but strips script/style/svg/head noise and truncates long text nodes
 * (copy is irrelevant to selector shape and blows the token budget). The ≈67%
 * token reduction the patch calls for, adapted to the selector-generation case.
 *
 * Pure cheerio, capped at PRUNE_HTML_MAX_CHARS. Never throws.
 */
export function pruneHtmlForSelectors(html: string, maxChars = DEFAULT_MAX): string {
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
    return collapsed.length > maxChars ? collapsed.slice(0, maxChars) : collapsed;
  } catch {
    return html.slice(0, maxChars);
  }
}
