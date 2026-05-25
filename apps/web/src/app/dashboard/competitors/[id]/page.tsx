"use client";

import { useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  ArrowLeft,
  Play,
  ExternalLink,
  Activity,
  DollarSign,
  Briefcase,
  Star,
  FileText,
  Sparkles,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  api,
  type Competitor,
  type Monitor,
  type ChangeRow,
  type CompetitorSignal,
  type JobsByDepartment,
  type JobTrendPoint,
  type PricingHistoryPoint,
  type ReviewScorePoint,
  type ReviewsData,
} from "@/lib/api";

type TabKey = "activity" | "pricing" | "hiring" | "reviews" | "content";

const TABS: Array<{ key: TabKey; label: string; icon: typeof Activity }> = [
  { key: "activity", label: "Activité récente", icon: Activity },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "hiring", label: "Recrutement", icon: Briefcase },
  { key: "reviews", label: "Reviews", icon: Star },
  { key: "content", label: "Contenu", icon: FileText },
];

const SEVERITY_COLOR: Record<string, string> = {
  low: "#6b7280",
  medium: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default function CompetitorDetailPage({ params }: Props) {
  const { id } = use(params);
  const [data, setData] = useState<{
    competitor: Competitor;
    monitors: Monitor[];
    recentChanges: ChangeRow[];
    recentSignals: CompetitorSignal[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("activity");

  async function refresh() {
    try {
      setData(await api.getCompetitor(id));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, [id]);

  async function runMonitor(monitorId: string) {
    setRunningId(monitorId);
    try {
      await api.runMonitor(monitorId);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunningId(null);
    }
  }

  if (error) {
    return <p className="text-sm" style={{ color: "var(--muted)" }}>Erreur : {error}</p>;
  }
  if (!data) {
    return <p className="text-sm" style={{ color: "var(--muted)" }}>Chargement…</p>;
  }

  const { competitor, monitors, recentChanges, recentSignals } = data;
  const lastRun = monitors
    .map((m) => (m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);

  return (
    <div>
      <Link
        href="/dashboard/competitors"
        className="text-sm flex items-center gap-1 mb-4 hover:opacity-80"
        style={{ color: "var(--muted)" }}
      >
        <ArrowLeft size={14} /> Retour
      </Link>

      <Header competitor={competitor} lastRunMs={lastRun} />

      <AiSummary competitor={competitor} />

      <Monitors monitors={monitors} runningId={runningId} onRun={runMonitor} />

      <Tabs tab={tab} onChange={setTab} />

      <div className="mt-6">
        {tab === "activity" && (
          <ActivityTab signals={recentSignals} changes={recentChanges} />
        )}
        {tab === "pricing" && <PricingTab competitorId={id} />}
        {tab === "hiring" && <HiringTab competitorId={id} />}
        {tab === "reviews" && <ReviewsTab competitorId={id} />}
        {tab === "content" && <ContentTab changes={recentChanges} />}
      </div>
    </div>
  );
}

function Header({ competitor, lastRunMs }: { competitor: Competitor; lastRunMs: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-3 mb-1">
        <h1 style={{ fontFamily: "var(--font-syne)" }} className="text-2xl font-bold">
          {competitor.name}
        </h1>
        {competitor.category && (
          <span style={{ color: "var(--muted)" }} className="text-xs uppercase tracking-wide">
            {competitor.category}
          </span>
        )}
      </div>
      <a
        href={competitor.url}
        target="_blank"
        rel="noreferrer"
        style={{ color: "var(--muted)" }}
        className="text-sm flex items-center gap-1 hover:opacity-80"
      >
        {competitor.url} <ExternalLink size={12} />
      </a>
      <div className="mt-3 flex items-center gap-4 text-xs" style={{ color: "var(--muted)" }}>
        {competitor.overlapScore !== null && competitor.overlapScore !== undefined && (
          <div className="flex items-center gap-2">
            <span>Overlap</span>
            <div
              style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
              className="w-32 h-2 rounded-full overflow-hidden"
            >
              <div
                style={{
                  background: "var(--accent)",
                  width: `${Math.max(0, Math.min(100, competitor.overlapScore))}%`,
                  height: "100%",
                }}
              />
            </div>
            <span>{Math.round(competitor.overlapScore)} / 100</span>
          </div>
        )}
        {lastRunMs > 0 && (
          <span>
            dernière activité il y a{" "}
            {formatDistanceToNow(new Date(lastRunMs), { locale: fr })}
          </span>
        )}
      </div>
    </div>
  );
}

function AiSummary({ competitor }: { competitor: Competitor }) {
  if (!competitor.aiSummary) {
    return (
      <div
        className="mb-6 p-4 text-sm flex items-start gap-2"
        style={{
          background: "var(--surface)",
          border: "1px dashed var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--muted)",
        }}
      >
        <Sparkles size={14} className="mt-0.5" />
        <span>
          Résumé IA non encore généré. Il apparaîtra ici après le premier
          enrichissement.
        </span>
      </div>
    );
  }
  return (
    <div
      className="mb-6 p-4"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wide" style={{ color: "var(--accent)" }}>
        <Sparkles size={12} /> Résumé
      </div>
      <p className="text-sm leading-relaxed">{competitor.aiSummary}</p>
      {competitor.aiSummaryUpdatedAt && (
        <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
          mis à jour{" "}
          {formatDistanceToNow(new Date(competitor.aiSummaryUpdatedAt), {
            locale: fr,
            addSuffix: true,
          })}
        </p>
      )}
    </div>
  );
}

function Monitors({
  monitors,
  runningId,
  onRun,
}: {
  monitors: Monitor[];
  runningId: string | null;
  onRun: (id: string) => void;
}) {
  return (
    <div className="mb-6">
      <h2 style={{ fontFamily: "var(--font-syne)" }} className="text-sm font-bold mb-2 uppercase tracking-wide">
        Monitors
      </h2>
      <ul className="flex flex-col gap-2">
        {monitors.map((m) => (
          <li
            key={m.id}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
            className="p-3 flex items-center justify-between"
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium uppercase tracking-wide">
                {m.sourceType}{" "}
                <span style={{ color: "var(--muted)" }}>· {m.frequency}</span>
              </span>
              <span style={{ color: "var(--muted)" }} className="text-xs">
                {m.lastRunAt
                  ? `dernier scrape il y a ${formatDistanceToNow(new Date(m.lastRunAt), {
                      locale: fr,
                    })}`
                  : "jamais scrapé"}
              </span>
            </div>
            <button
              onClick={() => onRun(m.id)}
              disabled={runningId === m.id}
              style={{ background: "var(--accent)", color: "#000", borderRadius: "var(--radius)" }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              <Play size={12} /> {runningId === m.id ? "Lancé…" : "Scraper"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tabs({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <div
      className="flex gap-1 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              color: active ? "var(--accent)" : "var(--muted)",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
            }}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            <Icon size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}

function ActivityTab({
  signals,
  changes,
}: {
  signals: CompetitorSignal[];
  changes: ChangeRow[];
}) {
  if (signals.length === 0 && changes.length === 0) {
    return <Empty text="Aucune activité détectée pour ce concurrent." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {signals.map((s) => (
        <li
          key={s.id}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          className="p-3"
        >
          <div className="flex items-center gap-2 mb-1 text-xs">
            <span
              style={{ background: SEVERITY_COLOR[s.severity] ?? "var(--muted)", color: "#000" }}
              className="px-2 py-0.5 rounded uppercase tracking-wide text-[10px] font-semibold"
            >
              {s.severity}
            </span>
            <span style={{ color: "var(--muted)" }} className="uppercase tracking-wide">
              {s.category}
            </span>
            <span style={{ color: "var(--muted)" }}>
              · il y a {formatDistanceToNow(new Date(s.createdAt), { locale: fr })}
            </span>
          </div>
          <p className="text-sm mb-1">{s.insight}</p>
          {s.soWhat && (
            <p style={{ color: "var(--muted)" }} className="text-xs mb-1">
              → {s.soWhat}
            </p>
          )}
          {s.recommendedAction && (
            <p style={{ color: "var(--accent)" }} className="text-xs">
              Action : {s.recommendedAction}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function PricingTab({ competitorId }: { competitorId: string }) {
  const [history, setHistory] = useState<PricingHistoryPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCompetitorPricingHistory(competitorId)
      .then((r) => setHistory(r.history))
      .catch((e) => setErr(String(e)));
  }, [competitorId]);

  if (err) return <Empty text={`Erreur : ${err}`} />;
  if (history === null) return <Empty text="Chargement…" />;
  if (history.length === 0) {
    return <Empty text="Aucune donnée de pricing. Activez un monitor pricing pour ce concurrent." />;
  }

  const series = useMemo(() => buildPricingSeries(history), [history]);
  const plans = Object.keys(series.byPlan);
  const latestByPlan = new Map<string, PricingHistoryPoint>();
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );
  for (const p of sorted) latestByPlan.set(p.plan_name, p);
  const firstByPlan = new Map<string, PricingHistoryPoint>();
  for (const p of sorted) if (!firstByPlan.has(p.plan_name)) firstByPlan.set(p.plan_name, p);

  return (
    <div className="flex flex-col gap-4">
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
        className="p-4"
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={series.points}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
            <YAxis stroke="var(--muted)" fontSize={11} />
            <Tooltip
              contentStyle={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {plans.map((plan, i) => (
              <Line
                key={plan}
                type="monotone"
                dataKey={plan}
                stroke={lineColor(i)}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {plans.map((plan) => {
          const latest = latestByPlan.get(plan)!;
          const first = firstByPlan.get(plan)!;
          const delta = latest.price - first.price;
          const pct = first.price > 0 ? (delta / first.price) * 100 : 0;
          return (
            <li
              key={plan}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
              }}
              className="p-3"
            >
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {plan}
              </p>
              <p className="text-lg font-bold">
                {latest.price} {latest.currency} <span className="text-xs" style={{ color: "var(--muted)" }}>/ {latest.billing_period}</span>
              </p>
              {delta !== 0 && (
                <p className="text-xs" style={{ color: delta > 0 ? "#ef4444" : "#10b981" }}>
                  {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)} {latest.currency} ({pct.toFixed(0)}%)
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HiringTab({ competitorId }: { competitorId: string }) {
  const [jobs, setJobs] = useState<JobsByDepartment | null>(null);
  const [trends, setTrends] = useState<JobTrendPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getCompetitorJobs(competitorId),
      api.getCompetitorJobTrends(competitorId),
    ])
      .then(([j, t]) => {
        setJobs(j);
        setTrends(t.trends);
      })
      .catch((e) => setErr(String(e)));
  }, [competitorId]);

  if (err) return <Empty text={`Erreur : ${err}`} />;
  if (!jobs || !trends) return <Empty text="Chargement…" />;
  if (jobs.total === 0) {
    return <Empty text="Aucune offre détectée. Activez un monitor jobs pour ce concurrent." />;
  }

  const trendByDept = buildJobTrend(trends);

  return (
    <div className="flex flex-col gap-4">
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
        className="p-3"
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--muted)" }} className="text-xs uppercase tracking-wide">
              <th className="text-left py-2">Département</th>
              <th className="text-right py-2">Offres actives</th>
              <th className="text-right py-2">Trend 90j</th>
            </tr>
          </thead>
          <tbody>
            {jobs.departments
              .sort((a, b) => b.count - a.count)
              .map((d) => {
                const series = trendByDept[d.department] ?? [];
                const first = series[0]?.count ?? d.count;
                const last = series[series.length - 1]?.count ?? d.count;
                const delta = last - first;
                return (
                  <tr key={d.department} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-2">{d.department}</td>
                    <td className="py-2 text-right">{d.count}</td>
                    <td className="py-2 text-right" style={{ color: delta === 0 ? "var(--muted)" : delta > 0 ? "#10b981" : "#ef4444" }}>
                      {delta === 0 ? "—" : delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {Object.keys(trendByDept).length > 0 && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          className="p-4"
        >
          <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
            Évolution 90 jours
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={mergeTrendsByDate(trends)}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
              <YAxis stroke="var(--muted)" fontSize={11} />
              <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {Object.keys(trendByDept).map((dept, i) => (
                <Line key={dept} type="monotone" dataKey={dept} stroke={lineColor(i)} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ReviewsTab({ competitorId }: { competitorId: string }) {
  const [reviews, setReviews] = useState<ReviewsData | null>(null);
  const [scores, setScores] = useState<ReviewScorePoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getCompetitorReviews(competitorId),
      api.getCompetitorReviewScores(competitorId),
    ])
      .then(([r, s]) => {
        setReviews(r);
        setScores(s.scores);
      })
      .catch((e) => setErr(String(e)));
  }, [competitorId]);

  if (err) return <Empty text={`Erreur : ${err}`} />;
  if (!reviews || !scores) return <Empty text="Chargement…" />;
  if (reviews.recent.length === 0 && scores.length === 0) {
    return <Empty text="Aucune review collectée. Activez un monitor G2 ou Capterra." />;
  }

  const series = buildReviewScoreSeries(scores);

  return (
    <div className="flex flex-col gap-4">
      {scores.length > 0 && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          className="p-4"
        >
          <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
            Évolution du score
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series.points}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
              <YAxis domain={[0, 5]} stroke="var(--muted)" fontSize={11} />
              <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {series.sources.map((src, i) => (
                <Line key={src} type="monotone" dataKey={src} stroke={lineColor(i)} strokeWidth={2} dot />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ReviewColumn title="Ce qu'ils adorent" items={reviews.summary.praises} accent="#10b981" />
        <ReviewColumn title="Ce dont ils se plaignent" items={reviews.summary.complaints} accent="#ef4444" />
      </div>
    </div>
  );
}

function ContentTab({ changes }: { changes: ChangeRow[] }) {
  const blog = changes.filter((c) => c.sourceType === "blog" || c.sourceType === "changelog");
  if (blog.length === 0) {
    return <Empty text="Aucun contenu détecté (blog / changelog)." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {blog.map((c) => (
        <li
          key={c.id}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          className="p-3"
        >
          <p style={{ color: "var(--muted)" }} className="text-xs mb-1">
            il y a {formatDistanceToNow(new Date(c.detectedAt), { locale: fr })} · {c.sourceType}
          </p>
          {c.diffText && (
            <pre style={{ color: "var(--muted)" }} className="text-xs whitespace-pre-wrap font-mono">
              {c.diffText.slice(0, 400)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReviewColumn({ title, items, accent }: { title: string; items: Array<string | null>; accent: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}
      className="p-3"
    >
      <p className="text-xs uppercase tracking-wide mb-2" style={{ color: accent }}>
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>—</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {items.filter(Boolean).map((it, i) => (
            <li key={i}>· {it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p
      className="text-sm p-6 text-center"
      style={{
        color: "var(--muted)",
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      {text}
    </p>
  );
}

function lineColor(i: number): string {
  const palette = ["#F59E0B", "#22d3ee", "#a855f7", "#10b981", "#ef4444", "#f97316"];
  return palette[i % palette.length] ?? "#F59E0B";
}

function shortDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function buildPricingSeries(history: PricingHistoryPoint[]): {
  points: Array<Record<string, number | string>>;
  byPlan: Record<string, PricingHistoryPoint[]>;
} {
  const byPlan: Record<string, PricingHistoryPoint[]> = {};
  for (const p of history) {
    (byPlan[p.plan_name] ??= []).push(p);
  }
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of history) {
    const date = shortDate(p.recorded_at);
    const row = byDate.get(date) ?? { date };
    row[p.plan_name] = p.price;
    byDate.set(date, row);
  }
  const points = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  return { points, byPlan };
}

function buildJobTrend(points: JobTrendPoint[]): Record<string, JobTrendPoint[]> {
  const byDept: Record<string, JobTrendPoint[]> = {};
  for (const p of points) {
    (byDept[p.department] ??= []).push(p);
  }
  return byDept;
}

function mergeTrendsByDate(points: JobTrendPoint[]): Array<Record<string, number | string>> {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const date = shortDate(p.recorded_at);
    const row = byDate.get(date) ?? { date };
    row[p.department] = p.count;
    byDate.set(date, row);
  }
  return Array.from(byDate.values());
}

function buildReviewScoreSeries(points: ReviewScorePoint[]): {
  points: Array<Record<string, number | string>>;
  sources: string[];
} {
  const sources = Array.from(new Set(points.map((p) => p.source)));
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const date = shortDate(p.recorded_at);
    const row = byDate.get(date) ?? { date };
    row[p.source] = p.score;
    byDate.set(date, row);
  }
  return { points: Array.from(byDate.values()), sources };
}
