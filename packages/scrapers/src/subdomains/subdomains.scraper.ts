import { normalizeHostname } from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "../types";
import { fetchCrtSh } from "./crtsh";
import { selectCandidates, type SubdomainCandidate, type SubdomainKind } from "./filter";
import { filterLive, type LivenessProbe } from "./liveness";

/**
 * Subdomains scraper (Certificate Transparency). Enumerates a competitor's
 * subdomains from crt.sh, keeps only the LIVE, non-infra ones, and emits a
 * DETERMINISTIC snapshot — the sorted host list, one per line, each annotated
 * with its kind. The generic snapshot→diff→change→classify pipeline then surfaces
 * a brand-new live subdomain (beta./ai./{product}.) as a change with zero
 * subdomains-specific code in scrape-monitor. Internal source (like sitemap/news):
 * never user-selectable. Pure fetch + DNS — no browser cascade, no AI.
 *
 * The per-line annotation is what makes this hold up: the classifier is AI-driven
 * (no deterministic severity hook), so we shape the diff it reads. A `beta.`/novel
 * product surface renders as a pre-announcement signal (steers high); a regional
 * host renders as expansion (steers medium). The categorisation is deterministic;
 * only the final severity is the classifier's call.
 */

// Cap the liveness budget for a large competitor: keep the freshest candidates
// (selectCandidates already sorted most-recent-first). 100 DNS+HEAD probes at
// concurrency 10 is bounded and off any scan's critical path.
const MAX_CANDIDATES = 100;

const KIND_ORDER: SubdomainKind[] = ["beta", "product", "regional", "other"];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Strong natural-language annotation per kind — this is the diff line the
 * classifier reads, so it names the strategic meaning, not just the host.
 */
function annotate(c: SubdomainCandidate): string {
  switch (c.kind) {
    case "beta":
      return "NEW pre-release / beta surface (pre-announcement product signal)";
    case "product":
      return `NEW product surface "${c.label}" (likely unannounced launch or expansion)`;
    case "regional":
      return `regional expansion (${c.label.toUpperCase()})`;
    default:
      return "new subdomain";
  }
}

/**
 * Deterministic snapshot: hosts sorted so the +/- diff of two runs maps 1:1 to
 * added/removed live subdomains, plus a stable kind-count header that only moves
 * when the mix changes. Mirrors sitemap.scraper's buildSnapshot.
 */
export function buildSnapshot(domain: string, live: SubdomainCandidate[]): ScrapeOutcome {
  const sorted = [...live].sort((a, b) => a.host.localeCompare(b.host));

  const counts = new Map<SubdomainKind, number>();
  for (const c of sorted) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const summary = KIND_ORDER.filter((k) => counts.has(k))
    .map((k) => `${k}: ${counts.get(k)}`)
    .join(", ");

  const list = sorted
    .map((c) => `<li>${escapeHtml(c.host)} — ${escapeHtml(annotate(c))}</li>`)
    .join("");
  const json = JSON.stringify({
    domain,
    subdomains: sorted.map((c) => ({ host: c.host, kind: c.kind })),
  }).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><body><section data-outrival-subdomains>` +
    `<h2>Live subdomains of ${escapeHtml(domain)} — ${sorted.length} (${escapeHtml(summary)})</h2>` +
    `<ul>${list}</ul></section>` +
    `<script type="application/json" id="outrival-subdomains">${json}</script></body></html>`;

  const text = `${summary}\n${sorted.map((c) => `${c.host} — ${annotate(c)}`).join("\n")}`;

  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url: `https://${domain}`, scrapedWith: "subdomains", liveCount: sorted.length },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}

/**
 * Core pipeline (deps injectable for tests): crt.sh → dedup/infra-filter → cap →
 * liveness → live candidates. Throws on an empty live set (same rule as sitemap's
 * no_sitemap_found) so Trigger retries rather than writing an empty snapshot the
 * next populated run reads as "every subdomain added".
 */
export async function collectLiveSubdomains(
  domain: string,
  deps: { fetchFn?: typeof fetch; probe?: LivenessProbe } = {},
): Promise<SubdomainCandidate[]> {
  const entries = await fetchCrtSh(domain, { fetchFn: deps.fetchFn });
  const candidates = selectCandidates(entries, domain).slice(0, MAX_CANDIDATES);
  const liveHosts = new Set(await filterLive(candidates.map((c) => c.host), { probe: deps.probe }));
  const live = candidates.filter((c) => liveHosts.has(c.host));
  if (live.length === 0) throw new Error("subdomains: no_live_subdomains");
  return live;
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const domain = normalizeHostname(url);
  if (!domain) throw new Error("subdomains: no registrable domain from competitor URL");
  return buildSnapshot(domain, await collectLiveSubdomains(domain));
}
