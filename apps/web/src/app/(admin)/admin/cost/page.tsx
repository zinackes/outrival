import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty, usdFmt, bytesFmt } from "../_components/shell";
import type { AdminCost } from "@/lib/api";

export default async function CostPage() {
  const cost = await adminFetch<AdminCost>("/api/admin/cost");

  if (!cost) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Cost" subtitle="Estimates — trends, not accounting." />
        <Section title="Cost">
          <Empty>Cost data unavailable (ClickHouse down or empty).</Empty>
        </Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Cost" subtitle="Estimates — trends, not accounting. Tune the constants as real invoices land." />

      <Section title="Proxy — ProxyScrape (datacenter + residential)" note="estimate">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Paid scrapes (24h)" value={cost.proxy.scrapes24h} />
          <Stat label="Paid scrapes (30d)" value={cost.proxy.scrapes30d} />
          <Stat
            label="≈ 24h"
            value={usdFmt(cost.proxy.estUsd24h)}
            hint={`+ $${cost.proxy.fixedUsdPerMonth}/mo datacenter`}
          />
          <Stat label="≈ 30d" value={usdFmt(cost.proxy.estUsd30d)} />
        </div>
      </Section>

      <Section title="AI — Groq" note="estimate">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Calls (24h)" value={cost.ai.calls24h} />
          <Stat label="Calls (30d)" value={cost.ai.calls30d} />
          <Stat label="≈ 24h" value={usdFmt(cost.ai.estUsd24h)} hint="cache hits over-counted" />
          <Stat label="≈ 30d" value={usdFmt(cost.ai.estUsd30d)} />
        </div>
      </Section>

      <Section title="Storage">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
          <Stat label="Postgres" value={bytesFmt(cost.storage.postgresBytes)} />
          <Stat label="ClickHouse" value={bytesFmt(cost.storage.clickhouseBytes)} />
          <Stat label="R2" value="n/a" hint="no cheap usage API" />
        </div>
      </Section>
    </div>
  );
}
