import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { DiscoveryView } from "./discovery-view";
import { getDiscoveryData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { candidatesQuery, discoveryStalenessQuery } from "@/lib/queries";
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

  // Seed the "new" queue and the staleness record: together they carry every number
  // the page's opening reading is made of, so the first paint states a verdict rather
  // than a skeleton. Best-effort: null → the client queries fetch on mount.
  const queryClient = makeServerQueryClient();
  const initial = await getDiscoveryData(productId);
  if (initial) {
    queryClient.setQueryData(candidatesQuery("new", productId).queryKey, initial.list);
    queryClient.setQueryData(
      discoveryStalenessQuery(productId).queryKey,
      initial.staleness,
    );
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DiscoveryView />
    </HydrationBoundary>
  );
}
