import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty } from "../_components/shell";

interface MonitorsHealth {
  period: number;
  silentThresholdDays: number;
  total: number;
  distribution: { fresh: number; yellow: number; orange: number; red: number };
  redByCategory: Record<string, number>;
  silentCount: number;
  rescans: {
    total: number;
    byTier: Record<string, number>;
    useful: number;
    wasted: number;
    usefulRate: number;
  };
  silentNotificationsSent: number;
}

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  business: "Business",
};

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : "—";
}

export default async function MonitorsHealthPage() {
  const m = await adminFetch<MonitorsHealth>("/api/admin/monitors-health");

  if (!m) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Monitors health" subtitle="Current state" />
        <Empty>Metrics unavailable.</Empty>
      </div>
    );
  }

  const redCats = Object.entries(m.redByCategory).sort((a, b) => b[1] - a[1]);
  const tiers = ["free", "starter", "pro", "business"];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Monitors health"
        subtitle="Freshness of active sources (what users see as dots), silent sources, and the forced re-scan useful/wasted ratio."
      />

      <Section
        title="Freshness distribution"
        note={`${m.total} active sources`}
        info="Active sources by freshness — the colored dots users see. Fresh, then yellow/orange/red as data ages past per-source-type staleness thresholds."
      >
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Fresh" value={m.distribution.fresh} hint={pct(m.distribution.fresh, m.total)} />
          <Stat label="Yellow" value={m.distribution.yellow} hint={pct(m.distribution.yellow, m.total)} />
          <Stat label="Orange" value={m.distribution.orange} hint={pct(m.distribution.orange, m.total)} />
          <Stat label="Red" value={m.distribution.red} hint={pct(m.distribution.red, m.total)} />
        </div>
      </Section>

      <Section
        title="Red by source category"
        info="The stalest (red) sources broken down by source type — shows which categories are falling behind their freshness threshold."
      >
        {redCats.length === 0 ? (
          <Empty>No source is red right now.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
            {redCats.map(([cat, count]) => (
              <Stat key={cat} label={cat} value={count} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Silent sources"
        note={`no signal in ${m.silentThresholdDays}+ days`}
        info="Active sources that have produced no signal beyond the silent threshold (often a quietly-broken monitor), and how many user alerts were sent for them in the period."
      >
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
          <Stat label="Silent sources" value={m.silentCount} />
          <Stat
            label="User alerts sent"
            value={m.silentNotificationsSent}
            hint={`last ${m.period}d`}
          />
        </div>
      </Section>

      <Section
        title="Forced re-scans"
        note={`last ${m.period} days`}
        info="User-triggered re-scans over the period: how many surfaced a change (useful) vs found nothing (wasted), and the split by plan tier. A low useful rate suggests the limit is too generous."
      >
        {m.rescans.total === 0 ? (
          <Empty>No forced re-scan in this window.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Stat label="Total" value={m.rescans.total} />
              <Stat
                label="Found a change"
                value={m.rescans.useful}
                hint={`${Math.round(m.rescans.usefulRate * 100)}% of completed`}
              />
              <Stat label="Nothing new" value={m.rescans.wasted} />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
              {tiers.map((t) => (
                <Stat key={t} label={TIER_LABELS[t] ?? t} value={m.rescans.byTier[t] ?? 0} />
              ))}
            </div>
            {m.rescans.usefulRate < 0.4 && m.rescans.useful + m.rescans.wasted >= 20 && (
              <p className="mt-4 text-xs text-muted-foreground">
                Most forced re-scans found nothing — consider communicating the automatic
                cadence more clearly so users don&apos;t re-scan unnecessarily.
              </p>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
