import Link from "next/link";
import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty } from "../_components/shell";

interface TypeAgg {
  useful: number;
  not_useful: number;
  neutral: number;
  total: number;
  notUsefulRate: number;
}

interface Stats {
  period: number;
  byType: Record<string, TypeAgg>;
  nps: {
    score: number | null;
    responses: number;
    average: number | null;
    promoters: number;
    detractors: number;
  };
}

interface Pattern {
  targetType: string;
  total: number;
  notUseful: number;
  notUsefulRate: number;
  topReasons: Array<{ reason: string; count: number }>;
}

interface Patterns {
  windowDays: number;
  minCount: number;
  patterns: Pattern[];
}

const TYPE_LABELS: Record<string, string> = {
  signal: "Signals",
  discovery_suggestion: "Discovery",
  battle_card: "Battle cards",
  digest: "Digest",
  severity_classification: "Severity",
  nps: "NPS",
};

// The AI output types shown as stat cards (NPS has its own section).
const STAT_TYPES = ["signal", "discovery_suggestion", "battle_card", "digest", "severity_classification"];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

export default async function FeedbackQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const p = period === "30d" ? "30d" : "7d";

  const [stats, patterns] = await Promise.all([
    adminFetch<Stats>(`/api/admin/feedback-quality/stats?period=${p}`),
    adminFetch<Patterns>(`/api/admin/feedback-quality/patterns`),
  ]);

  const periodLink = (value: "7d" | "30d", label: string) => (
    <Link
      href={`/admin/feedback-quality?period=${value}`}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
        p === value
          ? "border-border-strong bg-secondary text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Feedback quality"
        subtitle="User verdicts on AI output. Signals for tuning prompts & thresholds — never auto-applied."
      />

      <div className="flex items-center gap-2">
        {periodLink("7d", "7 days")}
        {periodLink("30d", "30 days")}
      </div>

      <Section
        title="Patterns to review"
        note={patterns ? `${patterns.windowDays}d · min ${patterns.minCount}` : undefined}
      >
        {!patterns || patterns.patterns.length === 0 ? (
          <Empty>
            No pattern crosses the threshold (≥{patterns?.minCount ?? 5} feedbacks &amp; &gt;60%
            not useful). Nothing flagged.
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {patterns.patterns.map((pat) => (
              <div
                key={pat.targetType}
                className="rounded-md border border-border p-3"
                style={{ borderColor: "var(--critical)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{typeLabel(pat.targetType)}</span>
                  <span className="text-sm" style={{ color: "var(--critical)" }}>
                    {pct(pat.notUsefulRate)} not useful ({pat.notUseful}/{pat.total})
                  </span>
                </div>
                {pat.topReasons.length > 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Top reasons:{" "}
                    {pat.topReasons.map((r) => `${r.reason} (${r.count})`).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`By AI output · last ${p === "30d" ? "30" : "7"} days`}>
        {!stats || Object.keys(stats.byType).length === 0 ? (
          <Empty>No feedback recorded in this window.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
            {STAT_TYPES.filter((t) => stats.byType[t]).map((t) => {
              const agg = stats.byType[t]!;
              return (
                <Stat
                  key={t}
                  label={typeLabel(t)}
                  value={`${pct(agg.notUsefulRate)} 👎`}
                  hint={`${agg.useful} 👍 · ${agg.not_useful} 👎 · ${agg.total} total`}
                />
              );
            })}
          </div>
        )}
      </Section>

      <Section title="NPS · last 30 days">
        {!stats || stats.nps.responses === 0 ? (
          <Empty>No NPS responses yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat label="NPS" value={stats.nps.score ?? "—"} />
            <Stat label="Avg score" value={stats.nps.average ?? "—"} />
            <Stat label="Promoters" value={stats.nps.promoters} hint="score ≥ 9" />
            <Stat label="Detractors" value={stats.nps.detractors} hint="score ≤ 6" />
          </div>
        )}
      </Section>
    </div>
  );
}
