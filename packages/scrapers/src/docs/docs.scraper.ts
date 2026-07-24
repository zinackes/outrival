import { normalizeHostname } from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "../types";
import { safeFetch } from "../lib/guarded-fetch";
import { collectSitemapUrls } from "../sitemap/parse";
import { discoverDocsRoot, type DiscoverDeps } from "./discover";
import {
  buildOpenApiDoc,
  buildOpenApiFacts,
  findSpecLinks,
  parseSpec,
  specCandidates,
} from "./openapi";
import {
  buildDocsPagesDoc,
  filterDocsUrls,
  hashDocsPages,
  pageHashEnabled,
  pageHashMax,
  selectPagesToHash,
} from "./pages";

/**
 * Developer-docs scraper — a competitor's technical roadmap surface. Two modes,
 * structured-first:
 *
 *   1. An OpenAPI / Swagger spec is published → the snapshot is the canonical, sorted
 *      operation + schema listing. The generic lexical diff then IS a structural diff
 *      (endpoint added/removed, field newly deprecated) at zero AI cost.
 *   2. No spec → the docs sitemap's page list (a new page = a newly documented
 *      feature) plus a bounded per-page content fingerprint.
 *
 * There is deliberately NO per-platform adapter (Mintlify / Docusaurus / Redoc): the
 * generic sitemap mode covers them, and a platform matrix would be a maintenance
 * surface with no extra signal.
 *
 * Pure fetch — docs and specs are served as text; no browser cascade.
 *
 * ## The mode-flip guard (the load-bearing detail)
 *
 * If run N resolves mode 1 and run N+1 silently drops to mode 2, the lexical diff
 * reads "every line removed, every line added" — one enormous phantom signal. So a
 * spec probe only counts as a NEGATIVE on a definitive answer (a 4xx, or a body that
 * is not a spec). Any transient failure (5xx / timeout / network) with no spec found
 * throws `spec_probe_failed` and is retried, rather than degrading. The resolved mode
 * is also named in the snapshot's header line, so a genuine mode change is at least
 * readable in the diff instead of arriving unexplained.
 */

const SPEC_TIMEOUT_MS = 10_000;
const PAGE_TIMEOUT_MS = 10_000;
const SITEMAP_TIMEOUT_MS = 10_000;

// Docs sitemaps are small next to a site-wide one; cap well below the sitemap
// scraper's 5000 so a mis-filtered site-wide sitemap can't balloon the snapshot.
const MAX_DOCS_URLS = 2000;

const UA = "OutrivalBot/1.0 (competitive monitoring; +https://outrival.io)";

/** A fetch outcome that keeps "definitely absent" apart from "couldn't tell". */
type Probe =
  | { kind: "body"; text: string }
  | { kind: "absent" }
  | { kind: "transient" };

async function probeText(url: string, accept: string, timeoutMs: number): Promise<Probe> {
  try {
    const res = await safeFetch(url, {
      timeoutMs,
      headers: { "user-agent": UA, accept },
    });
    if (res.ok) return { kind: "body", text: await res.text() };
    // 4xx = the resource is not there / not public. Under the collection doctrine we
    // never work around a refusal, so for discovery purposes that IS absence.
    if (res.status >= 400 && res.status < 500) return { kind: "absent" };
    return { kind: "transient" }; // 5xx
  } catch {
    return { kind: "transient" }; // timeout / network / unsafe redirect
  }
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: SITEMAP_TIMEOUT_MS,
      headers: { "user-agent": UA, accept: "application/xml, text/xml, */*" },
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const probe = await probeText(url, "text/html", PAGE_TIMEOUT_MS);
  return probe.kind === "body" ? probe.text : null;
}

/** Sitemap URLs declared in the docs origin's robots.txt (`Sitemap: <url>`). */
async function sitemapsFromRobots(origin: string): Promise<string[]> {
  const bytes = await fetchBytes(`${origin}/robots.txt`);
  if (!bytes) return [];
  const text = Buffer.from(bytes).toString("utf-8");
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** Everything the scraper touches over the network, injectable for tests. */
export interface DocsDeps extends DiscoverDeps {
  probeText?: typeof probeText;
  fetchBytes?: (url: string) => Promise<Uint8Array | null>;
  fetchHtml?: (url: string) => Promise<string | null>;
}

/** Mode 1 result: a parsed spec, or why we couldn't get one. */
interface SpecResolution {
  specUrl: string;
  spec: Record<string, unknown>;
}

async function resolveSpec(
  docsRoot: string,
  origin: string,
  rootHtml: string | null,
  probe: typeof probeText,
): Promise<{ found: SpecResolution | null; transient: boolean }> {
  const linked = rootHtml ? findSpecLinks(rootHtml, docsRoot) : [];
  // Linked first: a hosted docs platform points its renderer at the REAL spec, which
  // is usually not on a conventional path.
  const candidates = [...linked, ...specCandidates(docsRoot, origin)];
  const tried = new Set<string>();
  let transient = false;

  for (const url of candidates) {
    if (tried.has(url)) continue;
    tried.add(url);
    const result = await probe(url, "application/json, application/yaml, text/yaml, */*", SPEC_TIMEOUT_MS);
    if (result.kind === "transient") {
      transient = true;
      continue;
    }
    if (result.kind === "absent") continue;
    const spec = parseSpec(result.text, url);
    if (spec) return { found: { specUrl: url, spec }, transient };
    // A 200 that isn't a spec is a definitive negative — a `package.json` or a docs
    // config sitting at a conventional path must never pin the source into mode 1.
  }
  return { found: null, transient };
}

async function resolveDocsPages(
  docsRoot: string,
  fetchSitemapBytes: (url: string) => Promise<Uint8Array | null>,
): Promise<string[]> {
  let root: URL;
  try {
    root = new URL(docsRoot);
  } catch {
    return [];
  }
  const base = docsRoot.endsWith("/") ? docsRoot : `${docsRoot}/`;
  const roots = [
    ...(await sitemapsFromRobots(root.origin)),
    new URL("sitemap.xml", base).toString(),
    `${root.origin}/sitemap.xml`,
    `${root.origin}/sitemap_index.xml`,
  ];

  const tried = new Set<string>();
  for (const candidate of roots) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const urls = await collectSitemapUrls(candidate, {
      fetchBytes: fetchSitemapBytes,
      maxUrls: MAX_DOCS_URLS,
    });
    const docs = filterDocsUrls(urls, docsRoot);
    if (docs.length > 0) return docs;
  }
  return [];
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
  deps: DocsDeps = {},
): Promise<ScrapeOutcome> {
  const probe = deps.probeText ?? probeText;
  const getBytes = deps.fetchBytes ?? fetchBytes;
  const getHtml = deps.fetchHtml ?? fetchHtml;

  const domain = normalizeHostname(url);
  if (!domain) throw new Error("docs: no registrable domain from competitor URL");

  // `url` is `monitor.config.url ?? competitor.url` (scrape-monitor), so a user URL
  // override is honoured verbatim by discoverDocsRoot's looksLikeDocsUrl short-circuit.
  const root = await discoverDocsRoot(url, {
    reachable: deps.reachable,
    fetchHtml: deps.fetchHtml,
  });
  // A competitor with no public developer docs is a stable, neutral fact — the
  // coverage model maps this exact message to "not available" rather than a failure
  // (see NO_TARGET_MARKERS in @outrival/shared).
  if (!root) throw new Error("docs: no_docs_surface");

  const rootUrl = new URL(root.url);
  const rootHtml = await getHtml(root.url);

  const { found, transient } = await resolveSpec(root.url, rootUrl.origin, rootHtml, probe);
  if (found) {
    const facts = buildOpenApiFacts(found.spec);
    const doc = buildOpenApiDoc(facts, { domain, specUrl: found.specUrl });
    return {
      html: doc.html,
      text: doc.text,
      screenshotBuffer: Buffer.alloc(0),
      metadata: {
        url: root.url,
        scrapedWith: "docs",
        mode: "openapi",
        rootSource: root.source,
        specUrl: found.specUrl,
        endpoints: facts.operations.length,
        schemas: facts.schemas.length,
      },
      statusCode: 200,
      level: 0,
      attempts: 1,
    };
  }
  // Mode-flip guard: we cannot tell "no spec" from "the spec host was down", and
  // guessing costs a phantom whole-document diff. Retry instead.
  if (transient) throw new Error("docs: spec_probe_failed");

  const pages = await resolveDocsPages(root.url, getBytes);
  if (pages.length === 0) {
    // The docs surface exists but exposes no index we can enumerate. Distinct from
    // no_docs_surface on purpose: this one is actionable (the user can point us at a
    // better URL), so it stays a normal failure rather than a neutral absence.
    throw new Error("docs: no_docs_index");
  }

  const hashes = pageHashEnabled()
    ? await hashDocsPages(selectPagesToHash(pages, pageHashMax()), getHtml)
    : [];

  const doc = buildDocsPagesDoc(pages, hashes, { domain, docsRoot: root.url });
  return {
    html: doc.html,
    text: doc.text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      url: root.url,
      scrapedWith: "docs",
      mode: "sitemap",
      rootSource: root.source,
      pages: pages.length,
      hashedPages: hashes.length,
    },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}
