import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { TrendsView } from "@/components/dashboard/trends-view";
import { getTrendsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { trendsSummaryQuery } from "@/lib/queries";

export default async function TrendsPage() {
  // Same default window as getTrendsData and the client's lastNDays(90), rounded to
  // the day → the seed key matches what TrendsView requests on first paint. Best-effort:
  // null → TrendsView's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const from = startOfDay(subDays(new Date(), 90));
  const to = endOfDay(new Date());
  const initial = await getTrendsData();
  if (initial) {
    queryClient.setQueryData(trendsSummaryQuery({ from, to }).queryKey, initial);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TrendsView />
    </HydrationBoundary>
  );
}
