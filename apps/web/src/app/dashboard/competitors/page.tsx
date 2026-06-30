import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { CompetitorsList } from "@/components/dashboard/competitors-list";
import { getCompetitorsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { competitorsQuery } from "@/lib/queries";

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // Best-effort server seed; null → CompetitorsList's useQuery fetches client-side
  // (it also keeps polling every 30s regardless). patch-28 — honour the product scope:
  // URL ?product= override wins, else the persisted cookie scope.
  const { product: urlProduct } = await searchParams;
  const product = await resolveServerScope(urlProduct);
  const queryClient = makeServerQueryClient();
  const initial = await getCompetitorsData(product);
  if (initial) queryClient.setQueryData(competitorsQuery(product).queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CompetitorsList />
    </HydrationBoundary>
  );
}
