"use client";

import { useEffect, useState } from "react";
import { Code, MessageSquare } from "lucide-react";
import { api, type NotificationSettings } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListError } from "@/components/outrival/list-error";
import {
  AlertChannelsSheet,
  type AlertChannel,
} from "@/components/dashboard/alert-channels-sheet";
import { cn } from "@/lib/utils";

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function IntegrationsSettings() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [channel, setChannel] = useState<AlertChannel>("slack");

  function refresh() {
    api.getNotificationSettings().then(setSettings).catch((e) => setErr(e));
  }

  useEffect(() => {
    refresh();
  }, []);

  function openSheet(ch: AlertChannel) {
    setChannel(ch);
    setSheetOpen(true);
  }

  const slackUrl = settings?.slackWebhookUrl ?? null;
  const webhookUrl = settings?.webhookUrl ?? null;

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
          detail={webhookUrl ? truncate(webhookUrl.replace(/^https?:\/\//, ""), 32) : "Not configured"}
          onClick={() => openSheet("webhook")}
        />
      </Card>

      <div className="rounded-lg border border-dashed border-border px-4 py-3.5">
        <div className="text-[13px] font-medium text-foreground">Coming soon</div>
        <div className="text-[12px] text-muted-foreground/80 mt-0.5">
          HubSpot, Salesforce, Linear and more outbound integrations.
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
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
  detail: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md border",
          connected
            ? "border-positive/30 bg-positive/[0.08] text-positive"
            : "border-border bg-background text-muted-foreground/70",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <div className="truncate text-[11px] text-muted-foreground/80 font-mono">
          {detail}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onClick}>
        {connected ? "Manage" : "Connect"}
      </Button>
    </div>
  );
}
