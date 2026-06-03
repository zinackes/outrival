import { WorkspaceSettingsForm } from "@/components/outrival/workspace-settings-form";

export default function GeneralSettingsPage() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">General</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Workspace name, product URL, and the profile used for competitor
          discovery.
        </p>
      </header>
      <div data-ph-mask>
        <WorkspaceSettingsForm />
      </div>
    </section>
  );
}
