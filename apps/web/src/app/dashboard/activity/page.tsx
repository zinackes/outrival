import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ActivityView } from "@/components/dashboard/activity-view";
import { getActivityData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { activityHealthQuery, activityTimelineQuery } from "@/lib/queries";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // Seed both queries: health (filter options) + the page-1 unfiltered timeline.
  // Best-effort: null → ActivityView's useQuery fetches client-side. patch-28 — scope:
  // URL ?product= override wins, else the persisted cookie scope.
  const { product: urlProduct } = await searchParams;
  const product = await resolveServerScope(urlProduct);
  const queryClient = makeServerQueryClient();
  const initial = await getActivityData(product);
  if (initial) {
    queryClient.setQueryData(activityHealthQuery(product).queryKey, {
      sources: initial.sources,
      upcoming: initial.upcoming,
    });
    queryClient.setQueryData(activityTimelineQuery(1, {}, product).queryKey, {
      events: initial.events,
      total: initial.total,
    });
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ActivityView />
    </HydrationBoundary>
  );
}
