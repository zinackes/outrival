import { collectJsonIslands } from "./islands";
import type { RoadmapEntry, RoadmapParse } from "./types";

/**
 * Vendor-agnostic portal adapter: finds a roadmap in ANY page that server-renders its
 * state as JSON, without knowing whose portal it is.
 *
 * Canny and ProductBoard have named adapters because each exposes something specific
 * (a state island shape, an unauthenticated endpoint). Everyone else — Featurebase,
 * Gleap, Productlane, the next portal vendor to launch — ships the same *shape*: an
 * array of objects carrying an id, a title, a status label and a vote count. This
 * module looks for that shape and normalises it onto `RoadmapEntry`, which is why one
 * adapter covers vendors we have never heard of.
 *
 * ## The qualification bar IS the feature
 *
 * A page contains many arrays of objects, and picking the wrong one would emit a
 * plausible-but-wrong listing that the next diff reads as a wholesale roadmap
 * rewrite — the exact failure the scraper's "never an empty success" rule exists to
 * prevent. So a candidate must clear ALL of:
 *
 *   - at least {@link MIN_ENTRIES} entries, each with a unique stable id and a title;
 *   - at least {@link MIN_MAPPED_RATIO} of the array's objects mapping cleanly (a
 *     roadmap array is homogeneous; a grab-bag of mixed objects is not one);
 *   - a status field that behaves like an ENUM — short labels, at most
 *     {@link MAX_DISTINCT_STATUSES} distinct values across the array;
 *   - and a demand signal: vote counts on most entries, OR status labels drawn from
 *     roadmap vocabulary. Blog posts and support articles carry ids, titles and a
 *     `status` too; what they never carry is "planned" next to an upvote count.
 *
 * Anything below the bar returns `unparsable`, and the scraper turns that into "no
 * portal here" rather than a guess.
 *
 * ## Known limit: pagination
 *
 * A named vendor tells us when it served one page of many (Canny's `hasNextPage`); an
 * unidentified one does not. So a vote-ordered first page can drop an entry between
 * two runs and the diff reads it as a removal. `truncated` stays false because it
 * reports what the VENDOR said, and the snapshot header says "entries listed on the
 * page we can read" instead of claiming the roadmap is that size.
 */

const MIN_ENTRIES = 3;
const MAX_ENTRIES = 500;
const MIN_MAPPED_RATIO = 0.8;
const MAX_DISTINCT_STATUSES = 8;
const MAX_STATUS_CHARS = 40;
const MAX_TITLE_CHARS = 300;
const MIN_VOTED_RATIO = 0.8;

/** Walk limits — a 500 KB flight payload must not pin a worker. */
const MAX_DEPTH = 14;
const MAX_NODES = 200_000;

// Ids and titles are matched on an exact vocabulary: a fuzzy "*id" would happily take
// `categoryId` or `associatedCompanyId` and sort the snapshot by the wrong thing.
const ID_KEYS = ["id", "_id", "uuid", "objectid", "postid", "entryid", "ideaid"];
const TITLE_KEYS = ["title", "name", "heading", "subject"];
const URL_KEYS = ["url", "permalink", "href", "link"];

// Status and votes get an exact list FIRST and then a fuzzy pass, because this is
// where vendors invent their own spelling — `postStatus` (Featurebase),
// `initialUpvotes` (Gleap). Exact-first keeps the canonical field winning when both
// exist; the fuzzy pass is what makes the adapter work on a vendor nobody has read yet.
const STATUS_KEYS = ["status", "state", "stage", "poststatus", "statusname", "statuslabel", "column", "phase"];
const STATUS_FUZZY = /status/;
// `statusChangedAt` is a timestamp, not a label. A date would fail the enum bar
// anyway (every entry distinct), but taking it would waste the candidate.
const STATUS_EXCLUDE = /changed|date|time|_at$|at$/;
const VOTE_KEYS = ["votes", "upvotes", "votecount", "upvotecount", "score", "points", "voters"];
const VOTE_FUZZY = /vote/;

/**
 * Status labels that only a roadmap uses. Matched as substrings on the lowercased
 * label, so "In Progress 🚧" and "under-review" both land. Deliberately excludes the
 * publishing vocabulary ("published", "draft") and the issue-tracker vocabulary
 * ("open", "closed") — those are what the false positives are made of.
 */
export const ROADMAP_STATUS_WORDS = [
  "planned",
  "planning",
  "progress",
  "under review",
  "under-review",
  "reviewing",
  "under consideration",
  "considering",
  "backlog",
  "upcoming",
  "shipped",
  "launched",
  "released",
  "completed",
  "complete",
  "development",
  "roadmap",
  "next up",
];

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Case-insensitive key lookup — vendors disagree on `voteCount` vs `votecount`. */
function lowerKeyed(o: Record<string, unknown>): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [k, v] of Object.entries(o)) m.set(k.toLowerCase(), v);
  return m;
}

/**
 * The keys worth reading for one field: the exact vocabulary in priority order, then
 * anything else on the object whose name matches `fuzzy` (minus `exclude`).
 */
function candidateKeys(
  fields: Map<string, unknown>,
  exact: readonly string[],
  fuzzy?: RegExp,
  exclude?: RegExp,
): string[] {
  const keys = exact.filter((k) => fields.has(k));
  if (fuzzy) {
    for (const k of fields.keys()) {
      if (!keys.includes(k) && fuzzy.test(k) && !exclude?.test(k)) keys.push(k);
    }
  }
  return keys;
}

function pickString(fields: Map<string, unknown>, keys: readonly string[], maxChars: number): string {
  for (const key of keys) {
    const v = fields.get(key);
    if (typeof v === "string") {
      const s = v.trim();
      if (s.length > 0 && s.length <= maxChars) return s;
    }
    // Some payloads box the id as `{ $oid: "…" }` or the status as `{ name: "…" }`.
    if (isRecord(v)) {
      for (const inner of ["$oid", "name", "label", "title", "value"]) {
        const nested = v[inner];
        if (typeof nested === "string") {
          const s = nested.trim();
          if (s.length > 0 && s.length <= maxChars) return s;
        }
      }
    }
  }
  return "";
}

function pickNumber(fields: Map<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const v = fields.get(key);
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
    // A vote list instead of a count is just as good a demand signal.
    if (Array.isArray(v) && v.every((x) => typeof x !== "object")) return v.length;
  }
  return null;
}

/** Absolute or root-relative permalinks only, resolved against the portal we read. */
function pickUrl(fields: Map<string, unknown>, base: string): string | null {
  const raw = pickString(fields, URL_KEYS, 2000);
  if (!raw) return null;
  try {
    const abs = new URL(raw, base);
    if (abs.protocol !== "https:" && abs.protocol !== "http:") return null;
    return abs.toString();
  } catch {
    return null;
  }
}

interface Candidate {
  entry: RoadmapEntry;
  hasVotes: boolean;
}

function toCandidate(o: Record<string, unknown>, base: string): Candidate | null {
  const fields = lowerKeyed(o);
  const id = pickString(fields, ID_KEYS, 200);
  const title = pickString(fields, TITLE_KEYS, MAX_TITLE_CHARS);
  const status = pickString(
    fields,
    candidateKeys(fields, STATUS_KEYS, STATUS_FUZZY, STATUS_EXCLUDE),
    MAX_STATUS_CHARS,
  );
  if (!id || !title || !status) return null;
  const votes = pickNumber(fields, candidateKeys(fields, VOTE_KEYS, VOTE_FUZZY));
  return {
    entry: { id, title, status: status.toLowerCase(), votes: votes ?? 0, url: pickUrl(fields, base) },
    hasVotes: votes !== null,
  };
}

export function statusesLookLikeRoadmap(statuses: Set<string>): boolean {
  for (const s of statuses) {
    if (ROADMAP_STATUS_WORDS.some((w) => s.includes(w))) return true;
  }
  return false;
}

/** Every array of objects reachable from `root`, bounded. */
function objectArrays(root: unknown): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = [];
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    if (++nodes > MAX_NODES || next.depth > MAX_DEPTH) continue;
    const { value, depth } = next;
    if (Array.isArray(value)) {
      const objects = value.slice(0, MAX_ENTRIES).filter(isRecord);
      if (objects.length >= MIN_ENTRIES) out.push(objects);
      for (const item of value.slice(0, MAX_ENTRIES)) stack.push({ value: item, depth: depth + 1 });
    } else if (isRecord(value)) {
      for (const item of Object.values(value)) stack.push({ value: item, depth: depth + 1 });
    }
  }
  return out;
}

/** Apply the bar. Returns the entries only when the array really looks like a roadmap. */
function qualify(objects: Record<string, unknown>[], base: string): RoadmapEntry[] | null {
  if (objects.length < MIN_ENTRIES || objects.length > MAX_ENTRIES) return null;

  const candidates: Candidate[] = [];
  for (const o of objects) {
    const c = toCandidate(o, base);
    if (c) candidates.push(c);
  }
  if (candidates.length < MIN_ENTRIES) return null;
  if (candidates.length / objects.length < MIN_MAPPED_RATIO) return null;

  const entries = candidates.map((c) => c.entry);
  // A repeated id means the array is not a list of distinct entries (or the field we
  // took for an id is a type tag). Either way it cannot be the snapshot's sort key.
  if (new Set(entries.map((e) => e.id)).size !== entries.length) return null;

  const statuses = new Set(entries.map((e) => e.status));
  if (statuses.size > MAX_DISTINCT_STATUSES) return null;

  const voted = candidates.filter((c) => c.hasVotes).length / candidates.length;
  if (voted < MIN_VOTED_RATIO && !statusesLookLikeRoadmap(statuses)) return null;

  return entries;
}

/**
 * Read a roadmap out of any page that embeds its state as JSON. `unparsable` when
 * nothing on the page clears the bar — which the scraper reports as "no portal here",
 * never as a vendor breakage, because we only ever GUESSED this page was a portal.
 */
export function parseGenericPortal(html: string, url: string): RoadmapParse {
  let best: RoadmapEntry[] | null = null;
  let bestScore = -1;
  for (const island of collectJsonIslands(html)) {
    for (const objects of objectArrays(island)) {
      const entries = qualify(objects, url);
      if (!entries) continue;
      // Longest wins; a tie goes to the list that carries demand, since a portal's
      // votes are half of what makes this source worth reading.
      const score = entries.length * 2 + (entries.some((e) => e.votes > 0) ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = entries;
      }
    }
  }
  if (!best) return { ok: false, reason: "unparsable" };
  // `truncated` stays false: a vendor we do not know cannot tell us it paginated.
  return { ok: true, portal: { vendor: "generic", url, entries: best, truncated: false } };
}
