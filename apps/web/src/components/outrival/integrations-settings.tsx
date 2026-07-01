import { CrmDestinations } from "@/components/outrival/crm-destinations";

// Outbound-only surface: push your intel into a CRM / automation tool. The alert
// channels (Slack, email, webhook) that were here moved to Notifications, which
// is now the single home for how Outrival reaches you.
export function IntegrationsSettings() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Integrations</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Push your intel outward — into your CRM or automation tools. Alert channels
          (Slack, email, webhook) live under Notifications.
        </p>
      </header>

      <CrmDestinations />

      <div className="rounded-lg border border-dashed border-border px-4 py-3.5">
        <div className="text-dense font-medium text-foreground">Coming soon</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Native HubSpot &amp; Salesforce sync — until then, add a CRM destination above
          to push into any of them via Zapier/Make.
        </div>
      </div>
    </section>
  );
}
