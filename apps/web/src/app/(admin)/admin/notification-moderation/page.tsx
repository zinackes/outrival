import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty } from "../_components/shell";

interface ModerationMetrics {
  period: number;
  volume: {
    generated: number;
    filteredByReason: Record<string, number>;
    batchedSignals: number;
    batchingRate: number;
  };
  byChannel: Record<string, number>;
  batches: { created: number };
  orgConfig: {
    total: number;
    timezoneAuto: number;
    timezoneManual: number;
    batchingOn: number;
    defaultQuietHours: number;
  };
  thresholds: Array<{
    source: string;
    count: number;
    avg: number | null;
    stddev: number | null;
  }>;
}

const REASON_LABELS: Record<string, string> = {
  below_threshold: "Below threshold",
  channel_muted: "Below severity channel",
  quiet_hours: "Quiet hours",
  frequency_cap: "Frequency cap",
};

const CHANNEL_LABELS: Record<string, string> = {
  email_immediate: "Immediate email",
  digest_daily: "Daily digest",
  digest_weekly: "Weekly digest",
  in_app_only: "In-app only",
  muted: "Muted",
};

const SOURCE_LABELS: Record<string, string> = {
  default: "Default (0.5)",
  auto_adjusted: "Auto-adjusted",
  user_set: "Manually set",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function share(n: number, total: number): string {
  return total > 0 ? ` (${pct(n / total)})` : "";
}

export default async function NotificationModerationPage() {
  const m = await adminFetch<ModerationMetrics>("/api/admin/notification-moderation");

  if (!m) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Notification moderation" subtitle="Last 30 days" />
        <Empty>Metrics unavailable.</Empty>
      </div>
    );
  }

  const generated = m.volume.generated;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notification moderation"
        subtitle="How much is generated, how it's filtered per layer, and how orgs configure it. Last 30 days."
      />

      <Section
        title="Volume"
        info="How many signals were generated and how many were merged into batches (3+ similar signals collapsed into one notification) over the window."
      >
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Signals generated" value={generated} />
          <Stat
            label="Batched"
            value={m.volume.batchedSignals}
            hint={`${pct(m.volume.batchingRate)} of signals`}
          />
          <Stat label="Batches created" value={m.batches.created} />
        </div>
      </Section>

      <Section
        title="Filtered per layer"
        info="Signals suppressed before delivery, grouped by which moderation layer caught them — relevance threshold, per-severity channel, quiet hours, or daily frequency cap. Critical signals bypass every layer."
      >
        {Object.keys(m.volume.filteredByReason).length === 0 ? (
          <Empty>Nothing filtered in this window.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {Object.entries(m.volume.filteredByReason).map(([reason, count]) => (
              <Stat
                key={reason}
                label={REASON_LABELS[reason] ?? reason}
                value={count}
                hint={`${share(count, generated).trim() || "—"}`}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="By delivery channel"
        info="How delivered signals were routed: immediate email, daily or weekly digest, in-app only, or muted."
      >
        {Object.keys(m.byChannel).length === 0 ? (
          <Empty>No dispatched signals yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
            {Object.entries(m.byChannel).map(([channel, count]) => (
              <Stat key={channel} label={CHANNEL_LABELS[channel] ?? channel} value={count} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Org configuration"
        note={`${m.orgConfig.total} configured`}
        info="How organisations have configured notifications: timezone source (auto-detected vs manual), whether batching is on, and whether they kept the default quiet hours."
      >
        {m.orgConfig.total === 0 ? (
          <Empty>No org has saved notification preferences yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat
              label="Timezone auto-detected"
              value={m.orgConfig.timezoneAuto}
              hint={share(m.orgConfig.timezoneAuto, m.orgConfig.total).trim()}
            />
            <Stat
              label="Timezone manual"
              value={m.orgConfig.timezoneManual}
              hint={share(m.orgConfig.timezoneManual, m.orgConfig.total).trim()}
            />
            <Stat
              label="Batching on"
              value={m.orgConfig.batchingOn}
              hint={share(m.orgConfig.batchingOn, m.orgConfig.total).trim()}
            />
            <Stat
              label="Default quiet hours"
              value={m.orgConfig.defaultQuietHours}
              hint={share(m.orgConfig.defaultQuietHours, m.orgConfig.total).trim()}
            />
          </div>
        )}
      </Section>

      <Section
        title="Relevance thresholds"
        info="Per-org relevance threshold and where it came from — the 0.5 default, a user-set value, or one auto-adjusted from feedback. Signals scoring below it are suppressed."
      >
        {m.thresholds.length === 0 ? (
          <Empty>No org has a stored threshold — all running the default 0.5.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
            {m.thresholds.map((t) => (
              <Stat
                key={t.source}
                label={SOURCE_LABELS[t.source] ?? t.source}
                value={t.count}
                hint={
                  t.avg != null
                    ? `avg ${t.avg.toFixed(2)} · σ ${(t.stddev ?? 0).toFixed(2)}`
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
