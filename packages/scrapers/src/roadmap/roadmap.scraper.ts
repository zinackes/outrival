import type { ScrapeOptions, ScrapeOutcome } from "../types";
import { safeFetch } from "../lib/guarded-fetch";
import { discoverRoadmapPortal, type RoadmapDiscoverDeps } from "./discover";
import { parseCannyPortal } from "./canny";
import {
  PORTAL_API_URL,
  matchProductboardPortal,
  parseProductboardPortal,
  type ProductboardTarget,
} from "./productboard";
import { buildRoadmapDoc } from "./snapshot";
import type { RoadmapParse, RoadmapPortal } from "./types";

/**
 * Public roadmap / feedback portal scraper (Canny, ProductBoard).
 *
 * Reads what the competitor has committed to build, and how hard their own customers
 * are pushing for each item. Pure L0 fetch on both vendors — Canny server-renders its
 * state island, ProductBoard exposes one unauthenticated portal endpoint — so there
 * is no browser and no AI anywhere on this path.
 *
 * The snapshot is a listing sorted by stable entry id (see `snapshot.ts`), which is
 * what lets the GENERIC lexical diff do the work: a status moving planned → in
 * progress, or a vote count crossing into a higher band, is exactly one `-`/`+` pair.
 * There is deliberately no branch in `scrape-monitor` and no rule in the classifier.
 *
 * ## Never an empty success
 *
 * Every "no result" path throws. An empty snapshot would become the baseline, and the
 * next run would diff it as "the entire roadmap was removed" — one enormous phantom
 * signal — after which the real content stays hidden under the empty baseline. The
 * thrown messages are meaningful, not decorative: `no_roadmap_portal`, `portal_empty`
 * and `portal_private` are matched by NO_TARGET_MARKERS (@outrival/shared) and read
 * as neutral "not available" states, while a parse failure on a portal we DID reach
 * stays a loud, retried failure.
 */

const PORTAL_TIMEOUT_MS = 15_000;

const UA = "OutrivalBot/1.0 (competitive monitoring; +https://outrival.io)";

/** Keeps "refused", "absent" and "couldn't tell" apart — each means something different. */
type Fetched =
  | { kind: "body"; text: string }
  | { kind: "denied" }
  | { kind: "absent" }
  | { kind: "transient" };

async function fetchPortal(url: string, headers: Record<string, string>): Promise<Fetched> {
  try {
    const res = await safeFetch(url, { timeoutMs: PORTAL_TIMEOUT_MS, headers });
    if (res.ok) return { kind: "body", text: await res.text() };
    // 401/403 is the portal telling us it is closed. Under the collection doctrine we
    // never work around a refusal — it is recorded as a fact about the portal.
    if (res.status === 401 || res.status === 403) return { kind: "denied" };
    if (res.status >= 400 && res.status < 500) return { kind: "absent" };
    return { kind: "transient" }; // 5xx
  } catch {
    return { kind: "transient" }; // timeout / network / unsafe redirect
  }
}

function fetchPortalHtml(url: string): Promise<Fetched> {
  return fetchPortal(url, { "user-agent": UA, accept: "text/html" });
}

function fetchPortalApi(target: ProductboardTarget): Promise<Fetched> {
  // The portal path is the ONLY scoping the endpoint takes — no key, no cookie.
  return fetchPortal(PORTAL_API_URL, {
    "user-agent": UA,
    accept: "application/json",
    "x-portal-path": target.portalPath,
  });
}

/** Everything the scraper touches over the network, injectable for tests. */
export interface RoadmapDeps extends RoadmapDiscoverDeps {
  fetchPortalHtml?: (url: string) => Promise<Fetched>;
  fetchPortalApi?: (target: ProductboardTarget) => Promise<Fetched>;
}

/** A ProductBoard portal served from the customer's own domain (no derivable path). */
function looksLikeProductboardShell(html: string): boolean {
  return /window\.pbCurrentPortalId\s*=/.test(html);
}

function fail(reason: string): never {
  throw new Error(`roadmap: ${reason}`);
}

/** Turn a parse failure into the thrown message that carries its meaning downstream. */
function failParse(result: Extract<RoadmapParse, { ok: false }>, vendorLabel: string): never {
  if (result.reason === "private") fail("portal_private");
  if (result.reason === "empty") fail("portal_empty");
  // A portal we reached and could not read is a real breakage — the vendor changed
  // its public payload. It must retry loudly rather than degrade into a guess: an
  // invented listing would diff as a wholesale roadmap rewrite.
  fail(`${vendorLabel}_parse_failed`);
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
  deps: RoadmapDeps = {},
): Promise<ScrapeOutcome> {
  const getHtml = deps.fetchPortalHtml ?? fetchPortalHtml;
  const getApi = deps.fetchPortalApi ?? fetchPortalApi;

  // `url` is `monitor.config.url ?? competitor.url`, so a user's URL override reaches
  // discovery verbatim and short-circuits it (looksLikePortalUrl).
  const candidate = await discoverRoadmapPortal(url, {
    reachable: deps.reachable,
    fetchHtml: deps.fetchHtml,
  });
  // A competitor with no public roadmap portal is a stable, neutral fact — coverage
  // maps this message to "not available" rather than to a failure.
  if (!candidate) fail("no_roadmap_portal");

  const portal = matchProductboardPortal(candidate.url)
    ? await readProductboard(candidate.url, getApi)
    : await readHtmlPortal(candidate.url, candidate.vendor === "canny", getHtml);

  const doc = buildRoadmapDoc(portal);
  return {
    html: doc.html,
    text: doc.text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      url: portal.url,
      scrapedWith: "roadmap",
      vendor: portal.vendor,
      discoveredVia: candidate.source,
      entries: portal.entries.length,
      truncated: portal.truncated,
      // Exact counts live here, never in the diff-bearing body — see snapshot.ts.
      votes: Object.fromEntries(portal.entries.map((e) => [e.id, e.votes])),
    },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}

async function readProductboard(
  url: string,
  getApi: (target: ProductboardTarget) => Promise<Fetched>,
): Promise<RoadmapPortal> {
  const target = matchProductboardPortal(url);
  if (!target) fail("no_roadmap_portal");

  const res = await getApi(target);
  // "Invalid space or portal" — the portal is gated, or no longer served publicly.
  if (res.kind === "denied") fail("portal_private");
  if (res.kind === "absent") fail("no_roadmap_portal");
  if (res.kind === "transient") fail("portal_fetch_failed");

  let payload: unknown;
  try {
    payload = JSON.parse(res.text);
  } catch {
    fail("productboard_parse_failed");
  }
  const parsed = parseProductboardPortal(payload, target);
  if (!parsed.ok) failParse(parsed, "productboard");
  return parsed.portal;
}

/**
 * Read an HTML-served portal. Canny renders its state island on its own subdomains
 * AND on customer custom domains, so the same parse covers both — which is why a
 * candidate discovered by subdomain probe (`vendor: null`) is tried here too.
 */
async function readHtmlPortal(
  url: string,
  vendorIsCanny: boolean,
  getHtml: (url: string) => Promise<Fetched>,
): Promise<RoadmapPortal> {
  const res = await getHtml(url);
  if (res.kind === "denied") fail("portal_private");
  if (res.kind === "absent") fail("no_roadmap_portal");
  if (res.kind === "transient") fail("portal_fetch_failed");

  const parsed = parseCannyPortal(res.text, url);
  if (parsed.ok) return parsed.portal;

  // A page we merely GUESSED might be a portal (a `feedback.` subdomain, a nav link)
  // and could not read is not a breakage — it is evidence there is no portal here.
  // Only a host that NAMES its vendor earns a loud parse failure.
  if (!vendorIsCanny && parsed.reason === "unparsable") {
    if (looksLikeProductboardShell(res.text)) {
      // ProductBoard on a customer domain: the portal API is scoped by a portal path
      // we cannot derive from this URL, so there is nothing here we can read.
      fail("no_roadmap_portal (productboard custom domain is not readable)");
    }
    fail("no_roadmap_portal");
  }
  failParse(parsed, "canny");
}
