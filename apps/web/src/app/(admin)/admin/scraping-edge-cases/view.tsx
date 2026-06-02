"use client";

import { PageHeader, Section, Stat, Empty } from "../_components/shell";
import type { AdminEdgeCases } from "@/lib/api";

const CATEGORY_ORDER = [
  "anti_bot",
  "site_dead",
  "site_redirected",
  "login_required",
  "spa_empty",
  "geo_blocked",
  "unknown",
] as const;

const ALT_ORDER = ["proposed", "accepted", "rejected", "manual_data"] as const;
const STRUCT_ORDER = ["detected", "confirmed", "false_positive", "resolved"] as const;

function Rows({ order, data }: { order: readonly string[]; data: Record<string, number> }) {
  const keys = order.filter((k) => data[k] != null);
  if (keys.length === 0) return <Empty>None in the window.</Empty>;
  return (
    <div className="flex flex-col gap-2">
      {keys.map((k) => (
        <div key={k} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
          <span className="font-semibold tabular-nums">{data[k]}</span>
        </div>
      ))}
    </div>
  );
}

export function EdgeCasesView({ data }: { data: AdminEdgeCases | null }) {
  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Scraping edge cases" />
        <Empty>No data available.</Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Scraping edge cases"
        subtitle={`Failure diagnoses, alternatives, structural changes and SPA capture. Window: ${data.windowDays}d.`}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Failures by category" note={`${data.windowDays}d`}>
          <Rows order={CATEGORY_ORDER} data={data.failuresByCategory} />
        </Section>

        <Section title="Alternatives proposed">
          <Rows order={ALT_ORDER} data={data.alternativesByStatus} />
        </Section>

        <Section title="Structural changes">
          <Rows order={STRUCT_ORDER} data={data.structuralByStatus} />
        </Section>

        <Section title="SPA API capture">
          <Stat label="Monitors with capture enabled" value={data.apiCaptureEnabledMonitors} />
        </Section>
      </div>
    </div>
  );
}
