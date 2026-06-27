import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { DiscoveryView } from "./discovery-view";
import { getDiscoveryData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { candidatesQuery } from "@/lib/queries";

export default async function DiscoveryPage() {
  // Seed the "new" queue (list + counts). Staleness is left to its own client query
  // (its full shape isn't in getDiscoveryData; it gates only a soft nudge).
  // Best-effort: null → the client useQueries fetch on mount.
  const queryClient = makeServerQueryClient();
  const initial = await getDiscoveryData();
  if (initial) {
    queryClient.setQueryData(candidatesQuery("new").queryKey, {
      candidates: initial.candidates,
      counts: initial.counts,
    });
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DiscoveryView />
    </HydrationBoundary>
  );
}
