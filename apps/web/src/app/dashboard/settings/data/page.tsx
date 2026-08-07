import { DataSettings } from "@/components/outrival/data-settings";
import { SharedReportsSettings } from "@/components/outrival/shared-reports-settings";
import { SettingsPageHead } from "@/components/dashboard/settings-page";

// One title, three sections. Both components used to render their own `h2` head,
// so the route opened on two peers with nothing above them — the page read as two
// pages stacked. The head lives here; each component owns a section under it.
export default function DataSettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHead
        title="Data"
        description="Take your data out, share a read-only report, and see how long we keep history."
      />
      <DataSettings />
      <SharedReportsSettings />
    </div>
  );
}
