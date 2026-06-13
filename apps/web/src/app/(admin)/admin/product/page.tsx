import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty, pctFmt } from "../_components/shell";
import type { AdminProductKpis } from "@/lib/api";

// PostHog keeps the deep analytics; we only link to its dashboard. The public
// env is the ingest host (eu.i.posthog.com) — the browsable app drops the `i.`.
function posthogDashboardUrl(): string | null {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return null;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!host) return "https://posthog.com";
  return host.replace("://i.", "://").replace(".i.posthog.com", ".posthog.com");
}

export default async function ProductPage() {
  const kpis = await adminFetch<AdminProductKpis>("/api/admin/product-kpis");
  const posthog = posthogDashboardUrl();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Product"
        subtitle="Top-line product KPIs — the deep analytics live in PostHog."
      />

      <Section
        title="Adoption & engagement"
        info="A handful of product signals from Postgres: new signups, onboarding adoption & completion, and signals delivered. Funnels, retention and event analysis stay in PostHog — this is the at-a-glance layer, not a reconstruction."
        action={
          posthog ? (
            <Link
              href={posthog}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Open PostHog
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : undefined
        }
      >
        {kpis ? (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat label="New users (7d)" value={kpis.newUsers7d} hint="signups" />
            <Stat
              label="Onboarded orgs"
              value={pctFmt(kpis.orgs.adoptionRate)}
              hint={`${kpis.orgs.onboarded} / ${kpis.orgs.total} orgs`}
            />
            <Stat
              label="Onboarding completion (30d)"
              value={kpis.onboarding30d.started ? pctFmt(kpis.onboarding30d.completionRate) : "—"}
              hint={`${kpis.onboarding30d.completed} / ${kpis.onboarding30d.started} sessions`}
            />
            <Stat label="Signals (7d)" value={kpis.signals7d} hint="delivered" />
          </div>
        ) : (
          <Empty>Product KPIs unavailable.</Empty>
        )}
      </Section>
    </div>
  );
}
