"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  Code,
  MessageSquare,
  Bell,
  Filter,
  Settings as SettingsIcon,
} from "lucide-react";
import { api, type NotificationSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PageHead } from "@/components/dashboard/page-head";
import {
  AlertChannelsSheet,
  type AlertChannel,
} from "@/components/dashboard/alert-channels-sheet";

export default function AlertsPage() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetChannel, setSheetChannel] = useState<AlertChannel>("slack");

  function refresh() {
    api
      .getNotificationSettings()
      .then(setSettings)
      .catch((e) => setErr(String(e)));
  }

  useEffect(() => {
    refresh();
  }, []);

  function openSheet(channel: AlertChannel) {
    setSheetChannel(channel);
    setSheetOpen(true);
  }

  const slackOk = Boolean(settings?.slackWebhookUrl) && (settings?.alertsEnabled ?? false);
  const emailOk = Boolean(settings?.digestEmail);
  const webhookOk = false;

  return (
    <div className="space-y-[22px]">
      <PageHead
        title="Alerts"
        sub="Critical/high sent in real-time · medium/low grouped in the weekly digest."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => openSheet("slack")}
          >
            <SettingsIcon size={12} /> Configure channels
          </Button>
        }
      />

      <AlertChannelsSheet
        open={sheetOpen}
        channel={sheetChannel}
        onOpenChange={setSheetOpen}
        onSaved={refresh}
      />

      {err && <p className="text-sm text-muted-foreground">Error: {err}</p>}

      <Card className="px-4 py-3 flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground/80 uppercase mr-2">
          Channels
        </span>
        <ChannelChip
          icon={<MessageSquare size={11} />}
          label="Slack"
          ok={slackOk}
          detail={
            settings?.slackWebhookUrl
              ? truncate(settings.slackWebhookUrl.replace(/^https?:\/\//, ""), 22)
              : undefined
          }
          onClick={() => openSheet("slack")}
        />
        <ChannelChip
          icon={<Mail size={11} />}
          label="Email"
          ok={emailOk}
          detail={settings?.digestEmail ?? undefined}
          onClick={() => openSheet("email")}
        />
        <ChannelChip
          icon={<Code size={11} />}
          label="Webhook"
          ok={webhookOk}
          comingSoon
          onClick={() => openSheet("webhook")}
        />
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground/80 font-mono">
          Thresholds: critical · high
        </span>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
          <div>
            <div className="font-semibold text-[13px] tracking-tight">
              History
            </div>
            <div className="text-muted-foreground/80 text-[11px] font-mono">
              Timeline of alerts sent on each channel.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Filtering will be available once history is populated"
          >
            <Filter size={11} /> Filter
          </Button>
        </div>
        <div className="px-6 py-14 text-center text-muted-foreground">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-background border border-border flex items-center justify-center">
            <Bell size={16} className="text-muted-foreground/60" />
          </div>
          <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
            No alerts sent yet
          </div>
          <div className="text-[13px] max-w-[400px] mx-auto mb-4">
            Once a channel is connected, critical and high alerts will appear
            here in chronological order.
          </div>
          {!slackOk && !emailOk && (
            <Button size="sm" onClick={() => openSheet("slack")}>
              <SettingsIcon size={11} /> Connect a channel
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function ChannelChip({
  icon,
  label,
  ok,
  detail,
  comingSoon,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  detail?: string;
  comingSoon?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] transition-colors",
        ok
          ? "border-positive/30 bg-positive/[0.06] text-foreground hover:bg-positive/[0.1]"
          : "border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "w-[7px] h-[7px] rounded-full inline-block",
          ok ? "bg-positive" : "bg-muted-foreground/40",
        )}
      />
      <span className={ok ? "text-foreground" : ""}>{icon}</span>
      <span className="font-medium">{label}</span>
      {detail && (
        <span className="font-mono text-[10px] text-muted-foreground/80 max-w-[180px] truncate">
          {detail}
        </span>
      )}
      {comingSoon && !ok && (
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
          soon
        </span>
      )}
    </button>
  );
}
