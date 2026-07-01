import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { OverviewView } from "@/components/dashboard/overview";
import { getOverviewData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import {
  signalsQuery,
  competitorsQuery,
  sectoralTeaserQuery,
  battleCardsQuery,
  onboardingChecklistQuery,
} from "@/lib/queries";

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // Seed the query cache on the server (best-effort, one aggregated cookie-forwarded
  // fetch) so data lands in the first paint. On failure the cache stays empty and
  // OverviewView's useQuery fetches client-side — never slower than before.
  // patch-28 — honour the active product scope so the seed matches what OverviewView
  // reads on mount: the URL ?product= override wins, else the persisted cookie scope.
  const { product: urlProduct } = await searchParams;
  const product = await resolveServerScope(urlProduct);
  const queryClient = makeServerQueryClient();
  const initial = await getOverviewData(product);
  if (initial) {
    queryClient.setQueryData(
      signalsQuery({ limit: 200, productId: product }).queryKey,
      initial.signals,
    );
    queryClient.setQueryData(competitorsQuery(product).queryKey, initial.competitors);
    // Secondary sections — seed only when present (a plan-gated/null teaser leaves
    // the cache empty so the client query fetches + renders its own gated state).
    if (initial.sectoral) {
      queryClient.setQueryData(sectoralTeaserQuery().queryKey, initial.sectoral);
    }
    if (initial.battleCards) {
      queryClient.setQueryData(battleCardsQuery().queryKey, initial.battleCards);
    }
    if (initial.checklist) {
      queryClient.setQueryData(onboardingChecklistQuery().queryKey, initial.checklist);
    }
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OverviewView />
    </HydrationBoundary>
  );
}
