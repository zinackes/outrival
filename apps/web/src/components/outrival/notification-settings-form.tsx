"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SpinnerIcon, LockIcon, EnvelopeIcon } from "@/components/icons";
import { toast } from "@/lib/toast";
import { PLANS, PLAN_LABELS, PLAN_LIMITS, type Plan } from "@outrival/shared";
import { api, type NotificationSettings } from "@/lib/api";
import { notificationSettingsQuery, planQuery } from "@/lib/queries";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SettingRow } from "@/components/dashboard/settings-page";
import { SettingRowsSkeleton } from "@/components/dashboard/skeletons";
import { useSettingsSaveBar } from "@/components/dashboard/settings-save-bar";
import { toastApiError } from "@/lib/error-helpers";
import { SettingsError } from "@/components/outrival/list-error";

function isEqual(a: NotificationSettings, b: NotificationSettings) {
  return (
    (a.slackWebhookUrl ?? "") === (b.slackWebhookUrl ?? "") &&
    (a.webhookUrl ?? "") === (b.webhookUrl ?? "") &&
    (a.digestEmail ?? "") === (b.digestEmail ?? "") &&
    a.digestEnabled === b.digestEnabled &&
    a.alertsEnabled === b.alertsEnabled
  );
}

export function NotificationSettingsForm() {
  // Server-seeded on first paint (settings/notifications/page.tsx); shares the
  // notificationSettings + plan cache with the Integrations page. settings/pristine
  // lazy-init from the hydrated cache; a sync effect covers the non-seeded path.
  const settingsQ = useQuery(notificationSettingsQuery());
  const planQ = useQuery(planQuery());
  const [settings, setSettings] = useState<NotificationSettings | null>(
    () => settingsQ.data ?? null,
  );
  const [pristine, setPristine] = useState<NotificationSettings | null>(
    () => settingsQ.data ?? null,
  );
  const initializedRef = useRef(settingsQ.data != null);
  const plan = planQ.data ?? null;
  const [testing, setTesting] = useState(false);
  const error = settingsQ.error;
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  useEffect(() => {
    if (initializedRef.current || !settingsQ.data) return;
    initializedRef.current = true;
    setSettings(settingsQ.data);
    setPristine(settingsQ.data);
  }, [settingsQ.data]);

  const dirty = settings != null && pristine != null && !isEqual(settings, pristine);

  async function save() {
    if (!settings) return;
    try {
      await api.updateNotificationSettings({
        slackWebhookUrl: settings.slackWebhookUrl || null,
        webhookUrl: settings.webhookUrl || null,
        digestEmail: settings.digestEmail || null,
        digestEnabled: settings.digestEnabled,
        alertsEnabled: settings.alertsEnabled,
      });
      setPristine(settings);
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
      } else {
        toastApiError(e, { title: "Couldn't save settings" });
      }
      // Rethrow so the page's save bar stops before it claims "Saved" — the user
      // already has the toast or the paywall, so nothing more is surfaced.
      throw e;
    }
  }

  // The page owns the save bar; this section reports its state to it. Both forms
  // on this page used to render a sticky bar of their own, which stacked when
  // each was dirty, each saving half the page.
  useSettingsSaveBar({
    id: "notification-channels",
    label: "Delivery",
    dirty,
    save,
    reset: () => setSettings(pristine),
  });

  // Fires one message down every configured channel. One click gets one toast,
  // whichever way the three channels went. The provider's raw error is surfaced on
  // purpose: it is the only place a refused send (unverified sender domain, quota,
  // bad webhook) is readable from the product instead of the logs.
  async function handleTest() {
    setTesting(true);
    try {
      const { results, errors } = await api.sendTestAlert();
      const channels = ["email", "slack", "webhook"] as const;
      const attempted = channels.filter((ch) => results[ch] !== "not_configured");
      if (attempted.length === 0) {
        toast.info("Nothing to test yet — save a digest email or a webhook first.");
        return;
      }
      const sent = attempted.filter((ch) => results[ch] === "sent");
      const refused = attempted.filter((ch) => results[ch] !== "sent");
      if (refused.length === 0) {
        toast.success(`Test sent to ${sent.join(", ")}.`);
      } else {
        toast.error(`Test failed on ${refused.join(", ")}.`, {
          description: [
            ...refused.map((ch) => `${ch}: ${errors[ch] ?? "no reason given"}`),
            sent.length > 0 ? `Sent to ${sent.join(", ")}.` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
    } catch (e) {
      toastApiError(e, { title: "Couldn't send the test" });
    } finally {
      setTesting(false);
    }
  }

  if (error && !settings)
    return (
      <SettingsError
        title="Delivery settings didn't load"
        error={error}
        onRetry={() => void settingsQ.refetch()}
      />
    );
  if (!settings || !pristine || !plan) return <SettingRowsSkeleton rows={5} />;

  const slackAllowed = PLAN_LIMITS[plan].allowedChannels.includes("slack");
  const slackMinPlan = PLANS.find((p) =>
    PLAN_LIMITS[p].allowedChannels.includes("slack"),
  );
  const webhookAllowed = PLAN_LIMITS[plan].allowedChannels.includes("webhook");
  const webhookMinPlan = PLANS.find((p) =>
    PLAN_LIMITS[p].allowedChannels.includes("webhook"),
  );

  return (
    <div className="flex flex-col">
      <SettingRow
        htmlFor="digest-email"
        label="Email address"
        hint="Every briefing and alert is sent here. The weekly brief goes out Mondays at 8am UTC."
        control={
          <Input
            id="digest-email"
            type="email"
            value={settings.digestEmail ?? ""}
            onChange={(e) => setSettings({ ...settings, digestEmail: e.target.value })}
            placeholder="you@company.com"
            className="h-9 w-64 text-dense"
          />
        }
      />

      <SettingRow
        htmlFor="slack-webhook"
        label={
          <>
            Slack webhook
            {!slackAllowed && (
              <LockedBadge
                plan={slackMinPlan}
                onUpgrade={() =>
                  setPaywall({ code: "plan_locked_channel", channel: "slack", plan })
                }
              />
            )}
          </>
        }
        hint={
          slackAllowed
            ? "High and critical alerts are posted to this webhook."
            : `Slack alerts are on the ${slackMinPlan ? PLAN_LABELS[slackMinPlan] : "Starter"} plan and above.`
        }
        control={
          <Input
            id="slack-webhook"
            type="url"
            value={settings.slackWebhookUrl ?? ""}
            onChange={(e) =>
              setSettings({ ...settings, slackWebhookUrl: e.target.value })
            }
            placeholder="https://hooks.slack.com/services/…"
            disabled={!slackAllowed}
            className="h-9 w-64 font-mono text-xs"
          />
        }
      />

      <SettingRow
        htmlFor="webhook-url"
        label={
          <>
            Webhook URL
            {!webhookAllowed && (
              <LockedBadge
                plan={webhookMinPlan}
                onUpgrade={() =>
                  setPaywall({ code: "plan_locked_channel", channel: "webhook", plan })
                }
              />
            )}
          </>
        }
        hint={
          webhookAllowed
            ? "We POST a JSON payload on every high and critical signal."
            : `The webhook channel is on the ${webhookMinPlan ? PLAN_LABELS[webhookMinPlan] : "Pro"} plan and above.`
        }
        control={
          <Input
            id="webhook-url"
            type="url"
            value={settings.webhookUrl ?? ""}
            onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })}
            placeholder="https://your-endpoint.com/hooks/outrival"
            disabled={!webhookAllowed}
            className="h-9 w-64 font-mono text-xs"
          />
        }
      />

      {/* Switch, not Checkbox: these are two independent on/off states in a list of
          settings, where a checkbox reads as "selected in a set". */}
      <SettingRow
        label="Briefings"
        hint="The weekly brief and the daily briefing."
        control={
          <Switch
            checked={settings.digestEnabled}
            onCheckedChange={(c) => setSettings({ ...settings, digestEnabled: c })}
            aria-label="Briefings"
          />
        }
      />

      <SettingRow
        label="Real-time alerts"
        hint="High and critical signals, as they land."
        control={
          <Switch
            checked={settings.alertsEnabled}
            onCheckedChange={(c) => setSettings({ ...settings, alertsEnabled: c })}
            aria-label="Real-time alerts"
          />
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing}
        >
          {testing ? (
            <SpinnerIcon size={16} className="animate-spin" />
          ) : (
            <EnvelopeIcon size={16} />
          )}
          {testing ? "Sending…" : "Send a test"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Delivers one message to every saved channel. Save first — the test uses the
          stored settings, not what is on screen.
        </p>
      </div>

      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
    </div>
  );
}

function LockedBadge({
  plan,
  onUpgrade,
}: {
  plan: Plan | undefined;
  onUpgrade: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onUpgrade}
          className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LockIcon size={12} />
          {plan ? PLAN_LABELS[plan] : "Upgrade"}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Available on the {plan ? PLAN_LABELS[plan] : "next"} plan and above
      </TooltipContent>
    </Tooltip>
  );
}
