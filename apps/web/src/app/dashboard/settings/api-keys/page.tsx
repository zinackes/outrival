import { Key } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";

// patch-29 — placeholder. The public API is a Business-tier feature on the roadmap
// (Phase 11); the section exists so the structure is in place.
export default function ApiKeysSettingsPage() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">API keys</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Programmatic access to your workspace.
        </p>
      </header>

      <EmptyState
        icon={Key}
        title="API access is coming soon"
        description="A public REST API will let you pull signals and competitor data programmatically. It will be available on the Business plan."
      />
    </section>
  );
}
