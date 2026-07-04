import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { SignalsView } from "@/components/dashboard/signals-view";
import { getSignalsFeedPage, getSignalsFacets } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { signalsFeedQuery, signalsFacetsQuery } from "@/lib/queries";
import type { SignalsFeedParams } from "@/lib/api";

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const product = await resolveServerScope(
    typeof sp.product === "string" ? sp.product : undefined,
  );
  const sort = sp.sort === "recent" ? "recent" : "threat";
  const queryClient = makeServerQueryClient();
  const [page, facets] = await Promise.all([
    getSignalsFeedPage({ productId: product, sort }),
    getSignalsFacets(product),
  ]);
  // Seed the unfiltered first page under the exact key SignalsView reads when no feed
  // filter is active (the common landing case) — an infinite-query cache shape. Any URL
  // filter yields a different key → a client fetch, exactly like before. Best-effort.
  const seedParams: SignalsFeedParams = { sort, ...(product ? { productId: product } : {}) };
  if (page) {
    queryClient.setQueryData(signalsFeedQuery(seedParams).queryKey, {
      pages: [page],
      pageParams: [0],
    });
  }
  if (facets) {
    queryClient.setQueryData(signalsFacetsQuery(product).queryKey, facets);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SignalsView />
    </HydrationBoundary>
  );
}
