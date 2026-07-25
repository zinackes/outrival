import { isComparablePricePeriod } from "@outrival/shared";
import type { CompareColumn } from "@/lib/api";

/**
 * Everything the compare page reads OUT of the matrix: the shared scales the bars
 * are drawn on, the tech diff, and the verdict the page opens with.
 *
 * Pure and DB-free on purpose — the verdict is arithmetic over captured data, not an
 * AI call. A sentence the page states as fact has to be reproducible and testable,
 * and this module is where that is enforced (see test/compare-derive.test.ts).
 */

// ── scalar readings ─────────────────────────────────────────────────────────

/** Lowest comparable published price, or null when only quote tiers were captured. */
export function entryOf(c: CompareColumn): number | null {
  return c.pricing?.entry ?? null;
}

export function topOf(c: CompareColumn): number | null {
  return c.pricing?.top ?? null;
}

/** Average score across a competitor's review sources; null when none captured. */
export function avgReview(c: CompareColumn): number | null {
  if (c.reviews.length === 0) return null;
  return c.reviews.reduce((s, r) => s + r.score, 0) / c.reviews.length;
}

export function openRoles(c: CompareColumn): number | null {
  return c.hiring?.totalOpen ?? null;
}

/** Canonical engineering bucket; null when no ATS run bucketed this competitor. */
export function engineeringRoles(c: CompareColumn): number | null {
  return c.hiring?.engineeringOpen ?? null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // Even count → the mean of the two middle values.
  return s.length % 2 === 0 ? ((s[mid - 1] as number) + (s[mid] as number)) / 2 : (s[mid] as number);
}

// ── scales ──────────────────────────────────────────────────────────────────

/**
 * Round a scale ceiling up to a value whose axis reads in round numbers (100, 250,
 * 500, 1000…). A raw max of 399 would put the widest bar flush against the edge and
 * label the axis "$399", which is a data point pretending to be a scale.
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Evenly spaced axis labels from 0 to max, inclusive of both ends. */
export function axisTicks(max: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push((max / count) * i);
  return out;
}

/**
 * A currency + billing period the compared set actually publishes on. Prices are never
 * converted here: a band is only ever drawn from plans quoted on the SAME basis, so
 * switching the basis re-reads captured numbers instead of inventing exchanged ones.
 */
export interface PriceBasis {
  currency: string | null;
  /** Raw billing period ("monthly" | "yearly" | "one_time"). */
  period: string | null;
}

export function basisKey(basis: PriceBasis): string {
  return `${basis.currency ?? "—"}:${basis.period ?? "—"}`;
}

/** A column's plans that carry a chartable number, with the period each is quoted on. */
function comparablePlans(c: CompareColumn): Array<{ price: number; period: string | null }> {
  const p = c.pricing;
  if (!p) return [];
  const out: Array<{ price: number; period: string | null }> = [];
  for (const plan of p.plans) {
    // A plan row without its own period inherits the column's.
    const period = plan.billingPeriod ?? p.billingPeriod;
    if (plan.price == null || !isComparablePricePeriod(period)) continue;
    out.push({ price: plan.price, period });
  }
  return out;
}

// Reading order for equally-represented bases: how a buyer thinks about a price.
const PERIOD_RANK: Record<string, number> = { monthly: 0, yearly: 1, one_time: 2 };
const periodRank = (period: string | null): number =>
  period == null ? 9 : (PERIOD_RANK[period] ?? 8);

/** Every basis the compared set publishes on, most-represented first. */
export function priceBases(
  cols: CompareColumn[],
): Array<PriceBasis & { key: string; columns: number }> {
  const seen = new Map<string, PriceBasis & { key: string; columns: number }>();
  for (const c of cols) {
    const currency = c.pricing?.currency ?? null;
    const periods = new Set<string | null>(comparablePlans(c).map((p) => p.period));
    // A column whose plan rows never came back still stands on the basis its own
    // band was computed on — otherwise it would vanish from the picker entirely.
    if (periods.size === 0 && c.pricing?.entry != null) periods.add(c.pricing.billingPeriod);
    for (const period of periods) {
      const key = basisKey({ currency, period });
      const cur = seen.get(key);
      if (cur) cur.columns++;
      else seen.set(key, { currency, period, key, columns: 1 });
    }
  }
  return [...seen.values()].sort(
    (a, b) => b.columns - a.columns || periodRank(a.period) - periodRank(b.period),
  );
}

export interface Band {
  entry: number;
  top: number;
}

/**
 * A column's entry-to-top band, read on `basis`. Null when the column publishes
 * nothing comparable there (quote-only, another currency, or no plan on that period)
 * — the row then says so rather than borrowing a number from another basis.
 */
export function bandOf(c: CompareColumn, basis?: PriceBasis | null): Band | null {
  const p = c.pricing;
  if (!p) return null;
  const own = p.entry != null && p.top != null ? { entry: p.entry, top: p.top } : null;
  if (!basis) return own;
  if ((p.currency ?? null) !== basis.currency) return null;
  const prices = comparablePlans(c)
    .filter((pl) => pl.period === basis.period)
    .map((pl) => pl.price);
  if (prices.length === 0) {
    return own && (p.billingPeriod ?? null) === basis.period ? own : null;
  }
  return { entry: Math.min(...prices), top: Math.max(...prices) };
}

export interface PriceScale {
  /** Upper bound of the axis in force (0-based). */
  max: number;
  /** The readable ceiling: outliers excluded. */
  robustMax: number;
  /** The ceiling that covers every band, outliers included. */
  fullMax: number;
  /** True when at least one band runs past `max` and is drawn clipped. */
  clipped: boolean;
  /** Median entry price across every priced column, the dashed reference line. */
  medianEntry: number | null;
  currency: string | null;
  /** "mo" | "yr" | null — the period the band is quoted in. */
  period: string | null;
  /** True when at least one column carries a comparable number. */
  hasData: boolean;
}

// How many times the median top a band may reach before it counts as an outlier that
// owns the axis. One $2,400 enterprise tier against four $99 products flattens every
// other bar into an invisible sliver, which is a chart that answers nothing.
const OUTLIER_FACTOR = 4;

/**
 * The largest top worth scaling to: the raw maximum, unless it dwarfs the median, in
 * which case the highest NON-outlier top. Bands past it are drawn clipped, and their
 * true number is still read in the row's own value.
 */
export function robustCeiling(tops: number[]): number {
  if (tops.length === 0) return 0;
  const raw = Math.max(...tops);
  const med = median(tops) ?? raw;
  if (med <= 0 || raw <= med * OUTLIER_FACTOR) return raw;
  const inliers = tops.filter((t) => t <= med * OUTLIER_FACTOR);
  return inliers.length ? Math.max(...inliers) : raw;
}

export function priceScale(
  cols: CompareColumn[],
  opts: { basis?: PriceBasis | null; full?: boolean } = {},
): PriceScale {
  const basis = opts.basis ?? null;
  const bands = cols.map((c) => bandOf(c, basis)).filter((b): b is Band => b != null);
  const tops = bands.map((b) => b.top);
  const entries = bands.map((b) => b.entry);
  const priced = cols.find((c) => c.pricing && c.pricing.entry != null);
  const fullMax = tops.length ? niceMax(Math.max(...tops)) : 1;
  const robustMax = tops.length ? niceMax(robustCeiling(tops)) : 1;
  const max = opts.full ? fullMax : robustMax;
  return {
    max,
    robustMax,
    fullMax,
    clipped: tops.some((t) => t > max),
    medianEntry: median(entries),
    currency:
      basis?.currency ??
      priced?.pricing?.currency ??
      cols.find((c) => c.pricing)?.pricing?.currency ??
      null,
    period: periodLabel(basis ? basis.period : (priced?.pricing?.billingPeriod ?? null)),
    hasData: tops.length > 0,
  };
}

export function periodLabel(billingPeriod: string | null): string | null {
  if (!billingPeriod) return null;
  if (billingPeriod === "monthly") return "mo";
  if (billingPeriod === "yearly") return "yr";
  if (billingPeriod === "one_time") return "one-time";
  return billingPeriod;
}

/** How a basis reads in the picker and the lens header: "USD / mo". */
export function basisLabel(basis: PriceBasis): string {
  return [basis.currency, periodLabel(basis.period)].filter(Boolean).join(" / ");
}

/** The period as an adjective, for a sentence: "No annual price". */
export function periodWord(period: string | null): string {
  if (period === "monthly") return "monthly";
  if (period === "yearly") return "annual";
  if (period === "one_time") return "one-time";
  return "comparable";
}

export interface HiringScale {
  max: number;
  hasData: boolean;
  /** True when at least one column has a bucketed engineering count to pick out. */
  hasEngineering: boolean;
}

export function hiringScale(cols: CompareColumn[]): HiringScale {
  const totals = cols.map(openRoles).filter((v): v is number => v != null);
  return {
    max: totals.length ? Math.max(...totals) : 1,
    hasData: totals.length > 0,
    hasEngineering: cols.some((c) => engineeringRoles(c) != null),
  };
}

export interface RatingScale {
  median: number | null;
  hasData: boolean;
  /** Column ids holding the top average score (empty unless 2+ columns are scored). */
  best: Set<string>;
}

export function ratingScale(cols: CompareColumn[]): RatingScale {
  const scored = cols
    .map((c) => ({ id: c.id, avg: avgReview(c) }))
    .filter((x): x is { id: string; avg: number } => x.avg != null);
  const best = new Set<string>();
  if (scored.length >= 2) {
    const top = Math.max(...scored.map((x) => x.avg));
    for (const x of scored) if (x.avg === top) best.add(x.id);
  }
  return {
    median: median(scored.map((x) => x.avg)),
    hasData: scored.length > 0,
    best,
  };
}

// ── tech diff ───────────────────────────────────────────────────────────────

/** Notable tech + the routed platform values, as one deduped list per column. */
export function techOf(c: CompareColumn): string[] {
  const platform = c.platform
    ? [c.platform.framework, c.platform.cms, c.platform.hosting, c.platform.ats]
    : [];
  const all = [...c.tech, ...platform].filter((v): v is string => Boolean(v));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of all) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export interface TechDiff {
  /** Run by every compared column (2+ columns only) — stated once, dropped from rows. */
  shared: string[];
  /** Per column id: what it runs that is NOT shared, flagged when it alone runs it. */
  byId: Map<string, Array<{ name: string; only: boolean }>>;
}

export function techDiff(cols: CompareColumn[]): TechDiff {
  const lists = cols.map((c) => ({ id: c.id, names: techOf(c) }));
  // Count columns per tech, keyed by lowercase so "Next.js" and "next.js" are one.
  const holders = new Map<string, { label: string; ids: Set<string> }>();
  for (const { id, names } of lists) {
    for (const name of names) {
      const key = name.toLowerCase();
      const cur = holders.get(key);
      if (cur) cur.ids.add(id);
      else holders.set(key, { label: name, ids: new Set([id]) });
    }
  }
  const shared: string[] = [];
  if (cols.length >= 2) {
    for (const { label, ids } of holders.values()) {
      if (ids.size === cols.length) shared.push(label);
    }
  }
  const sharedKeys = new Set(shared.map((s) => s.toLowerCase()));
  const byId = new Map<string, Array<{ name: string; only: boolean }>>();
  for (const { id, names } of lists) {
    byId.set(
      id,
      names
        .filter((n) => !sharedKeys.has(n.toLowerCase()))
        .map((n) => ({ name: n, only: (holders.get(n.toLowerCase())?.ids.size ?? 1) === 1 })),
    );
  }
  return { shared, byId };
}

// ── verdict ─────────────────────────────────────────────────────────────────

export type Tone = "good" | "bad" | "warn" | "flat";
export type LensId = "price" | "rating" | "hiring" | "stack" | "moves";

/**
 * A run of verdict prose. `num` segments are the machine's own numbers and render in
 * mono, so the sentence keeps the data voice the rest of the product uses.
 */
export type Segment = { t: "text"; v: string } | { t: "num"; v: string };

export interface Fact {
  key: string;
  /** Emphasised opening of the line. */
  lead: string;
  /** The rest of the line, plain. */
  rest: string;
  /** Right-aligned mono reading. */
  value: string;
  tone: Tone;
  /** The lens this was read from — the line scrolls there. */
  lens: LensId;
}

export interface Verdict {
  lead: Segment[];
  facts: Fact[];
}

export function money(value: number, currency: string | null): string {
  if (!currency) return String(Math.round(value));
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** "five" up to ten, then digits — the set is capped at six columns anyway. */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** "Acme" · "Acme and Beta" · "Acme, Beta and 2 others" */
export function nameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] as string;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** "today" · "2d" · "3w" — the age form the feed rows use. */
export function shortAge(iso: string, now = Date.now()): string {
  const days = daysSince(iso, now);
  if (days === 0) return "today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

/**
 * The same age as a phrase that can follow "captured": "today", or "2d ago". Exists
 * so no caller ever composes "captured today ago".
 */
export function agePhrase(iso: string, now = Date.now()): string {
  const age = shortAge(iso, now);
  return age === "today" ? "today" : `${age} ago`;
}

// A competitor move stops being news past this, so the verdict stops leading with it.
const MOVE_FRESH_DAYS = 14;
// The engineering gap only earns a line once it is this multiple of your own count,
// so a 3-versus-4 difference never reads as a threat.
const ENG_GAP_MULTIPLE = 2;

/**
 * The reading the page opens on: two or three sentences, then the anchored facts.
 * Every claim is arithmetic over the captured columns, and any dimension nobody has
 * data for is simply left unsaid rather than hedged.
 */
export function buildVerdict(
  you: CompareColumn,
  comps: CompareColumn[],
  now = Date.now(),
): Verdict {
  const lead: Segment[] = [];
  const facts: Fact[] = [];
  const total = comps.length + 1;
  const text = (v: string) => lead.push({ t: "text", v });
  const num = (v: string) => lead.push({ t: "num", v });

  // ── rating standing
  const youAvg = avgReview(you);
  const compAvgs = comps
    .map((c) => ({ name: c.name, avg: avgReview(c) }))
    .filter((x): x is { name: string; avg: number } => x.avg != null);
  const ratingMed = median([...compAvgs.map((x) => x.avg), ...(youAvg != null ? [youAvg] : [])]);
  let ratingStanding: string | null = null;
  if (youAvg != null && compAvgs.length > 0) {
    const others = compAvgs.map((x) => x.avg);
    if (youAvg >= Math.max(...others)) {
      ratingStanding = `the best rated of the ${countWord(total)}`;
      facts.push({
        key: "rating",
        lead: "Best rated",
        rest: `of the set, ahead of ${bestOther(compAvgs)}`,
        value: `${youAvg.toFixed(1)} vs ${(ratingMed ?? youAvg).toFixed(1)} med`,
        tone: "good",
        lens: "rating",
      });
    } else if (youAvg <= Math.min(...others)) {
      ratingStanding = `the lowest rated of the ${countWord(total)}`;
      facts.push({
        key: "rating",
        lead: "Lowest rated",
        rest: `of the set, behind ${bestOther(compAvgs)}`,
        value: `${youAvg.toFixed(1)} vs ${(ratingMed ?? youAvg).toFixed(1)} med`,
        tone: "bad",
        lens: "rating",
      });
    } else {
      ratingStanding = "mid-table on reviews";
      facts.push({
        key: "rating",
        lead: "Mid-table on reviews",
        rest: `between ${worstOther(compAvgs)} and ${bestOther(compAvgs)}`,
        value: `${youAvg.toFixed(1)} vs ${(ratingMed ?? youAvg).toFixed(1)} med`,
        tone: "flat",
        lens: "rating",
      });
    }
  }

  // ── price standing
  const youEntry = entryOf(you);
  const currency = you.pricing?.currency ?? comps.find((c) => c.pricing)?.pricing?.currency ?? null;
  const compEntries = comps
    .map((c) => ({ name: c.name, entry: entryOf(c) }))
    .filter((x): x is { name: string; entry: number } => x.entry != null);
  let priceStanding: string | null = null;
  let cheaper: Array<{ name: string; entry: number }> = [];
  if (youEntry != null && compEntries.length > 0) {
    cheaper = compEntries.filter((x) => x.entry < youEntry);
    const dearer = compEntries.filter((x) => x.entry > youEntry);
    if (cheaper.length === 0) {
      priceStanding = "the cheapest way in";
      facts.push({
        key: "price",
        lead: "Cheapest entry price",
        rest: `of the ${countWord(total)}`,
        value: money(youEntry, currency),
        tone: "good",
        lens: "price",
      });
    } else if (dearer.length === 0) {
      priceStanding = "the dearest way in";
      const min = Math.min(...compEntries.map((x) => x.entry));
      facts.push({
        key: "price",
        lead: "Highest entry price",
        rest: `of the ${countWord(total)}`,
        value: `${money(youEntry, currency)} vs ${money(min, currency)}`,
        tone: "bad",
        lens: "price",
      });
    } else {
      priceStanding = "mid-table on price";
      const min = Math.min(...cheaper.map((x) => x.entry));
      facts.push({
        key: "price",
        lead: cheaper.length === 1 ? "Second cheapest" : `Cheaper than ${countWord(dearer.length)}`,
        rest: cheaper.length === 1 ? `entry price, behind ${cheaper[0]?.name}` : "of them at the door",
        value: `${money(youEntry, currency)} · +${money(youEntry - min, currency)}`,
        tone: "flat",
        lens: "price",
      });
    }
  }

  // ── sentence one: where you stand.
  // "the cheapest way in" reads after "is"; "mid-table on price" needs "sits".
  if (ratingStanding || priceStanding) {
    const joined =
      ratingStanding && priceStanding
        ? ratingStanding === "mid-table on reviews" && priceStanding === "mid-table on price"
          ? "mid-table on both reviews and price"
          : `${ratingStanding} and ${
              priceStanding.startsWith("the ") ? priceStanding : `sits ${priceStanding}`
            }`
        : (ratingStanding ?? (priceStanding as string));
    text(`${you.name} is ${joined}. `);
  }

  // ── sentence two: who undercuts you, named
  if (youEntry != null && cheaper.length > 0) {
    const min = Math.min(...cheaper.map((x) => x.entry));
    if (cheaper.length === 1) {
      text(`${cheaper[0]?.name} is the only one cheaper at the door, by `);
      num(money(youEntry - min, currency));
      text(". ");
    } else {
      text(`${nameList(cheaper.map((x) => x.name))} are cheaper at the door, from `);
      num(money(min, currency));
      text(". ");
    }
  }

  // ── sentence three: the pressure, hiring first then the freshest move
  const youEng = engineeringRoles(you);
  const engLeader = comps
    .map((c) => ({ name: c.name, eng: engineeringRoles(c) }))
    .filter((x): x is { name: string; eng: number } => x.eng != null)
    .sort((a, b) => b.eng - a.eng)[0];
  const engGap =
    youEng != null && engLeader && engLeader.eng >= Math.max(1, youEng) * ENG_GAP_MULTIPLE
      ? engLeader
      : null;
  if (engGap && youEng != null) {
    text(`${engGap.name} has `);
    num(String(engGap.eng));
    text(" engineering roles open against your ");
    num(String(youEng));
    text(". ");
    facts.push({
      key: "hiring",
      lead: "Out-hired in engineering",
      rest: `by ${engGap.name}`,
      value: `${youEng} vs ${engGap.eng}`,
      tone: "bad",
      lens: "hiring",
    });
  } else if (youEng != null && engLeader) {
    facts.push({
      key: "hiring",
      lead: "Hiring in step",
      rest: `with ${engLeader.name}, the most active of them`,
      value: `${youEng} vs ${engLeader.eng} eng`,
      tone: "flat",
      lens: "hiring",
    });
  }

  const freshMove = comps
    .map((c) => c.latestSignal)
    .filter((s): s is NonNullable<CompareColumn["latestSignal"]> => s != null)
    .filter((s) => ["critical", "high"].includes(s.severity))
    .filter((s) => daysSince(s.createdAt, now) <= MOVE_FRESH_DAYS)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (freshMove) {
    const mover = comps.find((c) => c.latestSignal?.id === freshMove.id);
    facts.push({
      key: "moves",
      lead: `${mover?.name ?? "One of them"} just moved`,
      rest: firstClause(freshMove.insight),
      value: shortAge(freshMove.createdAt, now),
      tone: freshMove.severity === "critical" ? "bad" : "warn",
      lens: "moves",
    });
  }

  // What needs attention leads. The page exists to surface the thing you would have
  // missed, not to congratulate you first.
  const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, good: 2, flat: 3 };
  facts.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);

  return { lead, facts };
}

function bestOther(list: Array<{ name: string; avg: number }>): string {
  const best = [...list].sort((a, b) => b.avg - a.avg)[0];
  return best?.name ?? "them";
}

function worstOther(list: Array<{ name: string; avg: number }>): string {
  const worst = [...list].sort((a, b) => a.avg - b.avg)[0];
  return worst?.name ?? "them";
}

/**
 * The first clause of a signal insight, lowercased to sit after the fact's lead
 * ("Klarity just moved · cut its entry plan to $49"). Capped so a long insight can
 * never push the fact line onto two rows.
 */
function firstClause(insight: string, max = 72): string {
  const clause = insight.split(/(?<=[.;])\s|,\s/)[0] ?? insight;
  const trimmed = clause.replace(/[.;]$/, "").trim();
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return lower.length > max ? `${lower.slice(0, max - 1).trimEnd()}…` : lower;
}
