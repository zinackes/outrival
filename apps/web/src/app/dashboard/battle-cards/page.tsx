import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { BattleCardsView } from "./battle-cards-view";
import { getBattleCardsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { battleCardsQuery } from "@/lib/queries";

export default async function BattleCardsPage() {
  // Best-effort server seed; null → BattleCardsView's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getBattleCardsData();
  if (initial) queryClient.setQueryData(battleCardsQuery().queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BattleCardsView />
    </HydrationBoundary>
  );
}
