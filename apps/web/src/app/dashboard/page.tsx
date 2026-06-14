import { OverviewView } from "@/components/dashboard/overview";
import { getOverviewData } from "@/lib/api-server";

export default async function DashboardHomePage() {
  // Prefetch on the server (best-effort) so data is in the first paint instead
  // of after JS hydration + a browser round-trip; null falls back to the
  // client fetch inside OverviewView.
  const initial = await getOverviewData();
  return (
    <OverviewView
      initialSignals={initial?.signals ?? null}
      initialCompetitors={initial?.competitors ?? null}
    />
  );
}
