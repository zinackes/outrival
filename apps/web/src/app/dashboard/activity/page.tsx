import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ActivityView } from "@/components/dashboard/activity-view";
import { getActivityData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { activityFeedQuery, activityHealthQuery } from "@/lib/queries";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // Seed the two queries the first paint needs: health (the source roster, which
  // also feeds the reading and the attention rows) and the log's first page, every
  // outcome — the shape the log opens on. The summary is deliberately NOT seeded —
  // its key carries the viewer's timezone offset, which the server would have to guess.
  // patch-28 — scope: URL ?product= override wins, else the persisted cookie.
  const { product: urlProduct } = await searchParams;
  const product = await resolveServerScope(urlProduct);
  const queryClient = makeServerQueryClient();
  const initial = await getActivityData(product);
  if (initial) {
    queryClient.setQueryData(activityHealthQuery(product).queryKey, {
      sources: initial.sources,
      upcoming: initial.upcoming,
    });
    queryClient.setQueryData(
      activityFeedQuery({ statuses: [] }, product).queryKey,
      {
        pages: [{ events: initial.events, total: initial.total }],
        pageParams: [0],
      },
    );
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ActivityView />
    </HydrationBoundary>
  );
}
