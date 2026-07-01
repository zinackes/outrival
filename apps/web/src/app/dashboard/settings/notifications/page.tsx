import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { NotificationSettingsForm } from "@/components/outrival/notification-settings-form";
import { NotificationModerationForm } from "@/components/outrival/notification-moderation-form";
import { getNotificationsPageData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import {
  notificationPreferencesQuery,
  relevanceThresholdQuery,
  notificationSettingsQuery,
  planQuery,
} from "@/lib/queries";

// One home for everything notification-related, in two stacked sections:
// Channels (the endpoints alerts + the digest are delivered to) and Alert
// routing (patch-26 moderation: severity → channel, quiet hours, cap, batching,
// threshold). The outbound CRM/webhook destinations live in Integrations.
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
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Notifications</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Where alerts and briefings are delivered, and how each severity reaches you.
        </p>
      </header>

      <HydrationBoundary state={dehydrate(queryClient)}>
        {/* Channels & delivery — the endpoints alerts and the digest are sent to */}
        <div className="flex flex-col gap-4" data-ph-mask>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Channels</h3>
            <p className="text-muted-foreground text-xs mt-0.5">
              Where alerts and your briefings are delivered.
            </p>
          </div>
          <NotificationSettingsForm />
          <Link
            href="/dashboard/digests"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View past digests
            <ArrowRight size={12} />
          </Link>
        </div>

        {/* Alert routing — patch-26 moderation */}
        <div className="flex flex-col gap-4 pt-6 border-t border-border">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Alert routing</h3>
            <p className="text-muted-foreground text-xs mt-0.5">
              Which severity reaches you, when, and how often.
            </p>
          </div>
          <NotificationModerationForm />
        </div>
      </HydrationBoundary>
    </section>
  );
}
