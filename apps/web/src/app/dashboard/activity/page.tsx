import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ActivityView } from "@/components/dashboard/activity-view";
import { getActivityData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { activityHealthQuery, activityTimelineQuery } from "@/lib/queries";

export default async function ActivityPage() {
  // Seed both queries: health (filter options) + the page-1 unfiltered timeline.
  // Best-effort: null → ActivityView's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getActivityData();
  if (initial) {
    queryClient.setQueryData(activityHealthQuery().queryKey, {
      sources: initial.sources,
      upcoming: initial.upcoming,
    });
    queryClient.setQueryData(activityTimelineQuery(1, {}).queryKey, {
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
