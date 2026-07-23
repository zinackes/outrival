import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getCompetitorDetailData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { competitorDetailQuery } from "@/lib/queries";
import { BattleCardPageView } from "./battle-card-view";

export default async function CompetitorBattleCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Same server seed as the detail page, so arriving here from the header button
  // (or from a ?tab=battlecard notification) paints the competitor name instantly
  // and shares the already-warm detail cache.
  const queryClient = makeServerQueryClient();
  const initial = await getCompetitorDetailData(id);
  if (initial) queryClient.setQueryData(competitorDetailQuery(id).queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BattleCardPageView id={id} />
    </HydrationBoundary>
  );
}
