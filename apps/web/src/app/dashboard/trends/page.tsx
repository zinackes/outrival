import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { TrendsView } from "@/components/dashboard/trends-view";
import { getTrendsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { trendsSummaryQuery } from "@/lib/queries";

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // Same default window as getTrendsData and the client's lastNDays(90), rounded to
  // the day → the seed key matches what TrendsView requests on first paint. Best-effort:
  // null → TrendsView's useQuery fetches client-side. patch-28 — URL ?product= override
  // wins, else the persisted cookie scope.
  const { product: urlProduct } = await searchParams;
  const product = await resolveServerScope(urlProduct);
  const queryClient = makeServerQueryClient();
  const from = startOfDay(subDays(new Date(), 90));
  const to = endOfDay(new Date());
  const initial = await getTrendsData(product);
  if (initial) {
    queryClient.setQueryData(trendsSummaryQuery({ from, to }, product).queryKey, initial);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TrendsView />
    </HydrationBoundary>
  );
}
