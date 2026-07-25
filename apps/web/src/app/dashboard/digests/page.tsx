import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { DigestsView } from "@/components/dashboard/digests-view";
import { getCompetitorsData, getDigestsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { competitorsQuery, digestsQuery } from "@/lib/queries";

export default async function DigestsPage() {
  // Best-effort server seed; null → DigestsView's useQuery fetches client-side.
  // The roster rides along because the list tints and links the competitors each
  // brief names, and fetching it from the client would put a waterfall in front of
  // the one thing this page is for.
  const queryClient = makeServerQueryClient();
  const [initial, competitors] = await Promise.all([getDigestsData(), getCompetitorsData()]);
  if (initial) queryClient.setQueryData(digestsQuery().queryKey, initial);
  if (competitors) queryClient.setQueryData(competitorsQuery().queryKey, competitors);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DigestsView />
    </HydrationBoundary>
  );
}
