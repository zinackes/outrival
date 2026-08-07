import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { UsageDashboard } from "@/components/outrival/usage-dashboard";
import { getUsageData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { usageQuery } from "@/lib/queries";

// The dashboard owns the page head: the plan badge beside the title comes from
// the same query as the rows, so splitting them would mean fetching twice or
// threading the plan back up through props.
export default async function UsagePage() {
  // Best-effort server seed; null → UsageDashboard's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getUsageData();
  if (initial) queryClient.setQueryData(usageQuery().queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <UsageDashboard />
    </HydrationBoundary>
  );
}
