import Exa from "exa-js";
import { extractBrand, extractHostname } from "@outrival/shared";

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

const REACHABILITY_TIMEOUT_MS = 5000;

// Exa surfaces defunct startups whose domain no longer resolves (expired,
// parked, dead). A network-level failure (DNS miss, refused connection,
// timeout) means the domain is dead → drop it. ANY HTTP response — even a
// 403/503 from anti-bot — means the site is alive, so we keep it.
async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });
    res.body?.cancel().catch(() => {});
    return true;
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

export async function findSimilarCompanies(
  // Null for onboarding modes without a live product site (idea / document /
  // developing). Only used to exclude the user's own domain/brand from results;
  // the semantic `query` is what actually drives the search.
  productUrl: string | null,
  query: string,
  count = 15,
  excludeDomains: string[] = [],
): Promise<DiscoveredCompany[]> {
  const hostname = productUrl ? new URL(productUrl).hostname : null;
  const ownBrand = productUrl ? extractBrand(productUrl) : null;

  // Semantic search on what the product DOES (the query), restricted to
  // company entities. findSimilar(url) was anchored on the page itself, so it
  // surfaced clones/templates that *look like* the product; a descriptive
  // query + category:"company" finds companies that do the same thing.
  const results = await getExa().search(query, {
    numResults: count,
    excludeDomains: [...(hostname ? [hostname] : []), ...excludeDomains],
    category: "company",
    contents: { text: { maxCharacters: 500 } },
  });

  const mapped = results.results.map((r) => ({
    url: r.url,
    title: r.title ?? new URL(r.url).hostname,
    snippet: r.text ?? "",
  }));

  const filtered = mapped.filter((r) => {
    const host = extractHostname(r.url);
    if (!host) return false;
    // Clones/templates hosted on builders & preview platforms.
    if (isJunkHost(host)) return false;
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

  // Drop dead domains (parallel, network-error = dead). Junk hosts are already
  // gone, so we only ping plausible candidates.
  const reachability = await Promise.all(
    filtered.map(async (r) => ({ r, alive: await isReachable(r.url) })),
  );
  const live = reachability.filter((x) => x.alive).map((x) => x.r);

  // TEMP debug — à retirer
  console.log("[discovery]", {
    productUrl,
    ownBrand,
    rawCount: mapped.length,
    afterFilter: filtered.length,
    afterReachable: live.length,
    dropped: mapped
      .filter((r) => !filtered.includes(r))
      .map((r) => r.url),
    dead: reachability.filter((x) => !x.alive).map((x) => x.r.url),
  });

  return live;
}
