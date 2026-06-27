import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

// patch-29 — two distinct delivery modes in tabs: individual real-time alerts
// (patch-26 moderation: channels by severity, quiet hours, cap, batching, threshold)
// and the recurring digest (delivery channels + schedule). Channel setup also lives
// in Integrations; here you pick how each mode reaches you.
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
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Notifications</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Two delivery modes: individual real-time alerts and the recurring digest.
        </p>
      </header>

      <HydrationBoundary state={dehydrate(queryClient)}>
        <Tabs defaultValue="alerts" className="flex flex-col gap-6">
          <TabsList>
            <TabsTrigger value="alerts">Individual alerts</TabsTrigger>
            <TabsTrigger value="digest">Recurring digest</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="mt-0">
            <NotificationModerationForm />
          </TabsContent>

          <TabsContent value="digest" className="mt-0 flex flex-col gap-5" data-ph-mask>
            <NotificationSettingsForm />
            <Link
              href="/dashboard/digests"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View past digests
              <ArrowRight size={12} />
            </Link>
          </TabsContent>
        </Tabs>
      </HydrationBoundary>
    </section>
  );
}
