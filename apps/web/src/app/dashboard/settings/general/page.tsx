import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { WorkspaceSettingsForm } from "@/components/outrival/workspace-settings-form";
import { getWorkspaceSettingsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { workspaceSettingsQuery } from "@/lib/queries";

export default async function GeneralSettingsPage() {
  // Best-effort server seed; null → the form's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getWorkspaceSettingsData();
  if (initial) queryClient.setQueryData(workspaceSettingsQuery().queryKey, initial);
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
        <HydrationBoundary state={dehydrate(queryClient)}>
          <WorkspaceSettingsForm />
        </HydrationBoundary>
      </div>
    </section>
  );
}
