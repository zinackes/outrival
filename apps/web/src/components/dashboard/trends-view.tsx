"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { DollarSign, TrendingUp, Star, Boxes, LineChart as LineChartIcon } from "lucide-react";
import {
  api,
  type TrendsSummary,
  type TrendMetric,
  type TrendSeriesPoint,
  type PricingMove,
  type HiringMove,
  type ReviewMove,
  type TechMove,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHead } from "./section-head";
import { PageHead } from "./page-head";
import {
  DateRangePicker,
  lastNDays,
  type DateRange,
} from "@/components/ui/date-range-picker";
const METRICS: { value: TrendMetric; label: string }[] = [
  { value: "pricing", label: "Pricing" },
  { value: "hiring", label: "Hiring" },
  { value: "reviews", label: "Reviews" },
];
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function money(value: number, currency: string): string {
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

function pct(price: number, prev: number | null): string | null {
  if (!prev || prev === 0) return null;
  const d = Math.round(((price - prev) / prev) * 100);
  return `${d > 0 ? "+" : ""}${d}%`;
}

function Row({ left, sub, right }: { left: string; sub?: string; right: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <span className="text-dense font-medium">{left}</span>
        {sub && <span className="text-muted-foreground ml-1.5 text-xs">{sub}</span>}
      </div>
      <div className="shrink-0 text-right">{right}</div>
    </div>
  );
}

function Card({
  title,
  icon,
  sub,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  sub: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <SectionHead title={title} icon={icon} sub={sub} />
      {empty ? (
        <p className="text-muted-foreground py-2 text-sm">No data in this window yet.</p>
      ) : (
        <div className="mt-1">{children}</div>
      )}
    </section>
  );
}

function pivot(points: TrendSeriesPoint[]): {
  keys: string[];
  data: Record<string, string | number>[];
} {
  const keys = Array.from(new Set(points.map((p) => p.key)));
  const rows = new Map<string, Record<string, string | number>>();
  for (const p of points) {
    let row = rows.get(p.t);
    if (!row) {
      row = { t: shortDate(p.t) };
      rows.set(p.t, row);
    }
    row[p.key] = p.value;
  }
  return { keys, data: [...rows.values()] };
}

function DrillChart({
  competitorId,
  metric,
  range,
}: {
  competitorId: string;
  metric: TrendMetric;
  range: DateRange;
}) {
  const [points, setPoints] = useState<TrendSeriesPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    api
      .getTrendsSeries(competitorId, metric, range)
      .then((r) => !cancelled && setPoints(r.points))
      .catch(() => !cancelled && setPoints([]));
    return () => {
      cancelled = true;
    };
  }, [competitorId, metric, range]);

  if (points === null) return <Skeleton className="h-64 w-full" />;
  if (points.length === 0) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
        No {metric} history for this competitor in this window.
      </div>
    );
  }

  const { keys, data } = pivot(points);
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" stroke="var(--muted)" fontSize={10} tickLine={false} />
          <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} width={44} />
          <Tooltip
            contentStyle={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {keys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendsView() {
  const [range, setRange] = useState<DateRange>(() => lastNDays(90));
  const [summary, setSummary] = useState<TrendsSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [metric, setMetric] = useState<TrendMetric>("pricing");
  const [competitorId, setCompetitorId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    api
      .getTrendsSummary(range)
      .then((r) => !cancelled && setSummary(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Drill competitor options = the competitors that have series-eligible data.
  const competitorOptions = useMemo(() => {
    if (!summary) return [];
    const map = new Map<string, string>();
    for (const m of [...summary.pricing, ...summary.hiring, ...summary.reviews]) {
      map.set(m.competitorId, m.competitorName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [summary]);

  // Keep the selected competitor valid as options load/change.
  useEffect(() => {
    if (competitorOptions.length === 0) {
      if (competitorId) setCompetitorId("");
      return;
    }
    if (!competitorOptions.some((o) => o.id === competitorId)) {
      setCompetitorId(competitorOptions[0]!.id);
    }
  }, [competitorOptions, competitorId]);

  if (failed) {
    return <p className="text-muted-foreground text-sm">Couldn&apos;t load trends right now.</p>;
  }

  const allEmpty =
    summary !== null &&
    summary.pricing.length === 0 &&
    summary.hiring.length === 0 &&
    summary.reviews.length === 0 &&
    summary.tech.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        flush
        icon={<LineChartIcon size={18} className="text-muted-foreground" aria-hidden />}
        title="Trends"
        sub="How your competitors moved on pricing, hiring, reviews and tech."
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      {summary === null ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : summary.degraded && allEmpty ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center text-muted-foreground">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
            <LineChartIcon size={16} className="text-muted-foreground" aria-hidden />
          </div>
          <div className="mb-1.5 text-base font-semibold tracking-tight text-foreground">
            Trends temporarily unavailable
          </div>
          <div className="mx-auto max-w-[400px] text-sm">
            We couldn&apos;t read the trend data just now — this is usually brief. Refresh in a
            moment.
          </div>
        </div>
      ) : allEmpty ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center text-muted-foreground">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
            <LineChartIcon size={16} className="text-muted-foreground" aria-hidden />
          </div>
          <div className="mb-1.5 text-base font-semibold tracking-tight text-foreground">
            No trends yet
          </div>
          <div className="mx-auto max-w-[400px] text-sm">
            Pricing, hiring, review and tech history build up over the next few scrapes — check back
            once your competitors have been monitored for a while.
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card
              title="Pricing moves"
              icon={<DollarSign size={14} />}
              sub="recent price changes across competitors"
              empty={summary.pricing.length === 0}
            >
              {summary.pricing.map((m: PricingMove, i) => (
                <Row
                  key={`${m.competitorId}-${m.planName}-${i}`}
                  left={m.competitorName}
                  sub={m.planName}
                  right={
                    <span className="font-mono text-xs tabular-nums">
                      {m.prevPrice !== null && (
                        <span className="text-muted-foreground">
                          {money(m.prevPrice, m.currency)} →{" "}
                        </span>
                      )}
                      {money(m.price, m.currency)}
                      {pct(m.price, m.prevPrice) && (
                        <span className="text-muted-foreground ml-1.5">
                          {pct(m.price, m.prevPrice)}
                        </span>
                      )}
                    </span>
                  }
                />
              ))}
            </Card>

            <Card
              title="Hiring velocity"
              icon={<TrendingUp size={14} />}
              sub="net open roles added in the window"
              empty={summary.hiring.length === 0}
            >
              {summary.hiring.map((m: HiringMove) => (
                <Row
                  key={m.competitorId}
                  left={m.competitorName}
                  right={
                    <span className="font-mono text-xs tabular-nums">
                      <span className={m.net > 0 ? "text-foreground" : "text-muted-foreground"}>
                        {m.net > 0 ? "+" : ""}
                        {m.net}
                      </span>
                      <span className="text-muted-foreground"> · {m.latest} open</span>
                    </span>
                  }
                />
              ))}
            </Card>

            <Card
              title="Review trajectory"
              icon={<Star size={14} />}
              sub="latest score per source"
              empty={summary.reviews.length === 0}
            >
              {summary.reviews.map((m: ReviewMove, i) => (
                <Row
                  key={`${m.competitorId}-${m.source}-${i}`}
                  left={m.competitorName}
                  sub={m.source}
                  right={
                    <span className="font-mono text-xs tabular-nums">
                      {m.score.toFixed(1)}
                      <span className="text-muted-foreground">/5 · {m.reviewCount}</span>
                    </span>
                  }
                />
              ))}
            </Card>

            <Card
              title="Tech changes"
              icon={<Boxes size={14} />}
              sub="recently added or dropped tech"
              empty={summary.tech.length === 0}
            >
              {summary.tech.map((m: TechMove, i) => (
                <Row
                  key={`${m.competitorId}-${m.techId}-${i}`}
                  left={m.competitorName}
                  sub={m.techId}
                  right={
                    <span className="flex items-center justify-end gap-2">
                      <Badge variant={m.event === "appeared" ? "secondary" : "outline"}>
                        {m.event}
                      </Badge>
                      <span className="text-muted-foreground font-mono text-meta">
                        {shortDate(m.recordedAt)}
                      </span>
                    </span>
                  }
                />
              ))}
            </Card>
          </div>

          <section className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionHead
                title="Drill-down"
                icon={<LineChartIcon size={14} />}
                sub="one competitor over time"
              />
              <div className="flex items-center gap-2">
                <Select value={competitorId} onValueChange={setCompetitorId}>
                  <SelectTrigger size="sm" aria-label="Competitor">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {competitorOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={metric}
                  onValueChange={(v) => v && setMetric(v as TrendMetric)}
                >
                  {METRICS.map((m) => (
                    <ToggleGroupItem key={m.value} value={m.value}>
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
            <div className="mt-3">
              {competitorId ? (
                <DrillChart competitorId={competitorId} metric={metric} range={range} />
              ) : (
                <p className="text-muted-foreground py-2 text-sm">
                  No competitor with trend data to drill into yet.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
