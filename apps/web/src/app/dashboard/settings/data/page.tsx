import { DataSettings } from "@/components/outrival/data-settings";
import { SharedReportsSettings } from "@/components/outrival/shared-reports-settings";

export default function DataSettingsPage() {
  return (
    <div className="flex flex-col gap-10">
      <DataSettings />
      <SharedReportsSettings />
    </div>
  );
}
