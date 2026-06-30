import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeServerQueryClient } from "@/lib/server-query";
import { getAiVisibilityData } from "@/lib/api-server";
import { aiVisibilityQuery } from "@/lib/queries";
import { AiVisibilityView } from "@/components/dashboard/ai-visibility-view";

// AI Visibility / "Share of Model" (docs/ai-visibility.md). Org-level (no product
// scope). Seed best-effort; on a locked plan getAiVisibilityData returns null and the
// client query surfaces the 403 → the view renders the upsell.
export default async function AiVisibilityPage() {
  const queryClient = makeServerQueryClient();
  const initial = await getAiVisibilityData();
  if (initial) queryClient.setQueryData(aiVisibilityQuery().queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AiVisibilityView />
    </HydrationBoundary>
  );
}
