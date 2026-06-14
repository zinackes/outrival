import { UsageDashboard } from "@/components/outrival/usage-dashboard";
import { getUsageData } from "@/lib/api-server";

export default async function UsagePage() {
  // Best-effort server prefetch; null falls back to the client fetch inside the
  // dashboard.
  const initialData = await getUsageData();
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Usage</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Where you stand against your plan limits.
        </p>
      </header>
      <UsageDashboard initialData={initialData} />
    </section>
  );
}
