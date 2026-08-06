"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CatText } from "@/components/dashboard/cat-pill";
import { COMP_ACCENT, competitorColorVars } from "@/lib/competitor-color";
import { SeverityGauge } from "@/components/outrival/severity-scale";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type CompareColumn } from "@/lib/api";
import { formatMoney } from "@/lib/format-money";
import { fxDateLabel, useFx } from "@/lib/fx";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarShare,
  CardRow,
  type CompareEntity,
  Detail,
  DetailBar,
  DetailPair,
  Lens,
  LensFooter,
  LegendMedian,
  LegendSwatch,
  MeasureRow,
  MedianMark,
  NoReading,
  PendingRow,
  QuoteOnly,
  Track,
  WideRow,
} from "./lens";
import {
  avgReview,
  axisTicks,
  displayCurrency,
  engineeringMedianSalary,
  engineeringRoles,
  hiringScale,
  money,
  releasesPerMonth,
  releaseTrend,
  shippingScale,
  openRoles,
  priceReading,
  priceScale,
  ratingScale,
  agePhrase,
  shortAge,
  techDiff,
  availableMeters,
  costCurveSeries,
  type MeterSelection,
} from "./derive";
import { meterUnitLabel, PRICING_MODEL_LABELS } from "@outrival/shared";

// recharts is heavy and client-only; the compare page renders four lenses and only
// one of them ever draws a chart, so it stays off the route's first load.
const CostCurveChart = dynamic(() => import("./cost-curve"), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});

/**
 * The five lenses. Each one reads the same roster, in the same order, on one shared
 * scale, and each self-hides when nobody in the set has that data (so the page never
 * shows a lane of dashes). Every lens takes the same props, which is what lets the
 * view drop one in or out without special-casing.
 */
export interface LensProps {
  entities: CompareEntity[];
  /** Row ids expanded in this lens. */
  expanded: Set<string>;
  onToggle: (id: string) => void;
}

const loaded = (entities: CompareEntity[]): CompareColumn[] =>
  entities.map((e) => e.data).filter((d): d is CompareColumn => d != null);

const anyPending = (entities: CompareEntity[]): boolean => entities.some((e) => e.pending);

/** The measure lenses, in reading order. The prose lenses below run full width. */
export const MEASURE_LENSES = ["price", "rating", "hiring", "shipping", "stack"] as const;
export type MeasureLensId = (typeof MEASURE_LENSES)[number];

/**
 * Whether a lens has anything to draw for this roster. Each lens gates itself on its
 * own entry, and the view reads the same map to lay out ONLY the lenses that will
 * render: a self-hiding lens used to leave its column slot empty, so a set with no
 * reviews and no detected stack pushed the whole page into the left half.
 */
export const lensHasContent: Record<
  MeasureLensId,
  (entities: CompareEntity[]) => boolean
> = {
  price: (e) => loaded(e).some((c) => c.pricing != null) || anyPending(e),
  rating: (e) => ratingScale(loaded(e)).hasData || anyPending(e),
  hiring: (e) => loaded(e).some((c) => c.hiring != null) || anyPending(e),
  // Not `anyPending`: a competitor with no changelog never gains one by waiting, and
  // the whole lens is gated on holding two complete months, so a pending row would
  // hold open a lane that may never fill.
  shipping: (e) => loaded(e).some((c) => c.shipping != null),
  stack: (e) => {
    const cols = loaded(e);
    const diff = techDiff(cols);
    return (
      cols.some((c) => (diff.byId.get(c.id) ?? []).length > 0) ||
      diff.shared.length > 0 ||
      anyPending(e)
    );
  },
};

/**
 * Whether the positioning lens has anything to draw (P4).
 *
 * Not in `lensHasContent`: that map drives the MEASURE grid's column layout, and
 * positioning is a prose lens that runs full width. Exported on its own so the
 * per-metric rule can be tested — a roster where one competitor has only a
 * category and another only a pricing model must still render the lens, because
 * each of those is a reading the other column does not have.
 */
export function positioningLensHasContent(entities: CompareEntity[]): boolean {
  if (anyPending(entities)) return true;
  return loaded(entities).some(
    (c) =>
      c.positioning.category != null ||
      c.positioning.h1 != null ||
      c.positioning.personas.length > 0 ||
      c.pricing?.model != null,
  );
}

/** A number without its currency symbol, for the far end of a band ("$29–149"). */
function plain(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

const pct = (value: number, max: number): number =>
  max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

/**
 * The way back to the true spread, on any lane whose axis has been trimmed.
 *
 * Every lane here trims the outlier that would otherwise own its axis — one $2,400
 * tier, one competitor hiring 800 — so every lane owes the reader the same two
 * things: the trim stated on the axis, and one click that undoes it. Shared so the
 * three of them cannot drift into three different affordances.
 */
function ScaleToggle({
  full,
  onToggle,
  fullLabel,
}: {
  full: boolean;
  onToggle: () => void;
  /** What the full scale reaches, written in the lane's own unit. */
  fullLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-link rounded-sm underline-offset-2 hover:underline"
    >
      {full ? "Trim the outlier" : `Show full scale to ${fullLabel}`}
    </button>
  );
}

// ── Price ───────────────────────────────────────────────────────────────────

export function PriceLens({ entities, expanded, onToggle }: LensProps) {
  const cols = loaded(entities);
  // Every price is read on one axis — the display currency, per month — so the rows
  // rank against each other instead of against the unit each competitor happens to
  // publish in. Annual plans are read ÷12 and other currencies converted at ECB
  // rates; anything derived is marked "≈" and the captured numbers stay in the
  // row's plan breakdown.
  const fx = useFx();
  const rates = fx?.rates ?? null;
  // Outliers are trimmed off the axis by default; this is the way back to the true
  // spread, for when the gap IS the point.
  const [full, setFull] = useState(false);
  // A usage-based competitor publishes no price to put on this axis, only a rate.
  // Naming a volume turns that rate into a monthly number, which is the only form
  // in which it can be ranked against a subscription. Empty when nobody in the set
  // meters anything — the control then has nothing to offer and stays hidden.
  const meters = availableMeters(cols);
  const [meterKey, setMeterKey] = useState<string | null>(null);
  const meter =
    meters.find((m) => `${m.unit}|${m.qty}` === meterKey) ?? meters[0] ?? null;
  const to = displayCurrency(cols, rates);
  const scale = priceScale(cols, { rates, to, full, meter });
  // The cost curves for the selected meter, and the volumes this workspace reads
  // at — the guides that let the row above be located on the chart below.
  const curves = meter ? costCurveSeries(entities, meter.unit) : [];
  const meterVolumes = meter
    ? [...new Set(meters.filter((m) => m.unit === meter.unit).map((m) => m.qty))]
    : [];
  if (!lensHasContent.price(entities)) return null;

  const canExpandScale = scale.fullMax > scale.robustMax;
  const meterLabel = (m: MeterSelection) =>
    `${m.qty.toLocaleString("en-US")} ${meterUnitLabel(m.unit, m.qty)}/mo`;
  const derivation = [
    scale.annualised ? "annual plans read ÷ 12" : null,
    scale.converted.length
      ? `converted from ${scale.converted.join(", ")} at ECB rates${
          fx?.date ? ` (${fxDateLabel(fx.date)})` : ""
        }`
      : null,
  ].filter(Boolean);

  return (
    <Lens
      id="price"
      title="Price"
      sub="Entry to top published plan, one scale"
      meta={`${to} / mo`}
      footer={
        scale.hasData ? (
          <LensFooter
            ticks={axisTicks(scale.max).map((t, i, arr) =>
              // The last tick wears the "+" when bands run past it, so the axis never
              // claims to hold the whole set when it doesn't.
              i === arr.length - 1 && scale.clipped
                ? `${money(t, scale.currency)}+`
                : money(t, scale.currency),
            )}
            legend={
              <>
                {scale.medianEntry != null && (
                  <LegendMedian>
                    median entry{" "}
                    <span className="tabular-nums">{money(scale.medianEntry, scale.currency)}</span>
                  </LegendMedian>
                )}
                {canExpandScale && (
                  <ScaleToggle
                    full={full}
                    onToggle={() => setFull((f) => !f)}
                    fullLabel={money(scale.fullMax, scale.currency)}
                  />
                )}
                {/* The volume metered competitors are read at. Changing it re-reads
                    the captured ladder; nothing is re-scanned. */}
                {meters.length > 0 && meter && (
                  <label className="flex items-center gap-1.5">
                    <span>usage read at</span>
                    <select
                      value={`${meter.unit}|${meter.qty}`}
                      onChange={(ev) => setMeterKey(ev.target.value)}
                      className="border-border bg-background text-foreground rounded-sm border px-1.5 py-0.5 tabular-nums"
                      aria-label="Volume to read usage-based pricing at"
                    >
                      {meters.map((m) => (
                        <option key={`${m.unit}|${m.qty}`} value={`${m.unit}|${m.qty}`}>
                          {meterLabel(m)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {/* What the "≈" rows were derived from, so a converted number is never
                    passed off as one the competitor published. */}
                {derivation.length > 0 && <span>≈ {derivation.join(" · ")}</span>}
                {meter && (
                  <span>
                    * cost at {meterLabel(meter)}, not a published price — measured on the
                    competitor&rsquo;s own calculator where one exists, otherwise computed from
                    their published tiers
                  </span>
                )}
              </>
            }
          />
        ) : undefined
      }
    >
      {entities.map((e) => {
        if (!e.data) return <PendingRow key={e.id} entity={e} />;
        const reading = priceReading(e.data, rates, to, meter);
        const plans = e.data.pricing?.plans ?? [];
        const median = scale.medianEntry;
        const model = e.data.pricing?.model ?? null;

        // Five readings, no gaps: nothing captured, quote-only, a one-off price with
        // no monthly equivalent, a currency no rate could reach, or a band. None of
        // them is a blank cell.
        if (reading.kind !== "band") {
          return (
            <MeasureRow
              key={e.id}
              entity={e}
              value={
                reading.kind === "quote" ? (
                  <span className="text-muted-foreground">Custom</span>
                ) : reading.kind === "one_time" ? (
                  <>
                    {reading.approx && "≈"}
                    {money(reading.entry, to)}
                    {reading.entry !== reading.top && (
                      <span className="text-muted-foreground">–{plain(reading.top)}</span>
                    )}
                  </>
                ) : undefined
              }
            >
              {reading.kind === "none" ? (
                <NoReading>No pricing captured</NoReading>
              ) : reading.kind === "quote" ? (
                <QuoteOnly />
              ) : reading.kind === "one_time" ? (
                <NoReading>One-time price, no monthly equivalent</NoReading>
              ) : (
                <NoReading>Priced in {reading.currency}, no rate to convert</NoReading>
              )}
            </MeasureRow>
          );
        }

        const { entry, top } = reading;
        // Both ends are held inside the axis; the value column keeps the true numbers.
        const left = Math.min(pct(entry, scale.max), 97);
        const width = Math.max(0, Math.min(pct(top, scale.max), 100) - left);
        // A cost read at a volume, not a price the competitor published. The bar
        // is drawn lighter and the number wears an asterisk the legend explains,
        // so the two claims never read as the same one.
        const derived = reading.meter ?? null;
        // P4 — and among those, the ones we MEASURED on the competitor's own
        // calculator rather than computed from its published ladder. The distance
        // between "we did the arithmetic" and "their calculator said this" is the
        // whole value of the measurement, so the row says which it is.
        const probed = derived != null && reading.method === "calculator_probe";

        return (
          <MeasureRow
            key={e.id}
            entity={e}
            open={expanded.has(e.id)}
            onToggle={plans.length || probed ? () => onToggle(e.id) : undefined}
            value={
              derived ? (
                <>
                  {reading.approx && "≈"}
                  {money(entry, scale.currency)}
                  <span className="text-muted-foreground">*</span>
                </>
              ) : entry === top ? (
                <>
                  {reading.approx && "≈"}
                  {money(entry, scale.currency)} <span className="text-muted-foreground">flat</span>
                </>
              ) : (
                <>
                  {reading.approx && "≈"}
                  {money(entry, scale.currency)}
                  <span className="text-muted-foreground">–{plain(top)}</span>
                </>
              )
            }
            detail={
              plans.length || probed ? (
                <Detail
                  source={[
                    // How they charge leads: a per-seat $20 and a usage $20 are
                    // different products, and the plan list alone doesn't say which.
                    model ? PRICING_MODEL_LABELS[model] : null,
                    plans.length
                      ? `${plans.length} published plan${plans.length > 1 ? "s" : ""}`
                      : "no published plan",
                    derived ? `read at ${meterLabel(derived)}` : null,
                    probed
                      ? `measured on their calculator${
                          reading.measuredAt ? ` ${agePhrase(reading.measuredAt)}` : ""
                        }`
                      : derived
                        ? "computed from their published tiers"
                        : null,
                    e.data.pricing?.capturedAt
                      ? `captured ${agePhrase(e.data.pricing.capturedAt)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {/* The proof for a measured cost: the calculator showing that
                      volume and that total, or — for a volume asked of the page's
                      own pricing endpoint — the request and the answer it gave. */}
                  {probed && derived && reading.hasEvidence && (
                    <a
                      href={api.calculatorEvidenceUrl(e.id, derived.unit, derived.qty)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link text-dense underline-offset-2 hover:underline"
                    >
                      {reading.evidenceKind === "api_response"
                        ? "View their pricing response"
                        : "View the calculator screenshot"}
                    </a>
                  )}
                  {plans.map((p, i) => (
                    <DetailPair
                      key={`${p.name}-${i}`}
                      label={p.name || "Unnamed"}
                      value={
                        p.price == null ? (
                          "Custom"
                        ) : (
                          <>
                            {/* Captured, in the currency the competitor published it
                                in — the derived monthly number lives on the row above,
                                this is the evidence behind it. */}
                            {money(p.price, e.data?.pricing?.currency ?? scale.currency)}
                            {/* The period is called out only on the plans that are NOT
                                on the one the row's band was read off. */}
                            {p.billingPeriod && p.billingPeriod !== reading.period && (
                              <span className="text-muted-foreground">/{p.billingPeriod}</span>
                            )}
                          </>
                        )
                      }
                    />
                  ))}
                </Detail>
              ) : undefined
            }
          >
            <Track>
              {median != null && median <= scale.max && (
                <MedianMark left={pct(median, scale.max)} />
              )}
              <Bar
                entity={e}
                left={left}
                width={width}
                clipped={top > scale.max}
                className={derived ? "opacity-60" : undefined}
              />
            </Track>
          </MeasureRow>
        );
      })}
      {/* P5 — the rows above read every competitor at ONE volume. That ranks them
          at a point and hides where the ranking flips, which for metered pricing
          is the whole question. Shown only when at least two competitors can be
          priced across the range: one line is a fact about one product, not a
          comparison. */}
      {meter && curves.length > 1 && (
        <div className="border-border mt-3 border-t pt-4">
          <div className="text-muted-foreground mb-2 flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-foreground text-dense">
              Cost by volume · {meterUnitLabel(meter.unit, 2)}
            </span>
            <span>
              lines computed from published tiers · filled points measured on their
              calculator · hollow points printed by the page
            </span>
          </div>
          <CostCurveChart
            series={curves}
            unit={meter.unit}
            currency={scale.currency}
            markers={meterVolumes}
          />
        </div>
      )}
    </Lens>
  );
}

// ── Rating ──────────────────────────────────────────────────────────────────

const RATING_MAX = 5;

/** The 0-to-5 lane: a hairline with its five steps, so a score reads "out of what". */
function ScoreScale({
  children,
  median,
}: {
  children?: ReactNode;
  median: number | null;
}) {
  return (
    // The same 8px lane Track draws in, so a rating row and a price row put their
    // measure on the same line — the lane used to be 10px tall with the hairline
    // 4px down, which left every score sitting a couple of pixels off the bars.
    <div className="relative h-2">
      <span
        aria-hidden
        className="bg-border absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
      />
      {[0, 1, 2, 3, 4, 5].map((t) => (
        <span
          key={t}
          aria-hidden
          className={cn(
            "bg-border absolute inset-y-0 w-px",
            // The ends stay flush with the lane; the steps are centred on the score
            // they mark, which is where the axis label under them now sits too.
            t > 0 && t < RATING_MAX && "-translate-x-1/2",
          )}
          style={t === RATING_MAX ? { right: 0 } : { left: `${(t / RATING_MAX) * 100}%` }}
        />
      ))}
      {median != null && <MedianMark left={pct(median, RATING_MAX)} />}
      {children}
    </div>
  );
}

/** The score itself, placed on the lane. Same identity colour as the bars. */
function ScoreDot({ entity, score }: { entity: CompareEntity; score: number }) {
  const vars = competitorColorVars(entity.color);
  return (
    <span
      aria-hidden
      className={cn(
        "ring-background absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 motion-safe:transition-[left] motion-safe:duration-300",
        entity.mine ? "bg-primary" : !vars && "bg-border-strong",
      )}
      style={{
        left: `${pct(score, RATING_MAX)}%`,
        ...(entity.mine || !vars ? {} : { ...vars, background: COMP_ACCENT }),
      }}
    />
  );
}

export function RatingLens({ entities, expanded, onToggle }: LensProps) {
  const cols = loaded(entities);
  const scale = ratingScale(cols);
  if (!lensHasContent.rating(entities)) return null;

  return (
    <Lens
      id="rating"
      title="Rating"
      sub="Latest captured score per review source"
      meta="out of 5"
      footer={
        <LensFooter
          ticks={[0, 1, 2, 3, 4, 5].map((t) => String(t))}
          legend={
            scale.median != null ? (
              <LegendMedian>
                median <span className="tabular-nums">{scale.median.toFixed(1)}</span>
              </LegendMedian>
            ) : undefined
          }
        />
      }
    >
      {entities.map((e) => {
        if (!e.data) return <PendingRow key={e.id} entity={e} />;
        const avg = avgReview(e.data);
        const reviews = e.data.reviews;
        const count = reviews.reduce((s, r) => s + r.reviewCount, 0);
        const best = scale.best.has(e.id);
        if (avg == null) {
          return (
            <MeasureRow
              key={e.id}
              entity={e}
              value={<span className="text-muted-foreground">not reviewed</span>}
            >
              <ScoreScale median={scale.median} />
            </MeasureRow>
          );
        }
        return (
          <MeasureRow
            key={e.id}
            entity={e}
            open={expanded.has(e.id)}
            onToggle={() => onToggle(e.id)}
            value={
              <>
                <span className={cn(best && "text-positive font-medium")}>{avg.toFixed(1)}</span>
                <span className="text-muted-foreground"> · {count}</span>
              </>
            }
            detail={
              <Detail
                wide
                source={reviews.map((r) => `${r.source} · ${r.reviewCount} reviews`).join("   ")}
              >
                {/* Flattened rather than nested per source: the sub-scores of two
                    sources read as one set of criteria, not two tables. */}
                {reviews.flatMap((r) =>
                  r.sub
                    ? (
                        [
                          ["ease", r.sub.ease],
                          ["support", r.sub.support],
                          ["features", r.sub.features],
                          ["value", r.sub.value],
                        ] as const
                      ).map(([label, v]) => (
                        <DetailBar
                          key={`${r.source}-${label}`}
                          entity={e}
                          label={reviews.length > 1 ? `${r.source} ${label}` : label}
                          value={v.toFixed(1)}
                          ratio={v / RATING_MAX}
                        />
                      ))
                    : [
                        <DetailPair
                          key={r.source}
                          label={r.source}
                          value={`${r.score.toFixed(1)}/5`}
                        />,
                      ],
                )}
              </Detail>
            }
          >
            <ScoreScale median={scale.median}>
              <ScoreDot entity={e} score={avg} />
            </ScoreScale>
          </MeasureRow>
        );
      })}
    </Lens>
  );
}

// ── Hiring ──────────────────────────────────────────────────────────────────

export function HiringLens({ entities, expanded, onToggle }: LensProps) {
  const cols = loaded(entities);
  // One competitor hiring 800 against five hiring a dozen leaves those five as
  // slivers, so the lane trims it the way the price lane does.
  const [full, setFull] = useState(false);
  const scale = hiringScale(cols, { full });
  if (!lensHasContent.hiring(entities)) return null;

  return (
    <Lens
      id="hiring"
      title="Hiring"
      sub={
        scale.hasEngineering
          ? "Open roles, engineering share picked out"
          : "Open roles across every department"
      }
      meta="open now"
      footer={
        <LensFooter
          ticks={
            scale.hasData
              ? [0, Math.round(scale.max / 2), scale.max].map((t, i) =>
                  // The last tick wears the "+" when a board runs past it, so the
                  // axis never claims to hold the whole set when it doesn't.
                  i === 2 ? `${t}${scale.clipped ? "+" : ""} roles` : String(t),
                )
              : undefined
          }
          legend={
            scale.hasEngineering || scale.fullMax > scale.robustMax ? (
              <>
                {scale.hasEngineering && (
                  <>
                    <LegendSwatch className="bg-muted-foreground/45">all open roles</LegendSwatch>
                    <LegendSwatch className="bg-muted-foreground">engineering</LegendSwatch>
                  </>
                )}
                {scale.fullMax > scale.robustMax && (
                  <ScaleToggle
                    full={full}
                    onToggle={() => setFull((f) => !f)}
                    fullLabel={`${scale.fullMax} roles`}
                  />
                )}
              </>
            ) : undefined
          }
        />
      }
    >
      {entities.map((e) => {
        if (!e.data) return <PendingRow key={e.id} entity={e} />;
        const total = openRoles(e.data);
        const eng = engineeringRoles(e.data);
        const engPay = engineeringMedianSalary(e.data);
        const depts = e.data.hiring?.departments ?? [];
        if (total == null) {
          return (
            <MeasureRow key={e.id} entity={e}>
              <NoReading>No jobs source yet</NoReading>
            </MeasureRow>
          );
        }
        const deptMax = Math.max(1, ...depts.map((d) => d.count));
        return (
          <MeasureRow
            key={e.id}
            entity={e}
            open={expanded.has(e.id)}
            onToggle={depts.length ? () => onToggle(e.id) : undefined}
            value={
              <>
                {total}
                {eng != null && <span className="text-muted-foreground"> · eng {eng}</span>}
                {/* Shown, not positioned: the figure is in ITS currency, so there
                    is no shared scale to place it on and no conversion applied. */}
                {engPay && (
                  <span
                    className="ml-2 rounded-sm bg-surface-2 px-1.5 py-0.5 text-meta font-medium"
                    title={`Median engineering pay, ${engPay.currency}, over ${engPay.n} open roles`}
                  >
                    {formatMoney(engPay.p50, engPay.currency)}
                  </span>
                )}
              </>
            }
            detail={
              depts.length ? (
                <Detail
                  wide
                  source={[
                    e.data.platform?.ats,
                    `${total} open role${total > 1 ? "s" : ""}`,
                    e.data.hiring?.capturedAt
                      ? `seen ${agePhrase(e.data.hiring.capturedAt)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {depts.map((d, i) => (
                    <DetailBar
                      key={`${d.department}-${i}`}
                      entity={e}
                      label={d.department || "Other"}
                      value={d.count}
                      ratio={d.count / deptMax}
                    />
                  ))}
                  {engPay && (
                    <DetailPair
                      label={`Median engineering pay (${engPay.currency}, n=${engPay.n})`}
                      value={formatMoney(engPay.p50, engPay.currency)}
                    />
                  )}
                </Detail>
              ) : undefined
            }
          >
            <Track>
              {/* Held inside the axis and marked as held; the row's own value column
                  keeps the true count. */}
              <Bar entity={e} left={0} width={pct(total, scale.max)} clipped={total > scale.max} />
              {eng != null && eng > 0 && <BarShare entity={e} width={pct(eng, scale.max)} />}
            </Track>
          </MeasureRow>
        );
      })}
    </Lens>
  );
}

// ── Shipping velocity ───────────────────────────────────────────────────────

/**
 * How fast each of them ships (Content Intelligence v2 P5).
 *
 * Counted off the entries their own release feeds published, over months that have
 * ENDED — the running month is never averaged in, or every competitor would look
 * frozen on the 3rd. A competitor with fewer than two complete months of history is
 * ABSENT from the lens rather than shown a rate extrapolated from a week: the API
 * decides that, so a row here always means a real reading.
 *
 * The self product is included, like everywhere else on this page, and that is
 * mostly the point — "they ship 14 a month, you ship 6" is the comparison this lens
 * exists to make.
 */
export function ShippingLens({ entities, expanded, onToggle }: LensProps) {
  const cols = loaded(entities);
  // One competitor publishing 40 releases a month flattens a field shipping 3 to 6
  // into a row of stubs — same trim as the other lanes.
  const [full, setFull] = useState(false);
  const scale = shippingScale(cols, { full });
  if (!lensHasContent.shipping(entities)) return null;

  return (
    <Lens
      id="shipping"
      title="Shipping"
      sub="Published releases per month, over months that have ended"
      meta="per month"
      footer={
        <LensFooter
          ticks={
            scale.hasData
              ? [0, scale.max / 2, scale.max].map((t, i) =>
                  i === 2 ? `${round1(t)}${scale.clipped ? "+" : ""} / mo` : round1(t),
                )
              : undefined
          }
          legend={
            scale.fullMax > scale.robustMax ? (
              <ScaleToggle
                full={full}
                onToggle={() => setFull((f) => !f)}
                fullLabel={`${round1(scale.fullMax)} / mo`}
              />
            ) : undefined
          }
        />
      }
    >
      {entities.map((e) => {
        if (!e.data) return <PendingRow key={e.id} entity={e} />;
        const rate = releasesPerMonth(e.data);
        const months = e.data.shipping?.months ?? [];
        if (rate == null) {
          return (
            <MeasureRow key={e.id} entity={e}>
              {/* Two different absences, said plainly: nothing to read yet, rather
                  than a zero that would claim they stopped shipping. */}
              <NoReading>Not enough release history yet</NoReading>
            </MeasureRow>
          );
        }
        const trend = releaseTrend(e.data);
        const previous = e.data.shipping?.previousPerMonth ?? null;
        return (
          <MeasureRow
            key={e.id}
            entity={e}
            open={expanded.has(e.id)}
            onToggle={months.length ? () => onToggle(e.id) : undefined}
            value={
              <>
                {round1(rate)}
                {trend && (
                  <span
                    className="text-muted-foreground ml-1.5"
                    title={
                      previous != null
                        ? `Against ${round1(previous)} / month over the three months before`
                        : undefined
                    }
                    aria-label={trend === "up" ? "up on the previous window" : "down on the previous window"}
                  >
                    {trend === "up" ? "↑" : "↓"}
                  </span>
                )}
              </>
            }
            detail={
              months.length ? (
                <Detail
                  wide
                  source={`${months.length} complete month${months.length > 1 ? "s" : ""} · from their own release feed`}
                >
                  {months.map((m) => (
                    <DetailBar
                      key={m.month}
                      entity={e}
                      label={m.month}
                      value={m.count}
                      ratio={m.count / scale.monthMax}
                    />
                  ))}
                  {previous != null && (
                    <DetailPair
                      label="Previous three months"
                      value={`${round1(previous)} / mo`}
                    />
                  )}
                </Detail>
              ) : undefined
            }
          >
            <Track>
              <Bar entity={e} left={0} width={pct(rate, scale.max)} clipped={rate > scale.max} />
            </Track>
          </MeasureRow>
        );
      })}
    </Lens>
  );
}

/** One decimal, and no trailing ".0" — "6 a month" reads better than "6.0". */
function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

// ── Stack ───────────────────────────────────────────────────────────────────

export function StackLens({ entities }: Omit<LensProps, "expanded" | "onToggle">) {
  const cols = loaded(entities);
  const diff = techDiff(cols);
  if (!lensHasContent.stack(entities)) return null;

  return (
    <Lens
      id="stack"
      title="Stack"
      sub="What only one of them runs"
      meta="detected"
      intro={
        diff.shared.length > 0 ? (
          <p className="border-border text-muted-foreground m-0 -mx-1.5 border-b px-1.5 py-2.5 text-dense">
            {/* cols, not entities: a row still loading has not agreed to anything yet. */}
            All {cols.length} run{" "}
            {diff.shared.map((name, i) => (
              <span key={name}>
                {i > 0 && (i === diff.shared.length - 1 ? " and " : ", ")}
                <span className="text-foreground font-medium">{name}</span>
              </span>
            ))}
            , so those are left out below.
          </p>
        ) : undefined
      }
    >
      {entities.map((e) => {
        if (!e.data) return <PendingRow key={e.id} entity={e} />;
        const tags = diff.byId.get(e.id) ?? [];
        return (
          <MeasureRow key={e.id} entity={e}>
            {tags.length === 0 ? (
              <NoReading>
                {diff.shared.length > 0 ? "Nothing beyond the shared set" : "Nothing detected yet"}
              </NoReading>
            ) : (
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <Badge
                    key={t.name}
                    variant={t.only ? "outline" : "secondary"}
                    className={cn("text-meta", t.only && "border-border-strong font-medium")}
                  >
                    {t.only && <span className="text-muted-foreground font-normal">only ·&nbsp;</span>}
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
          </MeasureRow>
        );
      })}
    </Lens>
  );
}

// ── Positioning ─────────────────────────────────────────────────────────────

/**
 * How each competitor positions itself — v2 (Positioning Intelligence v2 P4).
 *
 * The lens used to render two strings, one of which was AI prose: a category and
 * the profile summary. Set side by side, four generated paragraphs compare badly
 * — they are written in the same voice, at the same length, about four different
 * companies, and none of them can be checked against anything.
 *
 * It now reads four CAPTURED facts, all of them checkable on the competitor's own
 * site: the market they are filed under, the words on their homepage today, how
 * they charge, and the two buyers their sitemap says they sell to.
 *
 * Self-hiding is PER METRIC, not per lens. A competitor with no persona pages
 * keeps its category and headline; one whose homepage has never been captured
 * keeps its pricing model. The lens itself disappears only when no column holds
 * any of the four — the one case where all it would draw is a row of dashes.
 */
export function PositioningLens({ entities }: Omit<LensProps, "expanded" | "onToggle">) {
  if (!positioningLensHasContent(entities)) return null;

  return (
    // A grid, not a list: each reading is a headline plus two badges, and six
    // full-width rows stacked is a page of scrolling to compare two sentences.
    <Lens
      id="positioning"
      title="Positioning"
      sub="What each one says on its homepage today"
      layout="grid"
    >
      {entities.map((e) => {
        if (!e.data) {
          return (
            <CardRow key={e.id} entity={e}>
              <Skeleton className="h-3 w-4/5" />
            </CardRow>
          );
        }
        const { category, h1, personas } = e.data.positioning;
        const model = e.data.pricing?.model ?? null;
        return (
          <CardRow key={e.id} entity={e}>
            {(category || model) && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {category && (
                  <Badge variant="outline" className="max-w-full text-meta font-normal">
                    <span className="line-clamp-1">{category}</span>
                  </Badge>
                )}
                {model && (
                  <Badge variant="outline" className="text-meta font-normal">
                    {PRICING_MODEL_LABELS[model]}
                  </Badge>
                )}
              </div>
            )}
            {h1 ? (
              <p className="m-0 text-sm leading-snug">{h1}</p>
            ) : (
              <NoReading>Homepage not captured yet</NoReading>
            )}
            {personas.length > 0 ? (
              <p className="text-muted-foreground m-0 mt-1 text-meta">
                {personas.join(" · ")}
              </p>
            ) : (
              // Stated rather than left blank: "we found none" and "we have not
              // looked" are different answers, and only the row knows which.
              h1 != null && (
                <p className="text-muted-foreground m-0 mt-1 text-meta">
                  No persona pages found
                </p>
              )
            )}
          </CardRow>
        );
      })}
    </Lens>
  );
}

// ── Latest move ─────────────────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "low";
const isSeverity = (v: string): v is Severity =>
  v === "critical" || v === "high" || v === "medium" || v === "low";

// Past this a move stops being news and the row drops to muted, matching the roster.
const QUIET_AFTER_DAYS = 7;

export function MovesLens({ entities }: Omit<LensProps, "expanded" | "onToggle">) {
  const cols = loaded(entities);
  const hasAny = cols.some((c) => c.latestSignal != null);
  if (!hasAny && !anyPending(entities)) return null;

  return (
    <Lens id="moves" title="Latest move" sub="The last thing each one did, in its own words">
      {entities.map((e) => {
        if (!e.data) return <PendingRow key={e.id} entity={e} />;
        const move = e.data.latestSignal;
        const stale =
          move != null &&
          Date.now() - new Date(move.createdAt).getTime() > QUIET_AFTER_DAYS * 86_400_000;
        return (
          <WideRow
            key={e.id}
            entity={e}
            gutter={
              <span className="pt-1">
                <SeverityGauge
                  severity={move && !stale && isSeverity(move.severity) ? move.severity : null}
                />
              </span>
            }
            right={
              <span className="text-muted-foreground pt-px text-right text-meta whitespace-nowrap tabular-nums">
                {move ? shortAge(move.createdAt) : "—"}
              </span>
            }
          >
            {move ? (
              <>
                <Link
                  href={`/dashboard/signals?focus=${move.id}`}
                  className={cn(
                    "focus-visible:ring-ring/50 block rounded-sm text-dense leading-snug hover:underline focus-visible:ring-2",
                    stale ? "text-muted-foreground" : "font-medium",
                  )}
                >
                  {move.insight}
                </Link>
                <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-meta">
                  <CatText category={move.category} />
                  {stale && (
                    <>
                      <span aria-hidden className="text-border-strong">
                        ·
                      </span>
                      <span>quiet since</span>
                    </>
                  )}
                </span>
              </>
            ) : (
              <NoReading>Nothing detected yet</NoReading>
            )}
          </WideRow>
        );
      })}
    </Lens>
  );
}
