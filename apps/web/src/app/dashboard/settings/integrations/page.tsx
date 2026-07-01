import { IntegrationsSettings } from "@/components/outrival/integrations-settings";

// CRM destinations fetch client-side (own useQuery); no SSR seed needed.
export default function IntegrationsSettingsPage() {
  return <IntegrationsSettings />;
}
