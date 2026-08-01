/**
 * Hiring momentum (Hiring Intelligence v2 P5).
 *
 * Everything P1-P4 accumulated, read back out: how a competitor works (remote),
 * how long its roles stay open (time-to-fill), and the four-line summary of what
 * its board has been doing (momentum). Pure and deterministic, no AI and no I/O:
 * the caller reads the rows, everything decided here is decided from counts and
 * dates the boards printed.
 *
 * It lives in `@outrival/shared` rather than next to the other hiring detectors
 * because all four consumers need the SAME answer from the same numbers: the
 * worker that emits `remote_policy_changed`, the API that serves the Hiring tab
 * and the compare payload, the web app that draws the chip, and the battle card
 * whose Momentum section is rendered from these facts rather than written by a
 * model. Only this package is importable by all of them.
 */

import {
  DEPARTMENT_BUCKET_LABELS,
  normalizeDepartment,
  type DepartmentBucket,
} from "./constants/departments";
import { percentile, type DisclosureVerdict } from "./salary-normalize";

// ── remote share ────────────────────────────────────────────────────────────

/** What a posting says about where the work happens. Null when it says nothing. */
export type RemoteMode = "remote" | "hybrid" | "onsite";

/**
 * A hybrid role counts as half a remote one.
 *
 * The alternative was to leave hybrid in the denominator only, and it fails on
 * the case the whole reading exists for: a board that is entirely hybrid would
 * score 0% and be labelled office-first, which is the opposite of what it is.
 * At half weight that same board lands at exactly 50%, the middle of the hybrid
 * band, which is the sanity anchor the thresholds are set against.
 */
export const HYBRID_WEIGHT = 0.5;

export interface RemoteShareReading {
  remote: number;
  hybrid: number;
  onsite: number;
  /** Postings whose mode resolved. The denominator, and nothing else. */
  known: number;
  /** Postings whose mode never resolved. Never in the denominator. */
  unknown: number;
  /** (remote + hybrid/2) / known, or null when nothing resolved at all. */
  share: number | null;
  /** unknown / (known + unknown). Displayed WITH the share, always: it is what
   *  says how much of the number to believe. */
  unknownShare: number;
}

/**
 * The remote reading of a board's current stock of open roles.
 *
 * The denominator is the postings whose mode we actually resolved, and the ones
 * we did not are returned separately rather than folded in as onsite. A board
 * where two thirds of the location lines are unreadable can still be read, it
 * just has to be read next to the fact that two thirds of it is unreadable.
 */
export function remoteShare(
  postings: ReadonlyArray<{ remoteMode: string | null }>,
): RemoteShareReading {
  let remote = 0;
  let hybrid = 0;
  let onsite = 0;
  let unknown = 0;
  for (const p of postings) {
    if (p.remoteMode === "remote") remote++;
    else if (p.remoteMode === "hybrid") hybrid++;
    else if (p.remoteMode === "onsite") onsite++;
    else unknown++;
  }
  const known = remote + hybrid + onsite;
  const total = known + unknown;
  return {
    remote,
    hybrid,
    onsite,
    known,
    unknown,
    share: known > 0 ? (remote + HYBRID_WEIGHT * hybrid) / known : null,
    unknownShare: total > 0 ? unknown / total : 0,
  };
}

export const REMOTE_STATES = ["office_first", "hybrid_mix", "remote_first"] as const;
export type RemoteState = (typeof REMOTE_STATES)[number];

export const REMOTE_STATE_LABELS: Record<RemoteState, string> = {
  office_first: "Office-first",
  hybrid_mix: "Hybrid",
  remote_first: "Remote-first",
};

/** Below this share the board is office-first. */
export const REMOTE_OFFICE_MAX = 0.3;
/** At or above this share it is remote-first. Between the two: hybrid. */
export const REMOTE_FIRST_MIN = 0.7;
/** Under this many resolved roles a share is an accident of a small board. */
export const REMOTE_STATE_MIN_N = 5;

/**
 * The state a share puts a board in, or null when there is not enough of a board
 * to be in one.
 *
 * A STATE and not a percentage is the point of the whole feature: the share of a
 * live board moves every week as roles open and close, and a signal built on it
 * would fire on that movement. Three bands with a wide middle mean only a real
 * change of policy crosses one.
 */
export function remoteState(share: number | null, n: number): RemoteState | null {
  if (share == null || n < REMOTE_STATE_MIN_N) return null;
  if (share < REMOTE_OFFICE_MAX) return "office_first";
  if (share >= REMOTE_FIRST_MIN) return "remote_first";
  return "hybrid_mix";
}

// ── remote policy transition ────────────────────────────────────────────────

/** One reconstructed week of a board's remote posture. */
export interface RemoteWeekPoint {
  /** ISO-week key "YYYY-MM-DD" (Monday, UTC). */
  weekStart: string;
  /** Null when that week had too few resolved roles to be in a state. */
  state: RemoteState | null;
  share: number | null;
  /** Resolved roles behind the state. */
  n: number;
  unknownShare: number;
}

export interface RemotePolicyShift {
  from: RemoteState;
  to: RemoteState;
  fromShare: number;
  toShare: number;
  /** Resolved roles behind the CURRENT state. */
  n: number;
  unknownShare: number;
  weekStart: string;
  /** The consecutive weeks the new state has held, oldest first. */
  heldWeeks: string[];
}

/** Consecutive weeks a state must hold on BOTH sides before it counts as a move. */
export const REMOTE_STABLE_WEEKS = 2;

/** Maximal run of an equal, non-null state ending at `end` (inclusive). */
function trailingRun(points: ReadonlyArray<RemoteWeekPoint>, end: number): RemoteWeekPoint[] {
  const last = points[end];
  if (!last || last.state == null) return [];
  const run: RemoteWeekPoint[] = [];
  for (let i = end; i >= 0; i--) {
    const p = points[i];
    if (!p || p.state !== last.state) break;
    run.unshift(p);
  }
  return run;
}

/**
 * A board that has actually changed its remote policy, or null.
 *
 * Two runs, not two weeks. The new state must have held for
 * `REMOTE_STABLE_WEEKS` consecutive weeks ending on the current one, and the
 * state it replaced must itself have held that long immediately before: a single
 * week at 75% during a hiring push is arithmetic, not a return-to-office being
 * reversed, and the hysteresis is what tells them apart.
 *
 * `currentWeek` is required and checked, exactly as the salary detector checks
 * it: the series is read out of storage, so without it a competitor whose board
 * stopped being scraped would keep re-reading its last captured week as "now".
 */
export function detectRemotePolicyShift(
  points: ReadonlyArray<RemoteWeekPoint>,
  currentWeek: string,
  stableWeeks: number = REMOTE_STABLE_WEEKS,
): RemotePolicyShift | null {
  const sorted = [...points].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const lastIndex = sorted.length - 1;
  const current = sorted[lastIndex];
  if (!current || current.state == null || current.weekStart !== currentWeek) return null;

  const run = trailingRun(sorted, lastIndex);
  if (run.length < stableWeeks) return null;

  const priorEnd = lastIndex - run.length;
  const prior = sorted[priorEnd];
  if (!prior || prior.state == null || prior.state === current.state) return null;
  if (trailingRun(sorted, priorEnd).length < stableWeeks) return null;

  return {
    from: prior.state,
    to: current.state,
    fromShare: prior.share ?? 0,
    toShare: current.share ?? 0,
    n: current.n,
    unknownShare: current.unknownShare,
    weekStart: current.weekStart,
    heldWeeks: run.map((p) => p.weekStart),
  };
}

// ── time to fill ────────────────────────────────────────────────────────────

/** A closed posting as the time-to-fill aggregate sees it. */
export interface ClosedPostingInput {
  department: string | null;
  title: string | null;
  /** When the BOARD says it was published. Null on every source that states none. */
  postedAt: Date | string | null;
  /** When we first saw it. The fallback, and the reason for the "~". */
  detectedAt: Date | string;
  closedAt: Date | string;
}

export interface TimeToFillBucket {
  bucket: DepartmentBucket;
  label: string;
  medianDays: number;
  n: number;
  /** True when enough of the points started from the day WE first saw the role
   *  rather than the day it was published, which makes the median a floor. */
  approx: boolean;
}

/** Under this many closed roles a median is one hire wearing a statistic's clothes. */
export const TIME_TO_FILL_MIN_N = 3;
/** Share of fallback-dated points past which the bucket is marked approximate. */
export const TIME_TO_FILL_APPROX_SHARE = 0.3;

const DAY_MS = 86_400_000;

function asTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * How long a competitor's roles stay open, per canonical department.
 *
 * DISPLAY ONLY, never a signal. The clock starts at `postedAt` when the board
 * states one and at `detectedAt` otherwise, and `detectedAt` is the day WE first
 * saw the role, not the day it went up. A median built on that mixture is a
 * lower bound on the real one, so any bucket where enough of the points fall
 * back is flagged and the UI says so rather than printing a number that quietly
 * means something else.
 *
 * `unknown` is excluded (a data-quality bucket, not a department) and so are
 * non-positive durations, which are clock skew rather than instant hires.
 */
export function timeToFillByBucket(
  closed: ReadonlyArray<ClosedPostingInput>,
): TimeToFillBucket[] {
  const byBucket = new Map<DepartmentBucket, { days: number[]; fallbacks: number }>();

  for (const p of closed) {
    const end = asTime(p.closedAt);
    const posted = p.postedAt == null ? null : asTime(p.postedAt);
    const fellBack = posted == null || !Number.isFinite(posted);
    const start = fellBack ? asTime(p.detectedAt) : (posted as number);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const days = (end - start) / DAY_MS;
    if (days <= 0) continue;

    const bucket = normalizeDepartment(p.department, null, p.title);
    if (bucket === "unknown") continue;
    const group = byBucket.get(bucket) ?? { days: [], fallbacks: 0 };
    group.days.push(days);
    if (fellBack) group.fallbacks++;
    byBucket.set(bucket, group);
  }

  const out: TimeToFillBucket[] = [];
  for (const [bucket, group] of byBucket) {
    if (group.days.length < TIME_TO_FILL_MIN_N) continue;
    const sorted = [...group.days].sort((a, b) => a - b);
    out.push({
      bucket,
      label: DEPARTMENT_BUCKET_LABELS[bucket],
      medianDays: Math.round(percentile(sorted, 0.5) as number),
      n: sorted.length,
      approx: group.fallbacks / sorted.length >= TIME_TO_FILL_APPROX_SHARE,
    });
  }
  // Widest evidence first, the same order the salary bands render in.
  return out.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

// ── leadership ──────────────────────────────────────────────────────────────

export type LeadershipRank = "c_level" | "vp_head";

// "Chief Revenue Officer", "Chief Product & Technology Officer". Anchored on both
// words so a "Chief of Staff" or a lone "officer" (security officer, loan officer)
// can never match.
const C_LEVEL_TITLE = /\bchief\s+[\w&/ -]{2,40}?officer\b/i;
// CEO / CTO / CRO / CMO / COO / CPO. Exactly three letters, so a four-letter word
// starting with c and ending in o cannot slip in.
const C_LEVEL_ACRONYM = /\bc[a-z]o\b/i;
const VP_HEAD = [
  /\bvp\b/i,
  /\bvice[\s-]?pr[eé]sident(e)?\b/i,
  /\bhead\s+of\s+\w+/i,
];

/**
 * Is this an executive hire, and how senior?
 *
 * Deliberately narrow. "Director" is out: on most boards it is a senior IC band
 * and it would drown the signal. The French titles that would be the obvious
 * additions are out for the same reason but harder: "directeur general" is a
 * legal role that names no function, and "responsable" is French for anything
 * from a team lead to a shift manager. A signal that fires on those says nothing
 * about the org chart.
 *
 * `seniority` is the ATS's own answer where a provider states one, and it
 * promotes a title the regexes miss, but never past `vp_head`: only the title
 * can say C-level, and that is what separates high from medium.
 */
export function classifyLeadershipRole(
  title: string,
  seniority?: string | null,
): LeadershipRank | null {
  if (C_LEVEL_TITLE.test(title) || C_LEVEL_ACRONYM.test(title)) return "c_level";
  if (VP_HEAD.some((re) => re.test(title))) return "vp_head";
  if (seniority?.toLowerCase() === "executive") return "vp_head";
  return null;
}

/** "high" for a C-level hire, "medium" for a VP or a Head of. */
export function leadershipSeverity(ranks: ReadonlyArray<LeadershipRank>): "medium" | "high" {
  return ranks.includes("c_level") ? "high" : "medium";
}

// ── momentum ────────────────────────────────────────────────────────────────

/** Weeks each side of the velocity comparison. */
export const MOMENTUM_WINDOW_WEEKS = 4;
/** Relative move under which the trend reads flat rather than up or down. */
export const MOMENTUM_FLAT_BAND = 0.1;
/** How recent a country or a leadership hire has to be to count as momentum. */
export const MOMENTUM_RECENT_DAYS = 90;

export interface VelocityTrend {
  direction: "up" | "flat" | "down";
  /** Open roles summed over the last `weeks` weeks. */
  recent: number;
  /** The same sum over the `weeks` before those. */
  prior: number;
  weeks: number;
}

export interface SalaryPosture {
  verdict: DisclosureVerdict;
  /** Median annual engineering pay, in the currency it was quoted in. */
  engP50: number | null;
  currency: string | null;
  n: number;
}

export interface MomentumInput {
  /** Total open roles per ISO week (hiring_metrics summed per week), any order. */
  weeklyTotals: ReadonlyArray<{ weekStart: string; openCount: number }>;
  /** Country keys with the first week they ever appeared in hiring_geo. */
  countries: ReadonlyArray<{ code: string; firstWeek: string; openCount: number }>;
  /** Leadership roles on the board, with when we first saw each one. */
  leadership: ReadonlyArray<{ title: string; detectedAt: Date | string; rank: LeadershipRank }>;
  salary: SalaryPosture | null;
  now?: Date;
}

export interface MomentumFacts {
  velocityTrend: VelocityTrend | null;
  /** ISO country codes first seen inside the recency window. */
  newCountries: string[];
  leadershipHires: Array<{ title: string; rank: LeadershipRank }>;
  salaryPosture: SalaryPosture | null;
}

/** How many names a momentum line prints before it stops naming them. */
const MOMENTUM_MAX_NAMES = 4;

/**
 * The four readings the Momentum section is rendered from.
 *
 * Every field is nullable or empty-able and NOTHING is inferred: a competitor
 * with six weeks of history has no velocity trend, and the section simply has
 * one line fewer. That is the entire contract with the battle card, whose other
 * sections are model-written and whose Momentum section must never be.
 */
export function momentumFacts(input: MomentumInput): MomentumFacts {
  const now = input.now ?? new Date();
  const since = now.getTime() - MOMENTUM_RECENT_DAYS * DAY_MS;

  return {
    velocityTrend: velocityTrend(input.weeklyTotals),
    newCountries: [...input.countries]
      .filter((c) => c.openCount > 0 && new Date(`${c.firstWeek}T00:00:00.000Z`).getTime() >= since)
      .sort((a, b) => b.openCount - a.openCount || a.code.localeCompare(b.code))
      .map((c) => c.code),
    leadershipHires: [...input.leadership]
      .filter((l) => asTime(l.detectedAt) >= since)
      .sort((a, b) => asTime(b.detectedAt) - asTime(a.detectedAt))
      .map((l) => ({ title: l.title, rank: l.rank })),
    salaryPosture: input.salary,
  };
}

/**
 * Open roles over the last four weeks against the four before them.
 *
 * Null under eight weeks of history, and null when the earlier window is empty:
 * a board that went from nothing to nine roles has no ratio, and reporting one
 * would be reporting the week we started looking.
 */
function velocityTrend(
  weekly: ReadonlyArray<{ weekStart: string; openCount: number }>,
): VelocityTrend | null {
  const byWeek = new Map<string, number>();
  for (const w of weekly) byWeek.set(w.weekStart, (byWeek.get(w.weekStart) ?? 0) + w.openCount);
  const points = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (points.length < MOMENTUM_WINDOW_WEEKS * 2) return null;

  const sum = (slice: Array<[string, number]>) => slice.reduce((s, [, n]) => s + n, 0);
  const recent = sum(points.slice(-MOMENTUM_WINDOW_WEEKS));
  const prior = sum(points.slice(-MOMENTUM_WINDOW_WEEKS * 2, -MOMENTUM_WINDOW_WEEKS));
  if (prior <= 0) return null;

  const move = (recent - prior) / prior;
  return {
    direction: Math.abs(move) < MOMENTUM_FLAT_BAND ? "flat" : move > 0 ? "up" : "down",
    recent,
    prior,
    weeks: MOMENTUM_WINDOW_WEEKS,
  };
}

/** "DE" to "Germany". ICU ships in every runtime we run on, so no table is needed. */
export function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function nameList(names: string[]): string {
  const shown = names.slice(0, MOMENTUM_MAX_NAMES);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} (+${rest} more)` : shown.join(", ");
}

const money = (amount: number, currency: string | null): string =>
  currency
    ? `${new Intl.NumberFormat("en-US").format(amount)} ${currency}`
    : new Intl.NumberFormat("en-US").format(amount);

/**
 * The Momentum section, as lines.
 *
 * Rendering lives here rather than in the component because the SAME strings are
 * handed to the battle card's generation as evidence: if the model refers to
 * their hiring anywhere else on the card, it has to be referring to the exact
 * sentence the reader can see under it. A fact that is null produces no line, and
 * no line ever hedges.
 */
export function momentumLines(facts: MomentumFacts): string[] {
  const lines: string[] = [];

  const v = facts.velocityTrend;
  if (v) {
    const verb = v.direction === "up" ? "up" : v.direction === "down" ? "down" : "flat";
    lines.push(
      `Hiring velocity ${verb}: ${v.recent} open roles over the last ${v.weeks} weeks ` +
        `against ${v.prior} in the ${v.weeks} before.`,
    );
  }

  if (facts.newCountries.length > 0) {
    lines.push(
      `New markets: ${nameList(facts.newCountries.map(countryLabel))}, ` +
        `first seen in the last ${MOMENTUM_RECENT_DAYS} days.`,
    );
  }

  if (facts.leadershipHires.length > 0) {
    lines.push(
      `Leadership: ${nameList(facts.leadershipHires.map((l) => l.title))}, ` +
        `posted in the last ${MOMENTUM_RECENT_DAYS} days.`,
    );
  }

  const s = facts.salaryPosture;
  if (s) {
    const posture =
      s.verdict === "yes"
        ? "published"
        : s.verdict === "partial"
          ? "published on some roles"
          : "not published";
    const eng =
      s.engP50 != null ? `, engineering median ${money(s.engP50, s.currency)} (n=${s.n})` : "";
    lines.push(`Salaries: ${posture}${eng}.`);
  }

  return lines;
}
