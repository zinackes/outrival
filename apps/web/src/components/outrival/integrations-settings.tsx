import { CrmDestinations } from "@/components/outrival/crm-destinations";
import { SettingsSection } from "@/components/dashboard/settings-page";

// Outbound-only surface: push your intel into a CRM / automation tool. The alert
// channels (Slack, email, webhook) that were here moved to Notifications, which
// is now the single home for how Outrival reaches you.
export function IntegrationsSettings() {
  return (
    <>
      <CrmDestinations />

      <SettingsSection
        title="Coming soon"
        description="Native HubSpot and Salesforce sync. Until then, add a CRM destination above to push into any of them via Zapier or Make."
      >
        <div className="rounded-lg border border-dashed border-border px-4 py-3.5 text-dense text-muted-foreground">
          Nothing to configure yet. We'll list the native connectors here as they ship.
        </div>
      </SettingsSection>
    </>
  );
}
