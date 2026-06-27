import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { UsageDashboard } from "@/components/outrival/usage-dashboard";
import { getUsageData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { usageQuery } from "@/lib/queries";

export default async function UsagePage() {
  // Best-effort server seed; null → UsageDashboard's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getUsageData();
  if (initial) queryClient.setQueryData(usageQuery().queryKey, initial);
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Usage</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Where you stand against your plan limits.
        </p>
      </header>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <UsageDashboard />
      </HydrationBoundary>
    </section>
  );
}
