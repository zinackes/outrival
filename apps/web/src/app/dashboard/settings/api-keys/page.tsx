import { Card } from "@/components/ui/card";
import { Key } from "lucide-react";

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

      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <Key size={16} />
        </span>
        <div className="font-semibold text-base text-foreground tracking-tight">
          API access is coming soon
        </div>
        <div className="text-sm text-muted-foreground max-w-[380px]">
          A public REST API will let you pull signals and competitor data
          programmatically. It will be available on the Business plan.
        </div>
      </Card>
    </section>
  );
}
