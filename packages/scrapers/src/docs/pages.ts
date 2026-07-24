import { computeHash } from "@outrival/shared";
import { extractContent } from "../lib/extract-content";
import { docsIsland, type DocsDocument } from "./openapi";

/**
 * Mode 2 of the `docs` source: the competitor publishes documentation but no machine-
 * readable spec. The docs SITEMAP is then the broadest structured surface they expose
 * — a brand-new page under /docs is a newly documented feature, which is the same
 * "new capability" signal mode 1 reads off an added endpoint, one abstraction up.
 *
 * On top of the page list we hash a bounded, deterministically-chosen set of pages so
 * a REWRITTEN page (a changed limit, a removed guarantee, a new auth requirement)
 * surfaces too. The hash is taken over `extractContent` output — the exact text the
 * pipeline diffs — so a build id, a nonce or a rotating banner cannot churn it.
 *
 * Pure except `hashDocsPages`, whose fetcher is injected.
 */

const PAGE_HASH_DEFAULT_MAX = 20;
const PAGE_HASH_CONCURRENCY = 5;
const PAGE_HASH_LENGTH = 12;

export interface DocsPageHash {
  url: string;
  hash: string;
}

function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
}

/**
 * Keep only the sitemap URLs that belong to this docs surface: same host as the docs
 * root and under its path prefix. A docs SUBDOMAIN root (`https://docs.acme.com/`)
 * has an empty prefix, so its whole host qualifies; a path root (`acme.com/docs`)
 * keeps only `/docs/...`. Everything else in a site-wide sitemap (blog, pricing,
 * careers) is already covered by the sources that own it. Sorted output — that is
 * what makes the downstream diff map 1:1 to added/removed pages. Pure.
 */
export function filterDocsUrls(urls: string[], docsRoot: string): string[] {
  let root: URL;
  try {
    root = new URL(docsRoot);
  } catch {
    return [];
  }
  const prefix = root.pathname.replace(/\/+$/, "");
  const kept = new Set<string>();
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.hostname !== root.hostname) continue;
    if (prefix) {
      const path = u.pathname.replace(/\/+$/, "");
      if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    }
    u.hash = "";
    kept.add(u.toString());
  }
  return Array.from(kept).sort();
}

/** Whether per-page content hashing runs at all (ops kill-switch). */
export function pageHashEnabled(): boolean {
  return process.env.DOCS_PAGE_HASH_ENABLED !== "false";
}

/** How many pages get hashed per run. */
export function pageHashMax(): number {
  const raw = Number(process.env.DOCS_PAGE_HASH_MAX ?? PAGE_HASH_DEFAULT_MAX);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : PAGE_HASH_DEFAULT_MAX;
}

/**
 * The pages we hash, chosen DETERMINISTICALLY (shallowest path first, then
 * lexicographic) so the same site yields the same selection run after run — a
 * selection that drifted would fake "changed" lines on untouched pages.
 *
 * Accepted limitation: a brand-new SHALLOW page can displace the last selected one,
 * which reads as one stray removed hash line next to the genuine "+ new page" line.
 * Bounded, visible, and cheaper than hashing everything. Pure.
 */
export function selectPagesToHash(urls: string[], max: number): string[] {
  return [...urls]
    .sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b))
    .slice(0, max);
}

/**
 * Fetch and hash the selected pages with bounded concurrency. A page that fails to
 * fetch yields NO entry — never a placeholder hash, which the next successful run
 * would diff as a content change that never happened.
 */
export async function hashDocsPages(
  urls: string[],
  fetchHtml: (url: string) => Promise<string | null>,
): Promise<DocsPageHash[]> {
  const out: DocsPageHash[] = [];
  const queue = [...urls];
  const worker = async (): Promise<void> => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const html = await fetchHtml(url);
      if (html === null) continue;
      out.push({ url, hash: computeHash(extractContent(html, "docs")).slice(0, PAGE_HASH_LENGTH) });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PAGE_HASH_CONCURRENCY, queue.length) }, () => worker()),
  );
  return out.sort((a, b) => a.url.localeCompare(b.url));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render the mode-2 snapshot. Same shape as mode 1: a stable grounding sentence, a
 * counts header, then one annotated line per fact. The mode is NAMED in the header so
 * a mode flip (spec disappearing) is at least readable in the diff instead of
 * arriving as an unexplained full-document rewrite.
 */
export function buildDocsPagesDoc(
  pages: string[],
  hashes: DocsPageHash[],
  ctx: { domain: string; docsRoot: string },
): DocsDocument {
  const intro = `Developer documentation for ${ctx.domain} — the pages this vendor publishes about how their product works. A new page is a newly documented capability.`;
  const header =
    `Docs pages at ${ctx.docsRoot} — ${pages.length} pages` +
    (hashes.length > 0 ? `, ${hashes.length} content-tracked` : "") +
    ` (source: docs sitemap)`;

  const lines = [
    ...pages.map((u) => `${u} — documentation page`),
    ...hashes.map((h) => `page ${h.url} — documented content fingerprint ${h.hash}`),
  ];

  const text = [intro, header, ...lines].join("\n");
  const html =
    `<!doctype html><html><body><section data-outrival-docs="sitemap">` +
    `<p>${escapeHtml(intro)}</p><h2>${escapeHtml(header)}</h2>` +
    `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul></section>` +
    docsIsland({ mode: "sitemap", docsRoot: ctx.docsRoot, pages, hashes }) +
    `</body></html>`;

  return { html, text };
}
