import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { DiscoveryView } from "./discovery-view";
import { getDiscoveryData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { candidatesQuery } from "@/lib/queries";
import { resolveServerScope } from "@/lib/product-scope-server";

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // patch-28 — discovery is product-scoped. Resolve the active product (URL override
  // wins, else the sticky cookie) so the server seed matches the client's scoped key.
  const { product } = await searchParams;
  const productId = await resolveServerScope(product);

  // Seed the "new" queue (list + counts). Staleness is left to its own client query
  // (its full shape isn't in getDiscoveryData; it gates only a soft nudge).
  // Best-effort: null → the client useQueries fetch on mount.
  const queryClient = makeServerQueryClient();
  const initial = await getDiscoveryData(productId);
  if (initial) {
    queryClient.setQueryData(candidatesQuery("new", productId).queryKey, {
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
