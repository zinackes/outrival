import { IntegrationsSettings } from "@/components/outrival/integrations-settings";
import { getIntegrationsData } from "@/lib/api-server";

export default async function IntegrationsSettingsPage() {
  // Best-effort server prefetch; null falls back to the client fetches inside
  // the component.
  const initialData = await getIntegrationsData();
  return <IntegrationsSettings initialData={initialData} />;
}
