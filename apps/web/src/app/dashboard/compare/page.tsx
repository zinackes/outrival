import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { CompareView } from "@/components/dashboard/compare-view";
import { getCompareData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { productsListQuery, competitorsQuery } from "@/lib/queries";

export default async function ComparePage() {
  // Seed the picker inputs (products + competitors). Best-effort: null → the client
  // useQueries fetch on mount. The comparison matrix stays client-side (it tracks
  // the user's live selection).
  const queryClient = makeServerQueryClient();
  const initial = await getCompareData();
  if (initial) {
    queryClient.setQueryData(productsListQuery().queryKey, initial.products);
    queryClient.setQueryData(competitorsQuery().queryKey, initial.competitors);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CompareView />
    </HydrationBoundary>
  );
}
