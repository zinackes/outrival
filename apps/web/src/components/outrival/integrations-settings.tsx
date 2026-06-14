"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Code, Lock, MessageSquare } from "lucide-react";
import { PLANS, PLAN_LABELS, PLAN_LIMITS, type Plan } from "@outrival/shared";
import { api, type NotificationSettings } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListError } from "@/components/outrival/list-error";
import { CrmDestinations } from "@/components/outrival/crm-destinations";
import {
  AlertChannelsSheet,
  type AlertChannel,
} from "@/components/dashboard/alert-channels-sheet";
import { cn } from "@/lib/utils";

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function IntegrationsSettings({
  initialData = null,
}: {
  initialData?: { settings: NotificationSettings; plan: Plan } | null;
} = {}) {
  const [settings, setSettings] = useState<NotificationSettings | null>(
    initialData?.settings ?? null,
  );
  const [plan, setPlan] = useState<Plan | null>(initialData?.plan ?? null);
  const [err, setErr] = useState<unknown>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [channel, setChannel] = useState<AlertChannel>("slack");

  function refresh() {
    api.getNotificationSettings().then(setSettings).catch((e) => setErr(e));
  }

  useEffect(() => {
    // Server-seeded first paint → skip the redundant client fetches.
    if (initialData) return;
    refresh();
    api
      .getBilling()
      .then((b) => setPlan(b.plan))
      .catch(() => setPlan("free"));
  }, []);

  function openSheet(ch: AlertChannel) {
    setChannel(ch);
    setSheetOpen(true);
  }

  const slackUrl = settings?.slackWebhookUrl ?? null;
  const webhookUrl = settings?.webhookUrl ?? null;
  const webhookLocked =
    plan != null && !PLAN_LIMITS[plan].allowedChannels.includes("webhook");
  const webhookMinPlan = PLANS.find((p) =>
    PLAN_LIMITS[p].allowedChannels.includes("webhook"),
  );
  const webhookPlanLabel = webhookMinPlan ? PLAN_LABELS[webhookMinPlan] : "Pro";

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Integrations</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Outbound channels used by alerts and the digest. Notifications pick which
          channel to use; the technical setup lives here.
        </p>
      </header>

      {err ? <ListError error={err} /> : null}

      <AlertChannelsSheet
        open={sheetOpen}
        channel={channel}
        onOpenChange={setSheetOpen}
        onSaved={refresh}
      />

      <Card className="divide-y divide-border overflow-hidden">
        <IntegrationRow
          icon={<MessageSquare size={14} />}
          label="Slack"
          connected={Boolean(slackUrl)}
          detail={slackUrl ? truncate(slackUrl.replace(/^https?:\/\//, ""), 32) : "Not connected"}
          onClick={() => openSheet("slack")}
        />
        <IntegrationRow
          icon={<Code size={14} />}
          label="Webhook"
          connected={Boolean(webhookUrl)}
          detail={
            webhookLocked
              ? `Requires the ${webhookPlanLabel} plan`
              : webhookUrl
                ? truncate(webhookUrl.replace(/^https?:\/\//, ""), 32)
                : "Not configured"
          }
          locked={webhookLocked}
          onClick={() => openSheet("webhook")}
        />
      </Card>

      <CrmDestinations />

      <div className="rounded-lg border border-dashed border-border px-4 py-3.5">
        <div className="text-dense font-medium text-foreground">Coming soon</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Native HubSpot &amp; Salesforce sync — until then, the webhook above pushes to
          any of them via Zapier/Make.
        </div>
      </div>
    </section>
  );
}

function IntegrationRow({
  icon,
  label,
  connected,
  detail,
  onClick,
  locked = false,
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
  detail: string;
  onClick: () => void;
  locked?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3.5", locked && "opacity-75")}>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md border",
          connected && !locked
            ? "border-positive/30 bg-positive/[0.08] text-positive"
            : "border-border bg-background text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-dense font-medium text-foreground">
          {label}
          {locked && <Lock size={11} className="text-muted-foreground" />}
        </div>
        <div className="truncate text-meta text-muted-foreground font-mono">
          {detail}
        </div>
      </div>
      {locked ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/settings/billing">Upgrade</Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onClick}>
          {connected ? "Manage" : "Connect"}
        </Button>
      )}
    </div>
  );
}
