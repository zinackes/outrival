import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { CompetitorsList } from "@/components/dashboard/competitors-list";
import { getCompetitorsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { competitorsQuery } from "@/lib/queries";

export default async function CompetitorsPage() {
  // Best-effort server seed; null → CompetitorsList's useQuery fetches client-side
  // (it also keeps polling every 30s regardless).
  const queryClient = makeServerQueryClient();
  const initial = await getCompetitorsData();
  if (initial) queryClient.setQueryData(competitorsQuery().queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CompetitorsList />
    </HydrationBoundary>
  );
}
