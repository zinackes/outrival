import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getCompetitorDetailData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { competitorDetailQuery } from "@/lib/queries";
import { SourcesView } from "./sources-view";

export default async function CompetitorSourcesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Same detail query the competitor page uses, so arriving here from the header
  // button paints instantly off the already-warm cache and every mutation writes
  // through to one shared copy of the monitors.
  const queryClient = makeServerQueryClient();
  const initial = await getCompetitorDetailData(id);
  if (initial) queryClient.setQueryData(competitorDetailQuery(id).queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SourcesView id={id} />
    </HydrationBoundary>
  );
}
