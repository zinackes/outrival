import { PageHeader, Section } from "../_components/shell";

// Wave 2 (admin-v2) fills this from the Stripe API (revenue) + Postgres (tiers,
// trials) — aggregated, never reconstructed. Shipped now as a placeholder so the
// section exists in the nav and the later build is non-disruptive.
const PLANNED = [
  { label: "MRR / ARR", source: "Stripe API — monthly recurring + a trend curve" },
  { label: "Users by tier", source: "Postgres — org count per plan" },
  { label: "Free → paid conversion", source: "Postgres — signup → first paid" },
  { label: "Churn + MRR churn", source: "Stripe API — cancellations & downgrades" },
  { label: "Active trials", source: "Stripe API — in progress + expiring soon" },
  { label: "Net revenue retention", source: "Stripe API — expansion vs contraction" },
];

export default function BusinessPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Business" subtitle="Revenue & growth — consolidated from Stripe + Postgres." />

      <Section
        title="Coming soon"
        note="wave 2"
        info="Business metrics land once the first paid subscriptions exist. Revenue is aggregated from the Stripe API and tier/trial counts from Postgres — the cockpit doesn't reconstruct Stripe, it surfaces a unified view."
      >
        <ul className="flex flex-col divide-y divide-border">
          {PLANNED.map((m) => (
            <li key={m.label} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm font-medium">{m.label}</span>
              <span className="text-meta text-muted-foreground">{m.source}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
