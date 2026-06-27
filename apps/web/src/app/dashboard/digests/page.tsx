import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { DigestsView } from "@/components/dashboard/digests-view";
import { getDigestsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { digestsQuery } from "@/lib/queries";

export default async function DigestsPage() {
  // Best-effort server seed; null → DigestsView's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getDigestsData();
  if (initial) queryClient.setQueryData(digestsQuery().queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DigestsView />
    </HydrationBoundary>
  );
}
