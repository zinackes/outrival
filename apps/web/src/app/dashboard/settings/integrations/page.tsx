import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { IntegrationsSettings } from "@/components/outrival/integrations-settings";
import { getIntegrationsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { notificationSettingsQuery, planQuery } from "@/lib/queries";

export default async function IntegrationsSettingsPage() {
  // Seed the notification settings + the plan. Best-effort: null → client fetches.
  const queryClient = makeServerQueryClient();
  const initial = await getIntegrationsData();
  if (initial) {
    queryClient.setQueryData(notificationSettingsQuery().queryKey, initial.settings);
    queryClient.setQueryData(planQuery().queryKey, initial.plan);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <IntegrationsSettings />
    </HydrationBoundary>
  );
}
