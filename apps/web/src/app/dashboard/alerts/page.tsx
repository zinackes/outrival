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
import { ListError } from "@/components/outrival/list-error";
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
  const [err, setErr] = useState<unknown>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetChannel, setSheetChannel] = useState<AlertChannel>("slack");

  function refresh() {
    api
      .getNotificationSettings()
      .then(setSettings)
      .catch((e) => setErr(e));
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

      {err ? <ListError error={err} /> : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="font-semibold text-[13px] tracking-tight">
              Channels
            </div>
            <div className="text-muted-foreground/80 text-[11px] font-mono">
              Where critical &amp; high alerts get delivered.
            </div>
          </div>
          <span className="hidden items-center rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70 sm:inline-flex">
            Thresholds: critical · high
          </span>
        </div>
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <ChannelCard
            icon={<MessageSquare size={13} />}
            label="Slack"
            ok={slackOk}
            detail={
              settings?.slackWebhookUrl
                ? truncate(
                    settings.slackWebhookUrl.replace(/^https?:\/\//, ""),
                    24,
                  )
                : undefined
            }
            onClick={() => openSheet("slack")}
          />
          <ChannelCard
            icon={<Mail size={13} />}
            label="Email"
            ok={emailOk}
            detail={settings?.digestEmail ?? undefined}
            onClick={() => openSheet("email")}
          />
          <ChannelCard
            icon={<Code size={13} />}
            label="Webhook"
            ok={webhookOk}
            comingSoon
            onClick={() => openSheet("webhook")}
          />
        </div>
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

function ChannelCard({
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
      className="group flex flex-col gap-2.5 px-4 py-3.5 text-left outline-none transition-colors hover:bg-accent/30 focus-visible:bg-accent/30"
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md border",
            ok
              ? "border-positive/30 bg-positive/[0.08] text-positive"
              : "border-border bg-background text-muted-foreground/70",
          )}
        >
          {icon}
        </span>
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {comingSoon && !ok ? (
          <span className="ml-auto font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
            soon
          </span>
        ) : ok ? (
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-positive">
            <span className="size-[7px] rounded-full bg-positive" />
            Connected
          </span>
        ) : (
          <span className="ml-auto size-[7px] rounded-full bg-muted-foreground/30" />
        )}
      </div>

      <div className="flex min-h-[18px] items-center justify-between gap-2">
        {ok && detail ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground/80">
            {detail}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">
            {comingSoon ? "Available soon" : "Not connected"}
          </span>
        )}
        {!comingSoon && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/0 transition-colors group-hover:text-foreground">
            Configure →
          </span>
        )}
      </div>
    </button>
  );
}
