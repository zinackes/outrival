"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CatText } from "@/components/dashboard/cat-pill";
import { COMP_ACCENT, competitorColorVars } from "@/lib/competitor-color";
import { SeverityGauge } from "@/components/outrival/severity-scale";
import type { CompareColumn } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarShare,
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
  engineeringRoles,
  entryOf,
  hiringScale,
  money,
  openRoles,
  priceScale,
  ratingScale,
  agePhrase,
  shortAge,
  techDiff,
  topOf,
} from "./derive";

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

/** A number without its currency symbol, for the far end of a band ("$29–149"). */
function plain(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

const pct = (value: number, max: number): number =>
  max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

// ── Price ───────────────────────────────────────────────────────────────────

export function PriceLens({ entities, expanded, onToggle }: LensProps) {
  const cols = loaded(entities);
  const scale = priceScale(cols);
  const hasAny = cols.some((c) => c.pricing != null);
  if (!hasAny && !anyPending(entities)) return null;

  return (
    <Lens
      id="price"
      title="Price"
      sub="Entry to top published plan, one scale"
      meta={[scale.currency, scale.period].filter(Boolean).join(" / ") || undefined}
      footer={
        scale.hasData ? (
          <LensFooter
            ticks={axisTicks(scale.max).map((t) => money(t, scale.currency))}
            legend={
              scale.medianEntry != null ? (
                <LegendMedian>
                  median entry <span className="font-mono">{money(scale.medianEntry, scale.currency)}</span>
                </LegendMedian>
              ) : undefined
            }
          />
        ) : undefined
      }
    >
      {entities.map((e) => {
        if (!e.data) return <PendingRow key={e.id} entity={e} />;
        const entry = entryOf(e.data);
        const top = topOf(e.data);
        const plans = e.data.pricing?.plans ?? [];
        const median = scale.medianEntry;

        // Quote-only, or no pricing captured at all: both are readings, not gaps.
        if (entry == null || top == null) {
          return (
            <MeasureRow
              key={e.id}
              entity={e}
              value={
                e.data.pricing ? <span className="text-muted-foreground">Custom</span> : undefined
              }
            >
              {e.data.pricing ? <QuoteOnly /> : <NoReading>No pricing captured</NoReading>}
            </MeasureRow>
          );
        }

        return (
          <MeasureRow
            key={e.id}
            entity={e}
            open={expanded.has(e.id)}
            onToggle={plans.length ? () => onToggle(e.id) : undefined}
            value={
              entry === top ? (
                <>
                  {money(entry, scale.currency)} <span className="text-muted-foreground">flat</span>
                </>
              ) : (
                <>
                  {money(entry, scale.currency)}
                  <span className="text-muted-foreground">–{plain(top)}</span>
                </>
              )
            }
            detail={
              plans.length ? (
                <Detail
                  source={`${plans.length} published plan${plans.length > 1 ? "s" : ""}${
                    e.data.pricing?.capturedAt
                      ? `, captured ${agePhrase(e.data.pricing.capturedAt)}`
                      : ""
                  }`}
                >
                  {plans.map((p, i) => (
                    <DetailPair
                      key={`${p.name}-${i}`}
                      label={p.name || "Unnamed"}
                      value={
                        p.price == null ? (
                          "Custom"
                        ) : (
                          <>
                            {money(p.price, e.data?.pricing?.currency ?? scale.currency)}
                            {p.billingPeriod && p.billingPeriod !== e.data?.pricing?.billingPeriod && (
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
              {median != null && <MedianMark left={pct(median, scale.max)} />}
              <Bar
                entity={e}
                left={pct(entry, scale.max)}
                width={pct(top - entry, scale.max)}
              />
            </Track>
          </MeasureRow>
        );
      })}
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
    <div className="relative h-2.5">
      <span aria-hidden className="bg-border absolute inset-x-0 top-1 h-px" />
      {[0, 1, 2, 3, 4, 5].map((t) => (
        <span
          key={t}
          aria-hidden
          className="bg-border absolute top-0 h-2 w-px"
          style={t === RATING_MAX ? { right: 0 } : { left: `${(t / RATING_MAX) * 100}%` }}
        />
      ))}
      {median != null && (
        <span
          aria-hidden
          className="border-border-strong absolute -inset-y-1 border-l border-dashed"
          style={{ left: `${pct(median, RATING_MAX)}%` }}
        />
      )}
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
        "ring-background absolute top-[-2px] -ml-[5.5px] size-[11px] rounded-full ring-2 motion-safe:transition-[left] motion-safe:duration-300",
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
  if (!scale.hasData && !anyPending(entities)) return null;

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
            <>
              {scale.median != null && (
                <LegendMedian>
                  median <span className="font-mono">{scale.median.toFixed(1)}</span>
                </LegendMedian>
              )}
              <span>expand a row for ease, support, features and value</span>
            </>
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
  const scale = hiringScale(cols);
  const hasAny = cols.some((c) => c.hiring != null);
  if (!hasAny && !anyPending(entities)) return null;

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
                  i === 2 ? `${t} roles` : String(t),
                )
              : undefined
          }
          legend={
            scale.hasEngineering ? (
              <>
                <LegendSwatch className="bg-muted-foreground/45">all open roles</LegendSwatch>
                <LegendSwatch className="bg-muted-foreground">engineering</LegendSwatch>
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
                </Detail>
              ) : undefined
            }
          >
            <Track>
              <Bar entity={e} left={0} width={pct(total, scale.max)} />
              {eng != null && eng > 0 && <BarShare entity={e} width={pct(eng, scale.max)} />}
            </Track>
          </MeasureRow>
        );
      })}
    </Lens>
  );
}

// ── Stack ───────────────────────────────────────────────────────────────────

export function StackLens({ entities }: Omit<LensProps, "expanded" | "onToggle">) {
  const cols = loaded(entities);
  const diff = techDiff(cols);
  const hasAny = cols.some((c) => (diff.byId.get(c.id) ?? []).length > 0) || diff.shared.length > 0;
  if (!hasAny && !anyPending(entities)) return null;

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

export function PositioningLens({ entities }: Omit<LensProps, "expanded" | "onToggle">) {
  const cols = loaded(entities);
  const hasAny = cols.some((c) => c.positioning.category || c.positioning.summary);
  if (!hasAny && !anyPending(entities)) return null;

  return (
    <Lens id="positioning" title="Positioning" sub="How each one describes itself, in its own words">
      {entities.map((e) => {
        if (!e.data) return <PendingRow key={e.id} entity={e} />;
        const { category, summary } = e.data.positioning;
        return (
          <WideRow key={e.id} entity={e}>
            {category && (
              <Badge variant="outline" className="mb-1 max-w-full text-meta font-normal">
                <span className="line-clamp-1">{category}</span>
              </Badge>
            )}
            {summary ? (
              <p className="m-0 max-w-[70ch] text-sm leading-normal">{summary}</p>
            ) : (
              !category && <NoReading>Nothing captured yet</NoReading>
            )}
          </WideRow>
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
              <span className="text-muted-foreground pt-px text-right font-mono text-meta whitespace-nowrap tabular-nums">
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
