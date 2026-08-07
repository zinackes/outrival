import { KeyIcon } from "@/components/icons";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SettingsPageHead } from "@/components/dashboard/settings-page";

// patch-29 — placeholder. The public API is a Business-tier feature on the roadmap
// (Phase 11); the section exists so the structure is in place.
export default function ApiKeysSettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHead
        title="API keys"
        description="Programmatic access to your workspace."
      />

      <EmptyState
        icon={KeyIcon}
        title="API access is coming soon"
        description="A public REST API will let you pull signals and competitor data programmatically. It will be available on the Business plan."
      />
    </div>
  );
}
