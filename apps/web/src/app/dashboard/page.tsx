import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { OverviewView } from "@/components/dashboard/overview";
import { getOverviewData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { signalsQuery, competitorsQuery } from "@/lib/queries";

export default async function DashboardHomePage() {
  // Seed the query cache on the server (best-effort, one aggregated cookie-forwarded
  // fetch) so data lands in the first paint. On failure the cache stays empty and
  // OverviewView's useQuery fetches client-side — never slower than before.
  const queryClient = makeServerQueryClient();
  const initial = await getOverviewData();
  if (initial) {
    queryClient.setQueryData(signalsQuery({ limit: 200 }).queryKey, initial.signals);
    queryClient.setQueryData(competitorsQuery().queryKey, initial.competitors);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OverviewView />
    </HydrationBoundary>
  );
}
