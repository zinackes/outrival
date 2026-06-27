import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { CompetitorDetailView } from "./competitor-detail-view";
import { getCompetitorDetailData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { competitorDetailQuery } from "@/lib/queries";

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Best-effort server seed; null → the detail view's useQuery fetches client-side
  // (it also drives polling + in-progress scrape tracking).
  const queryClient = makeServerQueryClient();
  const initial = await getCompetitorDetailData(id);
  if (initial) queryClient.setQueryData(competitorDetailQuery(id).queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CompetitorDetailView id={id} />
    </HydrationBoundary>
  );
}
