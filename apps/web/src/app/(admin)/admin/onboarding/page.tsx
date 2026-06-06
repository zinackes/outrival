import { AlertTriangle } from "lucide-react";
import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty, durationFmt, pctFmt } from "../_components/shell";
import type { AdminOnboardingMetrics } from "@/lib/api";

export default async function OnboardingMetricsPage() {
  const m = await adminFetch<AdminOnboardingMetrics>("/api/admin/onboarding-metrics");

  if (!m) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Onboarding" subtitle="Funnel timing & drop-off." />
        <Section title="Onboarding">
          <Empty>Metrics unavailable.</Empty>
        </Section>
      </div>
    );
  }

  const noSteps = m.segments.every((s) => s.count === 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Onboarding"
        subtitle={`Funnel timing & drop-off — last ${m.windowDays} days, ${m.total} session${m.total === 1 ? "" : "s"}.`}
      />

      <Section
        title="Status"
        info="Onboarding sessions by outcome (completed / in progress / abandoned) and the quick-start vs full-mode split, over the window."
      >
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Completed" value={m.byStatus.completed} />
          <Stat label="In progress" value={m.byStatus.inProgress} />
          <Stat label="Abandoned" value={m.byStatus.abandoned} />
          <Stat
            label="Quick / Full"
            value={`${m.modeSplit.quick_start} / ${m.modeSplit.full}`}
          />
        </div>
      </Section>

      <Section
        title="Step durations"
        note="median · p90 · p95"
        info="Time spent on each onboarding step (median, p90, p95), computed from per-milestone timings. The count in parentheses is how many sessions reached that step."
      >
        {noSteps ? (
          <Empty>No completed steps in this window yet.</Empty>
        ) : (
          <div className="flex flex-col">
            {m.segments.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0"
              >
                <span className="text-sm">
                  {s.label} <span className="text-muted-foreground">({s.count})</span>
                </span>
                <span className="font-mono text-sm text-muted-foreground">
                  {durationFmt(s.medianMs)} · {durationFmt(s.p90Ms)} · {durationFmt(s.p95Ms)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Drop-off by stage"
        note="> 15% flagged"
        info="Share of sessions lost between consecutive funnel stages. Stages losing more than 15% are flagged as the biggest leaks to fix."
      >
        <div className="flex flex-col">
          {m.funnel.map((f) => {
            const high = (f.dropoffPct ?? 0) > 0.15;
            return (
              <div
                key={f.key}
                className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0"
              >
                <span className="text-sm">{f.label}</span>
                <span className="flex items-center gap-3 font-mono text-sm">
                  <span className="text-muted-foreground">{f.reached} reached</span>
                  <span
                    className="inline-flex w-24 items-center justify-end gap-1 text-right"
                    style={high ? { color: "var(--critical)" } : { color: "var(--muted-foreground)" }}
                  >
                    {f.dropoffPct == null ? "—" : `${pctFmt(f.dropoffPct)} drop`}
                    {high && f.dropoffPct != null && <AlertTriangle className="size-3" />}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
