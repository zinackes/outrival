import type { SourceType } from "../constants/sources";
import { planIncludesSource, isGatedSource, type Plan } from "../constants/plans";

/**
 * The tri-state (really ten-state) a source is in for one competitor.
 *
 * The central rule: NOT AVAILABLE ("this competitor has no such surface") is
 * neutral and must never read as a gap, while BLOCKED ("the surface exists and
 * refuses us") is a real limit that must never be hidden. Confusing the two fails
 * in both directions — it scares the user about a well-covered competitor, or it
 * buries an actual blind spot.
 */
export type SourceState =
  /** Collecting fine. Counts as covered. */
  | "tracking"
  /** Enabled, first scrape in flight (or never run yet). Counts as covered. */
  | "pending"
  /** The site explicitly refuses automated collection. We do NOT bypass it. */
  | "blocked"
  /** The page is behind a login — can't be monitored. */
  | "login_required"
  /** The site is geo-restricted from where we collect. */
  | "geo_blocked"
  /** A failure the user can act on: the URL moved / died / didn't capture. */
  | "fixable"
  /** Paused by the user. Applicable, deliberately off. */
  | "off"
  /** This competitor has no such surface. NEUTRAL — never a gap, never an error. */
  | "not_available"
  /** Above the org's plan. An upsell, not a gap. */
  | "locked"
  /** Never enabled and nothing detected — the user can turn it on. */
  | "not_configured";

/** Monitor fields the classification reads. Accepts API (string) or DB (Date) shapes. */
export interface MonitorCoverageFields {
  sourceType: SourceType;
  isActive?: boolean | null;
  markedUnscrapable?: boolean | null;
  refusedAt?: string | Date | null;
  lastFailureCategory?: string | null;
  lastError?: string | null;
  lastRunAt?: string | Date | null;
  lastFailedAt?: string | Date | null;
  scrapeStartedAt?: string | Date | null;
}

/**
 * What platform detection (patch-31) resolved for this competitor. Absence of a
 * target is what makes a source NOT AVAILABLE rather than broken — it is the only
 * evidence we have that the surface genuinely doesn't exist.
 */
export interface DetectedTargets {
  statusPage: boolean;
  changelog: boolean;
}

/**
 * Scraper errors that mean "this competitor has no such surface", not "collection
 * failed". Matched on the scrapers' own thrown messages (packages/scrapers), which
 * is why each entry names its origin — a message change must update this map.
 *
 * Derived read-side on purpose: recording a neutral status would mean writing from
 * scrape-monitor, and the scraping pipeline is deliberately left untouched here.
 */
const NO_TARGET_MARKERS: Partial<Record<SourceType, readonly string[]>> = {
  // youtube.scraper.ts:80 — no channel linked from the homepage.
  youtube: ["no_channel"],
  // status.scraper.ts:91 — no status host resolvable for this domain.
  status: ["no resolvable status host"],
  // trustpilot.scraper.ts:56 — the domain has no Trustpilot business unit.
  trustpilot_public: ["no trustpilot business unit"],
  // github.scraper.ts:102 — the repo is gone or was never public.
  github_repo: ["repo not found or private"],
};

function hasNoTargetError(source: SourceType, lastError: string | null | undefined): boolean {
  if (!lastError) return false;
  const markers = NO_TARGET_MARKERS[source];
  if (!markers) return false;
  const err = lastError.toLowerCase();
  return markers.some((m) => err.includes(m));
}

function toMs(v: string | Date | null | undefined): number {
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Whether a source with no monitor row is genuinely absent for this competitor
 * (detection looked and found nothing) rather than merely not turned on yet.
 */
function detectedAbsent(source: SourceType, targets: DetectedTargets | null): boolean {
  if (!targets) return false;
  if (source === "status") return !targets.statusPage;
  if (source === "changelog") return !targets.changelog;
  return false;
}

/**
 * Classify one source for one competitor. Pure — the same inputs always give the
 * same state, so the Sources page, the coverage headline and the tests all agree.
 */
export function sourceState(args: {
  sourceType: SourceType;
  plan: Plan;
  monitor: MonitorCoverageFields | null;
  targets?: DetectedTargets | null;
}): SourceState {
  const { sourceType, plan, monitor, targets = null } = args;

  // A source the plan doesn't include is frozen by the scheduler whether or not a
  // monitor row exists, so the padlock wins over any stale monitor state.
  if (isGatedSource(sourceType) && !planIncludesSource(plan, sourceType)) return "locked";

  if (!monitor) return detectedAbsent(sourceType, targets) ? "not_available" : "not_configured";

  // "No such surface" outranks every failure state: the scrape did fail, but
  // reporting it as a failure is what turns a well-covered competitor into a
  // false gap (a competitor with no YouTube channel is not a monitoring problem).
  if (hasNoTargetError(sourceType, monitor.lastError)) return "not_available";

  const category = monitor.lastFailureCategory ?? null;
  if (monitor.refusedAt || category === "anti_bot") return "blocked";
  if (category === "login_required") return "login_required";
  if (category === "geo_blocked") return "geo_blocked";
  // site_dead / site_redirected / spa_empty / unknown all share one action set
  // (point us at the right URL, or resume) — the copy differs by category, the
  // state doesn't. markedUnscrapable with no diagnosis lands here too.
  if (category || monitor.markedUnscrapable) return "fixable";

  // Checked after the failure states: auto-pause also clears isActive, and a
  // source paused BY US must not read as a deliberate user choice.
  if (monitor.isActive === false) return "off";

  if (!monitor.lastRunAt || toMs(monitor.scrapeStartedAt) > toMs(monitor.lastRunAt)) return "pending";
  return "tracking";
}

/** Buckets of a competitor's sources by what the user needs to know about them. */
export interface SourceCoverage {
  /** Collecting — what the product actually watches. */
  tracked: SourceType[];
  /**
   * Enabled, first scrape still in flight. Counted as covered (they are not gaps),
   * but tracked separately so a competitor added seconds ago can say "checking"
   * instead of asserting coverage it hasn't verified yet.
   */
  pending: SourceType[];
  /** The surface exists and refuses us. Named explicitly, never hidden. */
  blocked: SourceType[];
  /** Reachable in principle but not right now (login / geo / broken URL). */
  unreachable: SourceType[];
  /** Turned off by the user. */
  paused: SourceType[];
  /** No such surface for this competitor. Neutral — excluded from the denominator. */
  notApplicable: SourceType[];
  /** Above the plan — an upsell, excluded from the denominator. */
  locked: SourceType[];
  /** Available to turn on, excluded from the denominator. */
  notConfigured: SourceType[];
}

const EMPTY_COVERAGE = (): SourceCoverage => ({
  tracked: [],
  pending: [],
  blocked: [],
  unreachable: [],
  paused: [],
  notApplicable: [],
  locked: [],
  notConfigured: [],
});

const BUCKET_OF: Record<SourceState, keyof SourceCoverage> = {
  tracking: "tracked",
  pending: "pending",
  blocked: "blocked",
  login_required: "unreachable",
  geo_blocked: "unreachable",
  fixable: "unreachable",
  off: "paused",
  not_available: "notApplicable",
  locked: "locked",
  not_configured: "notConfigured",
};

/** Fold per-source states into the coverage buckets, preserving input order. */
export function buildCoverage(
  states: Array<{ sourceType: SourceType; state: SourceState }>,
): SourceCoverage {
  const cov = EMPTY_COVERAGE();
  for (const { sourceType, state } of states) cov[BUCKET_OF[state]].push(sourceType);
  return cov;
}

/**
 * The positively-framed header line. Shows what IS covered and names what is
 * blocked separately — never a ratio, and never counting a surface the competitor
 * doesn't have against them ("6/9" reads as failure; it isn't one).
 */
export function coverageHeadline(
  cov: SourceCoverage,
  label: (s: SourceType) => string,
): string {
  const n = cov.tracked.length + cov.pending.length;
  const plural = (k: number) => (k === 1 ? "" : "s");
  // A competitor added moments ago has enabled sources but no capture yet. Claiming
  // "tracking 6 sources" there would assert coverage we haven't verified — the first
  // scrapes may still come back blocked or find no such surface.
  const head =
    n === 0
      ? "No sources tracked yet"
      : cov.tracked.length === 0
        ? `Checking ${n} source${plural(n)}…`
        : `Tracking ${n} source${plural(n)}`;
  const parts = [head];
  if (cov.blocked.length > 0) {
    parts.push(`${cov.blocked.length} blocked (${cov.blocked.map(label).join(", ")})`);
  }
  return parts.join(" · ");
}

/**
 * What we still watch on a competitor whose primary surface refuses us. A site
 * isn't monolithic: the open indirect surfaces (ATS jobs API, changelog feed,
 * status page, Hacker News, App Store) often say more than the homepage. Saying
 * this is the difference between "we're stuck" and "we route around it".
 */
export function fallbackSources(cov: SourceCoverage, exclude: SourceType): SourceType[] {
  return [...cov.tracked, ...cov.pending].filter((s) => s !== exclude);
}
