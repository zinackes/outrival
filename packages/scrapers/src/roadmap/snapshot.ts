import { buildRoadmapIsland } from "../content/parse";
import type { RoadmapEntry, RoadmapPortal } from "./types";

/**
 * Turn a portal into the document the generic pipeline diffs. This module IS the
 * design of the source: every property we want the diff to have is a property of
 * this text, so `scrape-monitor` needs no roadmap branch and the classifier needs no
 * roadmap rule.
 */

export interface RoadmapDocument {
  html: string;
  text: string;
}

/**
 * Vote-count ladder. Roughly geometric (~1.6×), so a band change means "this request
 * gained about a third again as much support", which is what a competitor's team
 * would actually react to.
 *
 * Raw counts are deliberately NOT written into the diff-bearing body: a busy portal
 * moves nearly every count between two weekly scrapes, so a raw list would diff
 * end-to-end every run — a full-list change to classify, and a signal that says
 * nothing. Banding makes the line stable under drift and loud under a surge. The
 * exact counts survive in the scrape metadata, which is never diffed.
 */
const VOTE_LADDER = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584];

/** Highest ladder value ≤ `votes`. Written as "N+", which is true rather than rounded. */
export function voteBand(votes: number): number {
  const v = Number.isFinite(votes) ? Math.max(0, Math.floor(votes)) : 0;
  let band = VOTE_LADDER[0] as number;
  for (const step of VOTE_LADDER) {
    if (step > v) break;
    band = step;
  }
  return band;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Collapse whitespace so a title edited across lines cannot fake a multi-line diff. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** One entry, one line. `[status] title — votes N+ — url`. */
export function entryLine(entry: RoadmapEntry): string {
  const parts = [`[${entry.status}] ${oneLine(entry.title)}`, `votes ${voteBand(entry.votes)}+`];
  if (entry.url) parts.push(entry.url);
  return parts.join(" — ");
}

/** `status: n` pairs, alphabetical, so the header only moves when the mix moves. */
export function statusCounts(entries: RoadmapEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, n]) => `${status}: ${n}`)
    .join(", ");
}

/**
 * Sort by the vendor's stable entry id — never by votes, status or title.
 *
 * This is the load-bearing choice. Order by anything mutable and a single status
 * change relocates its line, so the diff reads as one removal plus one addition
 * somewhere else entirely, plus a shifted neighbourhood. Ordered by id, the same
 * change is exactly one `-`/`+` pair in place and nothing else moves.
 */
export function sortEntries(entries: RoadmapEntry[]): RoadmapEntry[] {
  return [...entries].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildRoadmapDoc(portal: RoadmapPortal): RoadmapDocument {
  const entries = sortEntries(portal.entries);
  // Two adapters read a portal without knowing whose it is: `generic` off an embedded
  // payload, `dom` off the markup. Both are internal routing words, not something to
  // hand a reader (or the classifier) as the name of a product — and neither vendor
  // ever told us whether it served one page of several.
  const unidentified = portal.vendor === "generic" || portal.vendor === "dom";
  const vendorLabel = unidentified ? "vendor unidentified" : portal.vendor;
  const intro =
    `Public roadmap and feedback portal (${vendorLabel}) — what this vendor has ` +
    `committed to build, and how many of their own customers are asking for each item. ` +
    `A status moving forward is a shipping commitment; a vote count entering a higher ` +
    `band is customer demand building up behind a request.`;
  // An unidentified vendor cannot tell us whether it paginated, so the count is
  // reported as what we could read rather than as the size of their roadmap.
  const countLabel = unidentified
    ? `${entries.length} entries listed on the page we can read`
    : `${entries.length} entries`;
  const header =
    `Roadmap at ${portal.url} — ${statusCounts(entries)} (${countLabel}` +
    (portal.truncated ? ", partial: the portal serves more than one page" : "") +
    `)`;

  const lines = entries.map(entryLine);
  const text = [intro, header, ...lines].join("\n");
  // The entries again, structured, for the ingestion that turns them into
  // content_items rows. A <script> is stripped by extractContent before hashing,
  // so this rides along without touching the diff or the content hash — the same
  // trick the changelog feed snapshot uses.
  const island = buildRoadmapIsland(portal.url, portal.vendor, entries);
  const html =
    `<!doctype html><html><body><section data-outrival-roadmap="${escapeHtml(portal.vendor)}">` +
    `<p>${escapeHtml(intro)}</p><h2>${escapeHtml(header)}</h2>` +
    `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` +
    `</section>${island}</body></html>`;

  return { html, text };
}
