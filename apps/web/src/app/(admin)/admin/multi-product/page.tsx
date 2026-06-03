import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty, pctFmt } from "../_components/shell";
import type { AdminMultiProductMetrics } from "@/lib/api";

export default async function MultiProductMetricsPage() {
  const m = await adminFetch<AdminMultiProductMetrics>(
    "/api/admin/multi-product-metrics",
  );

  if (!m) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Products" subtitle="Multi-SKU adoption." />
        <Section title="Products">
          <Empty>Metrics unavailable.</Empty>
        </Section>
      </div>
    );
  }

  const assocTotal = m.associations.shared + m.associations.specific;
  const sharedPct = assocTotal > 0 ? m.associations.shared / assocTotal : null;
  const specificPct = assocTotal > 0 ? m.associations.specific / assocTotal : null;

  const dist: Array<{ label: string; value: number }> = [
    { label: "1 product", value: m.distribution.one },
    { label: "2 products", value: m.distribution.two },
    { label: "3 products", value: m.distribution.three },
    { label: "4–5 products", value: m.distribution.fourToFive },
    { label: "6+ products", value: m.distribution.sixPlus },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Products"
        subtitle={`Multi-SKU adoption — ${m.orgsWithProducts} org${m.orgsWithProducts === 1 ? "" : "s"} with products, ${m.multiProductOrgs} multi-product.`}
      />

      <Section title="Overview">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Orgs with products" value={m.orgsWithProducts} />
          <Stat label="Multi-product orgs" value={m.multiProductOrgs} />
          <Stat label="Active products" value={m.totalActiveProducts} />
          <Stat label="Battle cards" value={m.battleCards.total} />
        </div>
      </Section>

      <Section title="Orgs by product count">
        <div className="flex flex-col">
          {dist.map((d) => (
            <div
              key={d.label}
              className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0"
            >
              <span className="text-sm">{d.label}</span>
              <span className="font-mono text-sm text-muted-foreground">
                {d.value} org{d.value === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Shared vs specific competitors"
        note="hybrid model — most should be shared"
      >
        {assocTotal === 0 ? (
          <Empty>No product–competitor associations yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <Stat
              label="Shared"
              value={`${m.associations.shared}${sharedPct == null ? "" : ` · ${pctFmt(sharedPct)}`}`}
            />
            <Stat
              label="Specific"
              value={`${m.associations.specific}${specificPct == null ? "" : ` · ${pctFmt(specificPct)}`}`}
            />
          </div>
        )}
      </Section>

      <Section title="Battle cards">
        <div className="grid grid-cols-3 gap-6">
          <Stat label="Total" value={m.battleCards.total} />
          <Stat label="Unique couples" value={m.battleCards.couples} />
          <Stat
            label="Avg / product"
            value={m.battleCards.avgPerProduct.toFixed(1)}
          />
        </div>
      </Section>
    </div>
  );
}
