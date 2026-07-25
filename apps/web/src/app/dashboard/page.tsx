import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { OverviewView } from "@/components/dashboard/overview";
import { getOverviewData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import {
  overviewSignalsQuery,
  competitorsQuery,
  sectoralTeaserQuery,
  battleCardsQuery,
  onboardingChecklistQuery,
  activityHealthQuery,
  digestsQuery,
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
    queryClient.setQueryData(overviewSignalsQuery(product).queryKey, initial.signals);
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
    // Source health backs one rail stat plus the "next scan" line; digests back the
    // footer's weekly brief link. Both keys are tz-independent, so the server seed
    // and the client read land on the same entry.
    if (initial.health) {
      queryClient.setQueryData(activityHealthQuery(product).queryKey, initial.health);
    }
    if (initial.digests) {
      queryClient.setQueryData(digestsQuery().queryKey, initial.digests);
    }
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OverviewView />
    </HydrationBoundary>
  );
}
