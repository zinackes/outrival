import { IntegrationsSettings } from "@/components/outrival/integrations-settings";
import { SettingsPageHead } from "@/components/dashboard/settings-page";

// CRM destinations fetch client-side (own useQuery); no SSR seed needed.
// The head lives here, like every other settings route: the component owns its
// sections, the page owns the one title above them.
export default function IntegrationsSettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHead
        title="Integrations"
        description="Push your intel outward, into your CRM or automation tools. Alert channels (Slack, email, webhook) live under Notifications."
      />
      <IntegrationsSettings />
    </div>
  );
}
