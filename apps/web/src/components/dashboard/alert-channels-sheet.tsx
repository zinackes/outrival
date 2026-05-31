"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  MessageSquare,
  Mail,
  Code,
  Loader2,
  Lock,
  ArrowRight,
} from "lucide-react";
import { PLAN_LIMITS, type Plan } from "@outrival/shared";
import { api, ApiError, type NotificationSettings } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

export type AlertChannel = "slack" | "email" | "webhook";

export function AlertChannelsSheet({
  open,
  channel,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  channel: AlertChannel;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [active, setActive] = useState<AlertChannel>(channel);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setActive(channel);
  }, [open, channel]);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setError(null);
    api
      .getNotificationSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
    api
      .getBilling()
      .then((b) => setPlan(b.plan))
      .catch(() => setPlan("free"));
  }, [open]);

  const channelAllowed = (ch: AlertChannel) =>
    plan ? PLAN_LIMITS[plan].allowedChannels.includes(ch) : false;

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api.updateNotificationSettings({
        slackWebhookUrl: settings.slackWebhookUrl || null,
        webhookUrl: settings.webhookUrl || null,
        digestEmail: settings.digestEmail || null,
        digestEnabled: settings.digestEnabled,
        alertsEnabled: settings.alertsEnabled,
      });
      setSaved(true);
      onSaved?.();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      const channel = e instanceof ApiError ? e.data.channel : undefined;
      setError(
        code === "plan_locked_channel"
          ? channel === "webhook"
            ? "The webhook channel requires the Pro plan or higher."
            : "Slack alerts require the Starter plan or higher."
          : String(e),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-0 flex flex-col sm:max-w-md">
        <SheetHeader className="px-5 py-4 border-b border-border">
          <SheetTitle className="tracking-tight text-[15px]">
            Alert channels
          </SheetTitle>
          <SheetDescription className="text-[13px]">
            Critical/high alerts sent in real-time to every connected channel.
          </SheetDescription>
        </SheetHeader>

        {settings && (
          <label className="flex items-start gap-3 px-5 py-3.5 border-b border-border text-sm cursor-pointer">
            <Checkbox
              checked={settings.alertsEnabled}
              onCheckedChange={(c) =>
                setSettings({ ...settings, alertsEnabled: c === true })
              }
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">
                Send high/critical alerts as they happen
              </span>
              <span className="block text-[11px] font-mono text-muted-foreground/80 mt-0.5">
                Master switch for every channel. Medium/low always go in the
                weekly digest.
              </span>
            </span>
          </label>
        )}

        <div className="px-5 pt-4">
          <Tabs
            value={active}
            onValueChange={(v) => setActive(v as AlertChannel)}
          >
            <TabsList>
              <TabsTrigger value="slack">
                <MessageSquare size={12} />
                Slack
              </TabsTrigger>
              <TabsTrigger value="email">
                <Mail size={12} />
                Email
              </TabsTrigger>
              <TabsTrigger value="webhook">
                <Code size={12} />
                Webhook
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-5">
          {(!settings || !plan) && !error && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-2.5 w-56" />
              </div>
              <Skeleton className="h-9 w-56" />
            </div>
          )}
          {error && !settings && (
            <p className="text-sm text-critical">Error: {error}</p>
          )}

          {settings && plan && active === "slack" && !channelAllowed("slack") && (
            <ChannelLocked channel="slack" />
          )}

          {settings && plan && active === "slack" && channelAllowed("slack") && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slack-webhook">Webhook URL</Label>
                <Input
                  id="slack-webhook"
                  type="url"
                  value={settings.slackWebhookUrl ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      slackWebhookUrl: e.target.value,
                    })
                  }
                  placeholder="https://hooks.slack.com/services/..."
                />
                <p className="text-[11px] font-mono text-muted-foreground/80">
                  Create an incoming webhook in Slack → paste the URL here.
                </p>
              </div>
            </div>
          )}

          {settings && plan && active === "email" && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="alert-email">Recipient email</Label>
                <Input
                  id="alert-email"
                  type="email"
                  value={settings.digestEmail ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, digestEmail: e.target.value })
                  }
                  placeholder="you@company.com"
                />
                <p className="text-[11px] font-mono text-muted-foreground/80">
                  Same address as the weekly digest.
                </p>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Email receives critical/high in real-time, and medium/low
                grouped in the weekly digest.
              </p>
            </div>
          )}

          {settings && plan && active === "webhook" && !channelAllowed("webhook") && (
            <ChannelLocked channel="webhook" />
          )}

          {settings && plan && active === "webhook" && channelAllowed("webhook") && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="alert-webhook">Endpoint URL</Label>
                <Input
                  id="alert-webhook"
                  type="url"
                  value={settings.webhookUrl ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, webhookUrl: e.target.value })
                  }
                  placeholder="https://your-endpoint.com/hooks/outrival"
                />
                <p className="text-[11px] font-mono text-muted-foreground/80">
                  We POST a JSON payload on each critical/high signal. Pro plan or
                  higher.
                </p>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Ideal to connect Linear, Jira, Notion or an internal endpoint.
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/settings" className="text-muted-foreground">
              All settings
              <ExternalLink size={11} />
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            {error && settings && (
              <span className="text-xs text-critical">{error}</span>
            )}
            {saved && <span className="text-xs text-primary">✓ Saved</span>}
            <Button
              size="sm"
              onClick={save}
              disabled={saving || !settings || !channelAllowed(active)}
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChannelLocked({ channel }: { channel: "slack" | "webhook" }) {
  const label = channel === "slack" ? "Slack" : "Webhook";
  const planName = channel === "slack" ? "Starter" : "Pro";
  return (
    <div className="flex flex-col items-center text-center gap-3 py-8">
      <div className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center">
        <Lock size={16} className="text-muted-foreground/70" />
      </div>
      <div>
        <div className="font-semibold text-[14px] tracking-tight">
          {label} alerts
        </div>
        <p className="text-[12px] text-muted-foreground mt-1 max-w-[280px]">
          Require the {planName} plan or higher.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/dashboard/settings/billing">
          Upgrade
          <ArrowRight size={12} />
        </Link>
      </Button>
    </div>
  );
}
