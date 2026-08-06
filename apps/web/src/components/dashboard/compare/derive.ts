import { isComparablePricePeriod, type CostMethod } from "@outrival/shared";
import type { CompareColumn } from "@/lib/api";
import { competitorStroke } from "@/lib/competitor-color";
import { median, robustCeiling } from "@/lib/robust-scale";
import type { CompareEntity } from "./lens";

/**
 * Everything the compare page reads OUT of the matrix: the shared scales the bars
 * are drawn on, the tech diff, and the verdict the page opens with.
 *
 * Pure and DB-free on purpose — the verdict is arithmetic over captured data, not an
 * AI call. A sentence the page states as fact has to be reproducible and testable,
 * and this module is where that is enforced (see test/compare-derive.test.ts).
 */

// ── scalar readings ─────────────────────────────────────────────────────────

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

/**
 * Median annual engineering pay, in the currency the postings quote it in (P3).
 *
 * Returned WITH its currency and never normalised, unlike the price lens above.
 * Prices are a published number the reader is choosing between, so putting them on
 * one axis earns its FX approximation; salaries are a read on how a competitor
 * values a function in its own labour market, and converting €72k to dollars answers
 * a question nobody asked while making the figure move with the exchange rate. So
 * the lens shows both numbers and positions neither.
 */
export function engineeringMedianSalary(
  c: CompareColumn,
): { p50: number; currency: string; n: number } | null {
  return c.hiring?.engineeringMedianSalary ?? null;
}

// The outlier rule and the median it needs are shared with the Trends charts, which
// are crushed by exactly the same one-enterprise-plan field — a lens and a slopegraph
// disagreeing on what counts as an outlier would be two different products.
export { median, robustCeiling } from "@/lib/robust-scale";

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

export interface CostAxis {
  log: boolean;
  /** Set only on a log axis: recharts needs an explicit domain to build one. */
  domain: [number, number] | undefined;
  ticks: number[] | undefined;
}

/**
 * The cost-curve Y axis, and whether it can be read on a log scale.
 *
 * Its X axis spans seven orders of magnitude, so the costs plotted against it do
 * too: on a linear Y the whole first half of every curve — every volume under about
 * 100k — lies flat on the floor, and "where does the ranking flip" (the only
 * question that chart exists for) is unreadable exactly where most readers sit.
 * Log fixes it, and unlike a price ladder it is the honest scale here: both axes
 * are then ratios, so a straight line means a constant rate per unit.
 *
 * It only works on strictly positive costs, though. A free tier costs $0 at low
 * volume, which has no place on a log axis, and floor-clipping it would draw "free"
 * as merely "cheap" — a chart lying about the one number a reader would act on. So
 * a set containing a $0 stays linear, and the chart's caption says which scale is
 * in force either way.
 */
export function costAxis(rows: Array<Record<string, number>>): CostAxis {
  const LINEAR: CostAxis = { log: false, domain: undefined, ticks: undefined };
  const costs = rows.flatMap((row) =>
    Object.entries(row)
      .filter(([key]) => key !== "qty")
      .map(([, value]) => value),
  );
  if (costs.length === 0 || costs.some((c) => c <= 0)) return LINEAR;

  const lo = 10 ** Math.floor(Math.log10(Math.min(...costs)));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...costs)));
  // Under two decades of spread there is nothing being crushed, and log ticks read
  // worse than linear ones.
  if (hi / lo < 100) return LINEAR;

  const ticks: number[] = [];
  for (let t = lo; t <= hi; t *= 10) ticks.push(t);
  return { log: true, domain: [lo, hi], ticks };
}

/** Evenly spaced axis labels from 0 to max, inclusive of both ends. */
export function axisTicks(max: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push((max / count) * i);
  return out;
}

/** A column's plans that carry a chartable number, with the period each is quoted on. */
function comparablePlans(c: CompareColumn): Array<{ price: number; period: string }> {
  const p = c.pricing;
  if (!p) return [];
  const out: Array<{ price: number; period: string }> = [];
  for (const plan of p.plans) {
    // A plan row without its own period inherits the column's.
    const period = plan.billingPeriod ?? p.billingPeriod;
    if (plan.price == null || !isComparablePricePeriod(period)) continue;
    out.push({ price: plan.price, period: period as string });
  }
  // A column whose plan rows never came back still stands on the band the API
  // computed for it, rather than vanishing off the lens entirely.
  const own = p.billingPeriod;
  if (out.length === 0 && p.entry != null && p.top != null && isComparablePricePeriod(own)) {
    const period = own as string;
    out.push({ price: p.entry, period }, { price: p.top, period });
  }
  return out;
}

export interface Band {
  entry: number;
  top: number;
}

/**
 * The currency the lens normalises to. A comparison only means something on ONE unit,
 * so the axis is fixed and prices are converted onto it, rather than asking the reader
 * to pick a basis and hiding half the set behind whichever one they picked.
 */
export const DISPLAY_CURRENCY = "USD";

// A monthly axis can hold a yearly plan (÷12 is arithmetic, not a guess) but never a
// one-time price, which is not a rate at all.
const MONTHLY_DIVISOR: Record<string, number> = { monthly: 1, yearly: 12 };

// Which captured period a column is read on: whatever it actually publishes, cheapest
// unit of commitment first. Same order as shared/pricing.ts entryPrice(), so the
// compare lens and the products portfolio never pick different tiers off one table.
const PERIOD_ORDER = ["monthly", "yearly", "one_time"] as const;

interface Reading extends Band {
  /** True when the numbers were derived (converted and/or annual ÷12). */
  approx: boolean;
  /** Captured currency, when it isn't the one on screen. */
  from: string | null;
  /** Captured period the reading came off ("yearly" when read ÷12). */
  period: string;
}

/** A meter and a volume the lens is reading metered competitors at. */
export interface MeterSelection {
  unit: string;
  qty: number;
}

export type PriceBandReading = Reading & {
  kind: "band";
  /** Set when the band is a COST AT A VOLUME rather than a published price —
   * the reading that lets a usage-based competitor onto the axis at all. The
   * UI marks it, because "$800/mo at 10k requests" and "$800/mo" are not the
   * same claim. */
  meter?: MeterSelection | null;
  /** How that cost was arrived at (P4). `calculator_probe` was MEASURED on the
   * competitor's own calculator and has a screenshot behind it; the rest is our
   * arithmetic over a published ladder. Two different claims, marked apart. */
  method?: CostMethod | null;
  measuredAt?: string | null;
  hasEvidence?: boolean;
  evidenceKind?: "screenshot" | "api_response" | null;
};

/**
 * What a column contributes to the price lens. Every branch is a reading — a column
 * is never a blank cell, it either lands on the axis or says why it can't.
 *
 * - `band`      monthly amounts in the display currency (annual plans read ÷12).
 * - `one_time`  a one-off price, which has no monthly equivalent: read off-axis.
 * - `foreign`   captured in a currency no rate table could convert (offline / exotic).
 * - `quote`     a pricing page with no public number ("Contact sales").
 * - `none`      nothing captured at all.
 */
export type PriceReading =
  | PriceBandReading
  | (Reading & { kind: "one_time" })
  | { kind: "foreign"; currency: string }
  | { kind: "quote" }
  | { kind: "none" };

/** Units of `to` per one unit of `from`, or null when the pair can't be converted. */
function fxFactor(
  from: string,
  to: string,
  rates: Record<string, number> | null,
): number | null {
  if (from === to) return 1;
  const rf = rates?.[from];
  const rt = rates?.[to];
  if (!rf || !rt) return null;
  return rt / rf;
}

/**
 * A column read as a monthly price in `to`. Conversion is deliberate and marked: the
 * captured numbers still show in the row's plan breakdown, and anything derived from
 * them carries `approx` so the UI can say so rather than passing arithmetic off as
 * something the competitor published.
 */
export function priceReading(
  c: CompareColumn,
  rates: Record<string, number> | null,
  to: string = DISPLAY_CURRENCY,
  meter: MeterSelection | null = null,
): PriceReading {
  const p = c.pricing;
  if (!p) return { kind: "none" };
  const plans = comparablePlans(c);
  if (plans.length === 0) {
    // Nothing subscription-shaped to chart. Before calling it a quote, ask what
    // the competitor costs at the selected volume: a usage-based product has a
    // real, comparable monthly number, it just isn't printed on the page.
    const metered = meter ? meteredReading(c, rates, to, meter) : null;
    return metered ?? { kind: "quote" };
  }
  const currency = p.currency ?? to;
  const factor = fxFactor(currency, to, rates);
  if (factor == null) return { kind: "foreign", currency };
  const period = PERIOD_ORDER.find((cand) => plans.some((pl) => pl.period === cand));
  if (!period) return { kind: "quote" };
  const values = plans
    .filter((pl) => pl.period === period)
    .map((pl) => (pl.price * factor) / (MONTHLY_DIVISOR[period] ?? 1));
  return {
    kind: period === "one_time" ? "one_time" : "band",
    entry: Math.min(...values),
    top: Math.max(...values),
    approx: currency !== to || period === "yearly",
    from: currency === to ? null : currency,
    period,
  };
}

/**
 * A column read as what it costs to buy the selected volume, in `to`. One
 * point, not a range: there is no band to draw across, only the price of that
 * volume from whichever of its plans is cheapest there.
 *
 * The number itself was computed server-side by the same cost model that stored
 * the competitor's reference points, so the axis and the pricing tab can never
 * quote two different figures for one volume.
 */
function meteredReading(
  c: CompareColumn,
  rates: Record<string, number> | null,
  to: string,
  meter: MeterSelection,
): PriceReading | null {
  const hit = (c.pricing?.meters ?? []).find(
    (m) => m.unit === meter.unit && m.qty === meter.qty,
  );
  if (!hit) return null;
  const currency = hit.currency ?? c.pricing?.currency ?? to;
  const factor = fxFactor(currency, to, rates);
  if (factor == null) return { kind: "foreign", currency };
  const value = hit.cost * factor;
  const measured = hit.method === "calculator_probe";
  return {
    kind: "band",
    entry: value,
    top: value,
    // Still not a price the competitor PUBLISHED — but a measured cost is its own
    // calculator's answer, not our arithmetic, so only a converted one is approx.
    approx: measured ? currency !== to : true,
    from: currency === to ? null : currency,
    period: "usage",
    meter,
    method: hit.method ?? null,
    measuredAt: hit.measuredAt ?? null,
    hasEvidence: hit.hasEvidence ?? false,
    evidenceKind: hit.evidenceKind ?? null,
  };
}

/**
 * The meters the compared set can actually be read on, cheapest volume first.
 * Empty when nobody in the set publishes a rate we can price — the selector
 * then has nothing to offer and stays hidden.
 */
export function availableMeters(cols: CompareColumn[]): MeterSelection[] {
  const seen = new Map<string, MeterSelection>();
  for (const c of cols) {
    for (const m of c.pricing?.meters ?? []) {
      const key = `${m.unit}|${m.qty}`;
      if (!seen.has(key)) seen.set(key, { unit: m.unit, qty: m.qty });
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.unit === b.unit ? a.qty - b.qty : a.unit.localeCompare(b.unit),
  );
}

/**
 * The currency the lens reads in: USD once rates are in hand, otherwise whatever the
 * set is mostly captured in — an all-EUR set still reads on one axis when the rate
 * table is unreachable, instead of every row falling off a USD one.
 */
export function displayCurrency(
  cols: CompareColumn[],
  rates: Record<string, number> | null,
): string {
  if (rates?.[DISPLAY_CURRENCY]) return DISPLAY_CURRENCY;
  const counts = new Map<string, number>();
  for (const c of cols) {
    const cur = c.pricing?.currency;
    if (cur) counts.set(cur, (counts.get(cur) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DISPLAY_CURRENCY;
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
  currency: string;
  /** The axis unit — always monthly now that every band is normalised to it. */
  period: "mo";
  /** True when at least one column carries a comparable number. */
  hasData: boolean;
  /** Captured currencies that had to be converted to reach the axis, deduped. */
  converted: string[];
  /** True when at least one band was read off annual plans (÷12). */
  annualised: boolean;
}

export function priceScale(
  cols: CompareColumn[],
  opts: {
    rates?: Record<string, number> | null;
    to?: string;
    full?: boolean;
    /** When set, columns with no comparable subscription price enter the scale
     * at what they cost for this volume. Omitted → the pre-P3 scale exactly. */
    meter?: MeterSelection | null;
  } = {},
): PriceScale {
  const rates = opts.rates ?? null;
  const to = opts.to ?? displayCurrency(cols, rates);
  const readings = cols.map((c) => priceReading(c, rates, to, opts.meter ?? null));
  const bands = readings.filter((r): r is PriceBandReading => r.kind === "band");
  const tops = bands.map((b) => b.top);
  const entries = bands.map((b) => b.entry);
  const fullMax = tops.length ? niceMax(Math.max(...tops)) : 1;
  const robustMax = tops.length ? niceMax(robustCeiling(tops)) : 1;
  const max = opts.full ? fullMax : robustMax;
  return {
    max,
    robustMax,
    fullMax,
    clipped: tops.some((t) => t > max),
    medianEntry: median(entries),
    currency: to,
    period: "mo",
    hasData: tops.length > 0,
    converted: [...new Set(bands.map((b) => b.from).filter((f): f is string => f != null))],
    annualised: bands.some((b) => b.period === "yearly"),
  };
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

/** Releases per month, or null when this competitor has no honest reading yet. */
export function releasesPerMonth(c: CompareColumn): number | null {
  return c.shipping?.perMonth ?? null;
}

/**
 * How the rate moved against the window before it: "up" | "down" | null.
 *
 * Null covers two different things on purpose — no previous window to compare
 * against, and a move too small to call. A 5% wobble in a monthly count is arithmetic,
 * not a change of pace, and an arrow drawn on it would read as news every month.
 */
export function releaseTrend(c: CompareColumn): "up" | "down" | null {
  const s = c.shipping;
  if (!s || s.previousPerMonth == null) return null;
  const before = s.previousPerMonth;
  const after = s.perMonth;
  // A competitor that shipped nothing and now ships something IS a direction.
  if (before === 0) return after > 0 ? "up" : null;
  const ratio = (after - before) / before;
  if (Math.abs(ratio) < RELEASE_TREND_MIN_MOVE) return null;
  return ratio > 0 ? "up" : "down";
}

/** Relative move below which the cadence is called flat. */
const RELEASE_TREND_MIN_MOVE = 0.15;

export interface ShippingScale {
  max: number;
  hasData: boolean;
  /** The tallest single MONTH across the set — the scale the mini bars share, so a
   *  competitor's spike reads as a spike next to the others rather than against
   *  itself. */
  monthMax: number;
}

export function shippingScale(cols: CompareColumn[]): ShippingScale {
  const rates = cols.map(releasesPerMonth).filter((v): v is number => v != null);
  const monthCounts = cols.flatMap((c) => (c.shipping?.months ?? []).map((m) => m.count));
  return {
    max: rates.length ? Math.max(...rates) : 1,
    hasData: rates.length > 0,
    monthMax: monthCounts.length ? Math.max(...monthCounts, 1) : 1,
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
  /**
   * Who the reading is about — its favicon leads the chip, so a fact is attached to a
   * face before it is read. Your product for your own standing (price, rating), the
   * competitor applying the pressure for the rest (out-hired by, just moved).
   */
  subject: { name: string; url: string | null };
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
  rates: Record<string, number> | null = null,
): Verdict {
  const lead: Segment[] = [];
  const facts: Fact[] = [];
  const yours = { name: you.name, url: you.url };
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
        subject: yours,
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
        subject: yours,
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
        subject: yours,
        lead: "Mid-table on reviews",
        rest: `between ${worstOther(compAvgs)} and ${bestOther(compAvgs)}`,
        value: `${youAvg.toFixed(1)} vs ${(ratingMed ?? youAvg).toFixed(1)} med`,
        tone: "flat",
        lens: "rating",
      });
    }
  }

  // ── price standing
  // Read on the lens's own axis (one currency, monthly): comparing a captured €490/yr
  // against a captured $49/mo would name the wrong product cheapest.
  const currency = displayCurrency([you, ...comps], rates);
  const monthlyEntry = (c: CompareColumn): number | null => {
    const r = priceReading(c, rates, currency);
    return r.kind === "band" ? r.entry : null;
  };
  const youEntry = monthlyEntry(you);
  const compEntries = comps
    .map((c) => ({ name: c.name, entry: monthlyEntry(c) }))
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
        subject: yours,
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
        subject: yours,
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
        subject: yours,
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
  // The column is carried through, not just its name: the fact wears its favicon.
  const engLeader = comps
    .map((c) => ({ name: c.name, url: c.url, eng: engineeringRoles(c) }))
    .filter((x): x is { name: string; url: string | null; eng: number } => x.eng != null)
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
      subject: { name: engGap.name, url: engGap.url },
      lead: "Out-hired in engineering",
      rest: `by ${engGap.name}`,
      value: `${youEng} vs ${engGap.eng}`,
      tone: "bad",
      lens: "hiring",
    });
  } else if (youEng != null && engLeader) {
    facts.push({
      key: "hiring",
      subject: { name: engLeader.name, url: engLeader.url },
      lead: "Hiring in step",
      rest: `with ${engLeader.name}, the most active of them`,
      value: `${youEng} vs ${engLeader.eng} eng`,
      tone: "flat",
      lens: "hiring",
    });
  }

  const fresh = comps
    .map((c) => ({ col: c, move: c.latestSignal }))
    .filter((x): x is { col: CompareColumn; move: NonNullable<CompareColumn["latestSignal"]> } =>
      x.move != null,
    )
    .filter((x) => ["critical", "high"].includes(x.move.severity))
    .filter((x) => daysSince(x.move.createdAt, now) <= MOVE_FRESH_DAYS)
    .sort((a, b) => new Date(b.move.createdAt).getTime() - new Date(a.move.createdAt).getTime())[0];
  if (fresh) {
    facts.push({
      key: "moves",
      subject: { name: fresh.col.name, url: fresh.col.url },
      lead: `${fresh.col.name} just moved`,
      rest: firstClause(fresh.move.insight),
      value: shortAge(fresh.move.createdAt, now),
      tone: fresh.move.severity === "critical" ? "bad" : "warn",
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

// ── Cost curve (P5) ─────────────────────────────────────────────────────────

/** One competitor's cost-vs-volume line, plus the costs we READ rather than
 * derived. Built here rather than in the chart module so nothing importing it
 * pulls recharts into the route's first load. */
export interface CostCurveSeries {
  id: string;
  name: string;
  stroke: string;
  points: Array<{ qty: number; cost: number }>;
  marks: Array<{ qty: number; cost: number; measured: boolean }>;
}

/**
 * Series for every entity that prices `unit`, in the set's order so a line keeps
 * the hue its row wears.
 *
 * An entity with no curve for the meter is ABSENT. It is tempting to draw it flat
 * at its subscription price, but a flat line is a claim — "this is what they cost
 * at any volume" — and a competitor that does not sell this by the unit has not
 * made it.
 */
export function costCurveSeries(entities: CompareEntity[], unit: string): CostCurveSeries[] {
  const out: CostCurveSeries[] = [];
  for (const e of entities) {
    const curve = e.data?.pricing?.curves?.find((c) => c.unit === unit);
    if (!curve || curve.points.length === 0) continue;
    out.push({
      id: e.id,
      name: e.name,
      stroke: e.mine ? "var(--primary)" : (competitorStroke(e.color) ?? "var(--border-strong)"),
      points: curve.points,
      marks: (e.data?.pricing?.curveMarks ?? [])
        .filter((m) => m.unit === unit)
        .map((m) => ({ qty: m.qty, cost: m.cost, measured: m.method === "calculator_probe" })),
    });
  }
  return out;
}
