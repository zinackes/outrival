import { DeleteWorkspaceCard } from "@/components/outrival/delete-workspace-card";
import { DeleteAccountCard } from "@/components/outrival/delete-account-card";
import { SettingsPageHead } from "@/components/dashboard/settings-page";

export default function DangerZonePage() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHead
        title="Delete workspace"
        description="Two irreversible actions: removing this workspace and everything monitored in it, or closing your account entirely."
        tone="critical"
      />

      <DeleteWorkspaceCard />
      <DeleteAccountCard />
    </div>
  );
}
