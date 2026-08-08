import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { NotificationSettingsForm } from "@/components/outrival/notification-settings-form";
import { NotificationModerationForm } from "@/components/outrival/notification-moderation-form";
import {
  SettingsPageHead,
  SettingsSection,
} from "@/components/dashboard/settings-page";
import { getNotificationsPageData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import {
  notificationPreferencesQuery,
  relevanceThresholdQuery,
  notificationSettingsQuery,
  planQuery,
} from "@/lib/queries";

// One home for everything notification-related, in four sections: Delivery (the
// endpoints), Routing by severity, Quiet hours, and Volume. The outbound
// CRM/webhook destinations live in Integrations.
//
// OUT-38 — the two forms each rendered their own sticky save bar, which stacked
// at the bottom of the viewport when both were dirty, each saving half the page.
// They now register with the page-level bar in the settings layout.
export default async function NotificationSettingsPage() {
  // Seed both forms' queries. Best-effort: null → the forms' useQueries fetch.
  const queryClient = makeServerQueryClient();
  const initial = await getNotificationsPageData();
  if (initial?.moderation) {
    queryClient.setQueryData(
      notificationPreferencesQuery().queryKey,
      initial.moderation.preferences,
    );
    queryClient.setQueryData(
      relevanceThresholdQuery().queryKey,
      initial.moderation.threshold,
    );
  }
  if (initial?.digest) {
    queryClient.setQueryData(notificationSettingsQuery().queryKey, initial.digest.settings);
    queryClient.setQueryData(planQuery().queryKey, initial.digest.plan);
  }
  return (
    <div className="flex flex-col gap-8" data-ph-mask>
      <SettingsPageHead
        title="Notifications"
        description="Where alerts and briefings reach you, and which ones get through."
      />

      <HydrationBoundary state={dehydrate(queryClient)}>
        <SettingsSection
          title="Delivery"
          description="The endpoints alerts and your briefings are sent to."
        >
          <NotificationSettingsForm />
          <Link
            href="/dashboard/digests"
            className="mt-1 inline-flex items-center gap-1.5 self-start rounded-sm text-dense text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View past digests
            <ArrowRightIcon size={14} />
          </Link>
        </SettingsSection>

        {/* Renders its own three sections (routing, quiet hours, volume) so each
            carries the page's heading rank rather than a nested legend. */}
        <NotificationModerationForm />
      </HydrationBoundary>
    </div>
  );
}
