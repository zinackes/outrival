"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { PLANS, PLAN_LABELS, PLAN_LIMITS, type Plan } from "@outrival/shared";
import { api, type NotificationSettings } from "@/lib/api";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FormSkeleton } from "@/components/dashboard/skeletons";
import { toastApiError } from "@/lib/error-helpers";
import { ListError } from "@/components/outrival/list-error";

function isEqual(a: NotificationSettings, b: NotificationSettings) {
  return (
    (a.slackWebhookUrl ?? "") === (b.slackWebhookUrl ?? "") &&
    (a.webhookUrl ?? "") === (b.webhookUrl ?? "") &&
    (a.digestEmail ?? "") === (b.digestEmail ?? "") &&
    a.digestEnabled === b.digestEnabled &&
    a.alertsEnabled === b.alertsEnabled
  );
}

export function NotificationSettingsForm({
  initialData = null,
}: {
  initialData?: { settings: NotificationSettings; plan: Plan } | null;
} = {}) {
  const [settings, setSettings] = useState<NotificationSettings | null>(
    initialData?.settings ?? null,
  );
  const [pristine, setPristine] = useState<NotificationSettings | null>(
    initialData?.settings ?? null,
  );
  const [plan, setPlan] = useState<Plan | null>(initialData?.plan ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  useEffect(() => {
    // Server-seeded first paint → skip the redundant client fetches.
    if (initialData) return;
    Promise.all([api.getNotificationSettings(), api.getBilling()])
      .then(([s, billing]) => {
        setSettings(s);
        setPristine(s);
        setPlan(billing.plan);
      })
      .catch((e) => setError(e));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      setPristine(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
      } else {
        toastApiError(e, { title: "Couldn't save settings" });
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (pristine) setSettings(pristine);
    setError(null);
  }

  if (error && !settings) return <ListError error={error} />;
  if (!settings || !pristine || !plan) return <FormSkeleton fields={2} />;

  const dirty = !isEqual(settings, pristine);
  const slackAllowed = PLAN_LIMITS[plan].allowedChannels.includes("slack");
  const slackMinPlan = PLANS.find((p) =>
    PLAN_LIMITS[p].allowedChannels.includes("slack"),
  );
  const webhookAllowed = PLAN_LIMITS[plan].allowedChannels.includes("webhook");
  const webhookMinPlan = PLANS.find((p) =>
    PLAN_LIMITS[p].allowedChannels.includes("webhook"),
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-xl">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slack-webhook" className="flex items-center gap-1.5">
          Slack webhook URL
          {!slackAllowed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex cursor-help"
                  aria-label="Locked — requires a higher plan"
                >
                  <Lock size={12} className="text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Available on the{" "}
                {slackMinPlan ? PLAN_LABELS[slackMinPlan] : "Starter"} plan and
                above
              </TooltipContent>
            </Tooltip>
          )}
        </Label>
        <Input
          id="slack-webhook"
          type="url"
          value={settings.slackWebhookUrl ?? ""}
          onChange={(e) =>
            setSettings({ ...settings, slackWebhookUrl: e.target.value })
          }
          placeholder="https://hooks.slack.com/services/..."
          disabled={!slackAllowed}
        />
        {slackAllowed ? (
          <p className="text-xs text-muted-foreground">
            High/critical alerts will be posted to this webhook.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Slack alerts are available on the{" "}
            {slackMinPlan ? PLAN_LABELS[slackMinPlan] : "Starter"} plan and
            above.{" "}
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() =>
                setPaywall({ code: "plan_locked_channel", channel: "slack", plan })
              }
            >
              Upgrade
            </button>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-url" className="flex items-center gap-1.5">
          Webhook URL
          {!webhookAllowed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex cursor-help"
                  aria-label="Locked — requires a higher plan"
                >
                  <Lock size={12} className="text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Available on the{" "}
                {webhookMinPlan ? PLAN_LABELS[webhookMinPlan] : "Pro"} plan and
                above
              </TooltipContent>
            </Tooltip>
          )}
        </Label>
        <Input
          id="webhook-url"
          type="url"
          value={settings.webhookUrl ?? ""}
          onChange={(e) =>
            setSettings({ ...settings, webhookUrl: e.target.value })
          }
          placeholder="https://your-endpoint.com/hooks/outrival"
          disabled={!webhookAllowed}
        />
        {webhookAllowed ? (
          <p className="text-xs text-muted-foreground">
            We POST a JSON payload on each high/critical signal.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            The webhook channel is available on the{" "}
            {webhookMinPlan ? PLAN_LABELS[webhookMinPlan] : "Pro"} plan and
            above.{" "}
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() =>
                setPaywall({
                  code: "plan_locked_channel",
                  channel: "webhook",
                  plan,
                })
              }
            >
              Upgrade
            </button>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="digest-email">Digest email</Label>
        <Input
          id="digest-email"
          type="email"
          value={settings.digestEmail ?? ""}
          onChange={(e) =>
            setSettings({ ...settings, digestEmail: e.target.value })
          }
          placeholder="you@company.com"
        />
        <p className="text-xs text-muted-foreground">
          Weekly digests are sent here every Monday at 8am UTC.
        </p>
      </div>

      <div className="flex flex-col gap-3 pt-1">
        <label className="flex items-center gap-3 text-sm cursor-pointer">
          <Checkbox
            checked={settings.digestEnabled}
            onCheckedChange={(c) =>
              setSettings({ ...settings, digestEnabled: c === true })
            }
          />
          Enable weekly digest
        </label>

        <label className="flex items-center gap-3 text-sm cursor-pointer">
          <Checkbox
            checked={settings.alertsEnabled}
            onCheckedChange={(c) =>
              setSettings({ ...settings, alertsEnabled: c === true })
            }
          />
          Enable real-time alerts (high/critical)
        </label>
      </div>

      {saved && !dirty && (
        <p className="flex items-center gap-1.5 text-sm text-positive">
          <Check className="size-4" /> Saved
        </p>
      )}

      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 px-4 py-2.5 rounded-md border border-border-strong bg-surface/95 backdrop-blur-sm shadow-lg">
          <span className="text-xs text-muted-foreground">
            You have unsaved changes.
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 size={12} className="animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}

      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
    </form>
  );
}
