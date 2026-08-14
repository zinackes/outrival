import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import {
  WorkspaceSettingsForm,
  ProductProfileList,
} from "@/components/outrival/workspace-settings-form";
import { MonitoringDefaultsCard } from "@/components/outrival/monitoring-defaults-card";
import { ReferenceVolumesCard } from "@/components/outrival/reference-volumes-card";
import { BattleCardRefreshCard } from "@/components/outrival/battle-card-refresh-card";
import {
  SettingsPageHead,
  SettingsSection,
} from "@/components/dashboard/settings-page";
import { getWorkspaceSettingsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { workspaceSettingsQuery } from "@/lib/queries";

// OUT-38 — four sections at one heading rank, where this was five blocks split by
// bare `border-t` rules with sub-card headings at a rank nothing else used. Every
// control is unchanged: the source checklist and the volume list are both still
// editable, and they stay separate — one sets what gets scanned, the other the
// volume the price lens reads metered plans at.
export default async function GeneralSettingsPage() {
  // Best-effort server seed; null → the form's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getWorkspaceSettingsData();
  if (initial) queryClient.setQueryData(workspaceSettingsQuery().queryKey, initial);
  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHead
        title="General"
        description="Your workspace, the product we monitor, and what discovery compares against."
      />

      <HydrationBoundary state={dehydrate(queryClient)}>
        <SettingsSection
          title="Workspace"
          description="How this workspace is named and addressed, and the product we scan."
        >
          <div data-ph-mask>
            <WorkspaceSettingsForm />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Product profiles"
          description="What each product is, who it is for, what it promises. Open one to edit it."
          divider={false}
        >
          <div data-ph-mask>
            <ProductProfileList />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Monitoring defaults"
          description="What every competitor you add starts watching. Status pages, changelogs and App Store reviews are added on their own whenever we detect one."
        >
          <MonitoringDefaultsCard />
        </SettingsSection>

        <SettingsSection
          title="Battle cards"
          description="A card is written once and then frozen until someone reopens it. This is what keeps it following the competitor instead."
        >
          <BattleCardRefreshCard />
        </SettingsSection>

        <SettingsSection
          title="Reference volumes"
          description="What a usage-based competitor costs is only a number once you name a volume. Nothing is re-scanned when you change these."
        >
          <ReferenceVolumesCard />
        </SettingsSection>
      </HydrationBoundary>
    </div>
  );
}
