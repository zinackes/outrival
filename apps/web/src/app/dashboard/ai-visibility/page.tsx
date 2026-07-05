import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeServerQueryClient } from "@/lib/server-query";
import { getAiVisibilitySeed } from "@/lib/api-server";
import { resolveServerScope } from "@/lib/product-scope-server";
import { aiVisibilityQuery } from "@/lib/queries";
import { AiVisibilityView } from "@/components/dashboard/ai-visibility-view";

// AI Visibility / "Share of Model" (docs/ai-visibility.md). patch-28: scoped to the
// active product (URL ?product= override wins, else the persisted cookie), so the seed
// key matches what the view requests. The seed also reports the plan-locked 403 (`locked`)
// so the view renders the upsell immediately — no client round-trip / skeleton flash for
// the free/starter majority.
export default async function AiVisibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product: urlProduct } = await searchParams;
  const product = await resolveServerScope(urlProduct);
  const queryClient = makeServerQueryClient();
  const { locked, data } = await getAiVisibilitySeed(product);
  if (data) queryClient.setQueryData(aiVisibilityQuery(product).queryKey, data);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AiVisibilityView locked={locked} />
    </HydrationBoundary>
  );
}
