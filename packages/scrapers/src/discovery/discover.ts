import Exa from "exa-js";
import { extractBrand, extractHostname, normalizeDomain } from "@outrival/shared";
import { safeFetch } from "../lib/guarded-fetch";

// Free-hosting / website-builder / preview platforms. Exa surfaces these for
// well-known products (clones, templates, staging deploys) — never real
// competitors. Matched against the full hostname suffix.
const JUNK_HOST_SUFFIXES = [
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "github.io",
  "gitlab.io",
  "webflow.io",
  "framer.website",
  "framer.app",
  "wixsite.com",
  "web.app",
  "firebaseapp.com",
  "herokuapp.com",
  "onrender.com",
  "fly.dev",
  "myshopify.com",
  "notion.site",
  "super.site",
  "carrd.co",
  "softr.app",
  "bubbleapps.io",
  "glitch.me",
  "repl.co",
  "replit.app",
  "surge.sh",
  "azurewebsites.net",
  "translate.goog",
  "cargo.site",
  "durable.co",
];

function isJunkHost(host: string): boolean {
  return JUNK_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

// Social networks, company directories, review sites, app stores and press —
// Exa's "company" category routinely returns these when a product is well-known
// (e.g. the LinkedIn page of the user's OWN product, which then scores ~95% on
// overlap because its snippet describes the product itself). None of them is a
// competitor's actual product site, so they are never valid discovery results.
const SOCIAL_AGGREGATOR_HOSTS = [
  "linkedin.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "reddit.com",
  "medium.com",
  "substack.com",
  "crunchbase.com",
  "pitchbook.com",
  "tracxn.com",
  "owler.com",
  "similarweb.com",
  "g2.com",
  "capterra.com",
  "getapp.com",
  "softwareadvice.com",
  "trustpilot.com",
  "trustradius.com",
  "gartner.com",
  "producthunt.com",
  "wellfound.com",
  "angel.co",
  "glassdoor.com",
  "indeed.com",
  "wikipedia.org",
  "github.com",
  "gitlab.com",
  "apps.apple.com",
  "play.google.com",
  "bloomberg.com",
  "forbes.com",
  "techcrunch.com",
  "ycombinator.com",
];

function isSocialOrAggregatorHost(host: string): boolean {
  return SOCIAL_AGGREGATOR_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
}

const REACHABILITY_TIMEOUT_MS = 5000;
// Only the head + first scripts carry the parking signature (title/meta/provider
// script host), so a slice is enough — no need to buffer a whole page.
const PARKING_SCAN_CHARS = 30000;

// Domain-marketplace / parking providers. A defunct startup's domain gets resold
// and served by one of these — the page answers HTTP 200, so the reachability
// ping alone treats it as alive. Matched anywhere in the (sliced) HTML because the
// provider's script/CDN host is present even when the URL itself doesn't redirect.
const PARKING_HOST_SIGNATURES = [
  "domainmarket.com",
  "sedoparking.com",
  "afternic.com",
  "dan.com",
  "hugedomains.com",
  "bodis.com",
  "parkingcrew.net",
  "above.com",
  "undeveloped.com",
  "sav.com",
  "cashparking.com",
  "namebright.com",
  "fabulous.com",
  "smartname.com",
  "parklogic.com",
];

// For-sale / parking copy. Kept specific (always "domain …") so a legitimate SaaS
// that happens to say "for sale" isn't dropped.
const PARKING_TEXT_SIGNATURES = [
  "this domain is for sale",
  "this domain may be for sale",
  "domain is for sale",
  "domain available for sale",
  "buy this domain",
  "this domain is parked",
  "domain parking",
];

// A domain that answers HTTP is usually alive even behind anti-bot (403/503) or
// auth (401) — those are the product refusing US, not a missing site. But an
// explicit "the resource is not / no longer here" (404 Not Found, 410 Gone) means
// the URL Exa surfaced is dead: a decommissioned startup whose host still answers
// with a catch-all 404, or a removed page. Seeding a competitor on such a URL gives
// a monitor that fails forever, so drop it. Pure so it's unit-testable. For tests.
export function isDeadStatus(status: number): boolean {
  return status === 404 || status === 410;
}

// True when the fetched page is a parked / for-sale landing rather than a real
// product. Pure over already-lowercased HTML + the final (post-redirect) host so
// it's unit-testable without network. Exported for tests.
export function isParkedPage(finalHost: string, htmlLower: string): boolean {
  if (
    PARKING_HOST_SIGNATURES.some(
      (h) => finalHost === h || finalHost.endsWith(`.${h}`) || htmlLower.includes(h),
    )
  ) {
    return true;
  }
  return PARKING_TEXT_SIGNATURES.some((s) => htmlLower.includes(s));
}

// Exa surfaces defunct startups whose domain no longer resolves (expired, dead),
// has been resold and now serves a parking / for-sale page, or answers a catch-all
// 404 for the decommissioned site. A network-level failure (DNS miss, refused
// connection, timeout) means the domain is dead → drop it. A 404/410 means the URL
// is gone → drop it (isDeadStatus). ANY other HTTP response — even a 403/503 from
// anti-bot or a 401 behind auth — means the site is alive, UNLESS the body is a
// known domain-marketplace landing (backand.com et al.).
async function isLiveProduct(url: string): Promise<boolean> {
  try {
    const res = await safeFetch(url, {
      method: "GET",
      timeoutMs: REACHABILITY_TIMEOUT_MS,
    });
    if (isDeadStatus(res.status)) return false;
    const body = (await res.text()).slice(0, PARKING_SCAN_CHARS).toLowerCase();
    const finalHost = extractHostname(res.url) ?? "";
    return !isParkedPage(finalHost, body);
  } catch {
    return false;
  }
}

let exaClient: Exa | null = null;

function getExa(): Exa {
  if (!exaClient) {
    const key = process.env.EXA_API_KEY;
    if (!key) throw new Error("EXA_API_KEY is required for discovery");
    exaClient = new Exa(key);
  }
  return exaClient;
}

export interface DiscoveredCompany {
  url: string;
  title: string;
  snippet: string;
}

/**
 * Collapses the unioned recall sources to one entry per company. The same
 * competitor routinely comes back as https://x.com/, https://www.x.com/pricing
 * and (from the named seeds) https://x.com — three rows that would each pay a
 * reachability fetch and a line in the scoring prompt.
 *
 * First occurrence wins, so the caller's ordering is the priority order; a later
 * duplicate only replaces it when the kept one has no snippet (a bare seed
 * upgraded by Exa's page text). `excluded` holds already-normalized domains.
 * Pure — exported for tests.
 */
export function dedupeByDomain(
  items: DiscoveredCompany[],
  excluded: Set<string>,
): DiscoveredCompany[] {
  const byDomain = new Map<string, DiscoveredCompany>();
  for (const r of items) {
    const domain = normalizeDomain(r.url);
    if (!domain || excluded.has(domain)) continue;
    const prev = byDomain.get(domain);
    if (!prev) byDomain.set(domain, r);
    else if (!prev.snippet.trim() && r.snippet.trim()) {
      byDomain.set(domain, { ...prev, snippet: r.snippet });
    }
  }
  return [...byDomain.values()];
}

// Upper bound on the pool handed to the overlap scorer. Every candidate past it
// costs a reachability fetch and a row in the scoring prompt, and the three recall
// sources overlap heavily, so the tail is mostly duplicates and noise.
const MAX_POOL = 45;
// findSimilar's own slice of the pool — enough to carry the market leaders it
// surfaces without letting brand-lookalikes (linear.fi for linear.app) crowd out
// the descriptive search.
const SIMILAR_COUNT = 15;

export async function findSimilarCompanies(
  // Null for onboarding modes without a live product site (idea / document /
  // developing). Only used to exclude the user's own domain/brand from results;
  // the semantic `query` is what actually drives the search.
  productUrl: string | null,
  query: string,
  count = 15,
  excludeDomains: string[] = [],
  // Primary market (ISO 3166-1 alpha-2, e.g. "fr") → Exa `userLocation`, which
  // biases results toward that region. null = global (no bias). It only reorders
  // toward the market — strong off-region competitors still surface.
  region: string | null = null,
  // Competitors a model named from the product profile (@outrival/ai
  // nameKnownCompetitors, resolved by the caller — this package never imports the
  // AI package). Pure recall: they go through the same filters, liveness check and
  // overlap scoring as anything Exa returns, so an invented domain dies here.
  namedSeeds: { name: string; domain: string; why: string }[] = [],
): Promise<DiscoveredCompany[]> {
  const hostname = productUrl ? new URL(productUrl).hostname : null;
  const ownBrand = productUrl ? extractBrand(productUrl) : null;
  const excluded = new Set(
    [...(hostname ? [hostname] : []), ...excludeDomains]
      .map((d) => normalizeDomain(d))
      .filter((d): d is string => d !== null),
  );

  // Two Exa reads with complementary blind spots, unioned:
  //  - search(query, category:"company") answers "whose company page reads like
  //    this description?" — good on long-tail/niche products, but it misses the
  //    market leaders, whose pages don't paraphrase a descriptive query (a
  //    Vercel-shaped profile returned neither Netlify's peers nor Cloudflare).
  //  - findSimilar(productUrl, category:"company") answers "who is adjacent to
  //    this company?" — the leaders' lane. Its old failure (clones, GitHub and
  //    LinkedIn pages of the product itself) came from running it WITHOUT the
  //    company category; with it, that noise is gone.
  // Neither is allowed to sink the other: a findSimilar miss (URL unknown to Exa,
  // rate limit) must still return the search results, so they settle independently.
  const [searchRes, similarRes] = await Promise.allSettled([
    getExa().search(query, {
      numResults: count,
      excludeDomains: [...(hostname ? [hostname] : []), ...excludeDomains],
      category: "company",
      contents: { text: { maxCharacters: 500 } },
      ...(region ? { userLocation: region } : {}),
    }),
    productUrl
      ? getExa().findSimilar(productUrl, {
          numResults: SIMILAR_COUNT,
          excludeSourceDomain: true,
          excludeDomains,
          category: "company",
          contents: { text: { maxCharacters: 500 } },
        })
      : Promise.resolve(null),
  ]);

  if (searchRes.status === "rejected" && similarRes.status === "rejected") {
    // Both reads failed → Exa is down / misconfigured. Surface it like before
    // (the route turns it into a 502) instead of reporting "no competitors".
    throw searchRes.reason;
  }

  const fromExa = [
    ...(searchRes.status === "fulfilled" ? searchRes.value.results : []),
    ...(similarRes.status === "fulfilled" && similarRes.value ? similarRes.value.results : []),
  ].map((r) => ({
    url: r.url,
    title: r.title ?? new URL(r.url).hostname,
    snippet: r.text ?? "",
  }));

  const fromSeeds = namedSeeds.map((s) => ({
    url: `https://${s.domain}`,
    title: s.name,
    snippet: s.why,
  }));

  const mapped = dedupeByDomain([...fromExa, ...fromSeeds], excluded);

  const filtered = mapped.filter((r) => {
    const host = extractHostname(r.url);
    if (!host) return false;
    // Clones/templates hosted on builders & preview platforms.
    if (isJunkHost(host)) return false;
    // Social / directory / review / app-store / press pages — never a
    // competitor's own site (this is what surfaced the product's own LinkedIn).
    if (isSocialOrAggregatorHost(host)) return false;
    // The user's own company on another TLD (amazon.fr, amazon.de…) —
    // excludeDomains only filters the exact hostname.
    if (ownBrand !== null && extractBrand(r.url) === ownBrand) return false;
    // Near-duplicates embedding the seed brand (getlinear, linear-clone,
    // linear-beige.vercel.app…) — these are knockoffs, not competitors.
    if (ownBrand !== null && ownBrand.length >= 4 && host.includes(ownBrand)) {
      return false;
    }
    return true;
  });

  // Drop dead / parked domains (parallel; network-error = dead, for-sale landing =
  // not a product). Junk hosts are already gone, so we only ping plausible candidates.
  const reachability = await Promise.all(
    filtered.slice(0, MAX_POOL).map(async (r) => ({ r, alive: await isLiveProduct(r.url) })),
  );
  const live = reachability.filter((x) => x.alive).map((x) => x.r);

  return live;
}
