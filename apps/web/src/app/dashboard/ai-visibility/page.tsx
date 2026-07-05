import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeServerQueryClient } from "@/lib/server-query";
import { getAiVisibilityData } from "@/lib/api-server";
import { resolveServerScope } from "@/lib/product-scope-server";
import { aiVisibilityQuery } from "@/lib/queries";
import { AiVisibilityView } from "@/components/dashboard/ai-visibility-view";

// AI Visibility / "Share of Model" (docs/ai-visibility.md). patch-28: scoped to the
// active product (URL ?product= override wins, else the persisted cookie), so the seed
// key matches what the view requests. Seed best-effort; on a locked plan
// getAiVisibilityData returns null and the client query surfaces the 403 → upsell.
export default async function AiVisibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product: urlProduct } = await searchParams;
  const product = await resolveServerScope(urlProduct);
  const queryClient = makeServerQueryClient();
  const initial = await getAiVisibilityData(product);
  if (initial) queryClient.setQueryData(aiVisibilityQuery(product).queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AiVisibilityView />
    </HydrationBoundary>
  );
}
