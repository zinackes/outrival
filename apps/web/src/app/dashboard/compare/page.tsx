import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { CompareView } from "@/components/dashboard/compare-view";
import { getCompareData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { productsListQuery, competitorsQuery } from "@/lib/queries";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // Seed the picker inputs (products + competitors). Best-effort: null → the client
  // useQueries fetch on mount. The comparison matrix stays client-side (it tracks
  // the user's live selection). patch-28 — scope the competitor picker: URL ?product=
  // override wins, else the persisted cookie scope.
  const { product: urlProduct } = await searchParams;
  const product = await resolveServerScope(urlProduct);
  const queryClient = makeServerQueryClient();
  const initial = await getCompareData(product);
  if (initial) {
    queryClient.setQueryData(productsListQuery().queryKey, initial.products);
    queryClient.setQueryData(competitorsQuery(product).queryKey, initial.competitors);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CompareView />
    </HydrationBoundary>
  );
}
