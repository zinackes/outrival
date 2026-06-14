"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  api,
  type ChannelMode,
  type NotificationPreferences,
  type RelevanceThresholdInfo,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSkeleton } from "@/components/dashboard/skeletons";
import { toastApiError } from "@/lib/error-helpers";
import { ListError } from "@/components/outrival/list-error";

const CHANNEL_OPTIONS: { value: ChannelMode; label: string }[] = [
  { value: "email_immediate", label: "Email — immediate" },
  { value: "digest_daily", label: "Daily digest" },
  { value: "digest_weekly", label: "Weekly digest" },
  { value: "in_app_only", label: "In-app only" },
  { value: "muted", label: "Muted" },
];

const SEVERITY_ROWS: {
  key: "channelCritical" | "channelHigh" | "channelMedium" | "channelLow";
  label: string;
  hint?: string;
}[] = [
  { key: "channelCritical", label: "Critical", hint: "Always delivered — bypasses every filter." },
  { key: "channelHigh", label: "High" },
  { key: "channelMedium", label: "Medium" },
  { key: "channelLow", label: "Low" },
];

const THRESHOLD_SOURCE_LABEL: Record<RelevanceThresholdInfo["source"], string> = {
  default: "Default",
  auto_adjusted: "Auto-adjusted from your feedback",
  user_set: "Manually set",
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function isEqual(a: NotificationPreferences, b: NotificationPreferences): boolean {
  return (
    a.channelCritical === b.channelCritical &&
    a.channelHigh === b.channelHigh &&
    a.channelMedium === b.channelMedium &&
    a.channelLow === b.channelLow &&
    a.timezone === b.timezone &&
    a.quietHoursStart === b.quietHoursStart &&
    a.quietHoursEnd === b.quietHoursEnd &&
    a.weekendOff === b.weekendOff &&
    a.dailyEmailCap === b.dailyEmailCap &&
    a.batchingEnabled === b.batchingEnabled
  );
}

export function NotificationModerationForm({
  initialData = null,
}: {
  initialData?: {
    preferences: NotificationPreferences;
    threshold: RelevanceThresholdInfo;
  } | null;
} = {}) {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(
    initialData?.preferences ?? null,
  );
  const [pristine, setPristine] = useState<NotificationPreferences | null>(
    initialData?.preferences ?? null,
  );
  const [threshold, setThreshold] = useState<RelevanceThresholdInfo | null>(
    initialData?.threshold ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    // Server-seeded first paint → skip the redundant client fetches.
    if (initialData) return;
    Promise.all([api.getNotificationPreferences(), api.getRelevanceThreshold()])
      .then(([p, t]) => {
        setPrefs(p.preferences);
        setPristine(p.preferences);
        setThreshold(t);
      })
      .catch((e) => setError(e));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    setSaving(true);
    setSaved(false);
    try {
      // timezone goes out without timezoneDetectedAt → the API marks it a manual
      // override (locks it against future auto-detection).
      const { preferences } = await api.updateNotificationPreferences({
        channelCritical: prefs.channelCritical,
        channelHigh: prefs.channelHigh,
        channelMedium: prefs.channelMedium,
        channelLow: prefs.channelLow,
        timezone: prefs.timezone,
        quietHoursStart: prefs.quietHoursStart,
        quietHoursEnd: prefs.quietHoursEnd,
        weekendOff: prefs.weekendOff,
        dailyEmailCap: prefs.dailyEmailCap,
        batchingEnabled: prefs.batchingEnabled,
      });
      setPrefs(preferences);
      setPristine(preferences);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      toastApiError(err, { title: "Couldn't save preferences" });
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (pristine) setPrefs(pristine);
  }

  if (error && !prefs) return <ListError error={error} />;
  if (!prefs || !pristine) return <FormSkeleton fields={3} />;

  const dirty = !isEqual(prefs, pristine);
  const tzAuto = pristine.timezoneDetectedAt !== null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-xl">
      {/* Channels per severity */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium mb-1">Channels by priority</legend>
        <p className="text-xs text-muted-foreground -mt-1">
          How each severity reaches you. Critical always comes through immediately.
        </p>
        {SEVERITY_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <Label className="text-sm">{row.label}</Label>
              {row.hint && (
                <span className="text-xs text-muted-foreground">{row.hint}</span>
              )}
            </div>
            <Select
              value={prefs[row.key]}
              onValueChange={(v) => setPrefs({ ...prefs, [row.key]: v as ChannelMode })}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </fieldset>

      {/* Quiet hours */}
      <fieldset className="flex flex-col gap-3 pt-4 border-t border-border">
        <legend className="text-sm font-medium mb-1">Quiet hours</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tz">
            Timezone{" "}
            <span className="text-xs text-muted-foreground">
              ({tzAuto ? "auto-detected" : "set manually"})
            </span>
          </Label>
          <Input
            id="tz"
            value={prefs.timezone}
            onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
            placeholder="Europe/Paris"
          />
          <p className="text-xs text-muted-foreground">
            Editing this locks it as a manual choice.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Select
              value={String(prefs.quietHoursStart)}
              onValueChange={(v) => setPrefs({ ...prefs, quietHoursStart: Number(v) })}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {fmtHour(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Select
              value={String(prefs.quietHoursEnd)}
              onValueChange={(v) => setPrefs({ ...prefs, quietHoursEnd: Number(v) })}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {fmtHour(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm cursor-pointer">
          <Checkbox
            checked={prefs.weekendOff}
            onCheckedChange={(c) => setPrefs({ ...prefs, weekendOff: c === true })}
          />
          No notifications on weekends
        </label>
        <p className="text-xs text-muted-foreground">
          Quiet hours only hold back immediate emails — in-app updates stay current,
          and critical alerts always come through.
        </p>
      </fieldset>

      {/* Frequency cap */}
      <fieldset className="flex flex-col gap-1.5 pt-4 border-t border-border">
        <legend className="text-sm font-medium mb-1">Limit</legend>
        <Label htmlFor="cap">Maximum emails per day</Label>
        <Input
          id="cap"
          type="number"
          min={1}
          max={100}
          value={prefs.dailyEmailCap}
          onChange={(e) =>
            setPrefs({ ...prefs, dailyEmailCap: Number(e.target.value) || 1 })
          }
          className="w-28"
        />
        <p className="text-xs text-muted-foreground">
          Beyond this, extra emails are rolled into the daily digest. Critical alerts
          always come through.
        </p>
      </fieldset>

      {/* Batching */}
      <fieldset className="flex flex-col gap-2 pt-4 border-t border-border">
        <legend className="text-sm font-medium mb-1">Grouping</legend>
        <label className="flex items-center gap-3 text-sm cursor-pointer">
          <Checkbox
            checked={prefs.batchingEnabled}
            onCheckedChange={(c) => setPrefs({ ...prefs, batchingEnabled: c === true })}
          />
          Group similar signals (recommended)
        </label>
        <p className="text-xs text-muted-foreground">
          Several minor changes from the same competitor are summarised into one item.
        </p>
      </fieldset>

      {/* Relevance threshold (read-only) */}
      {threshold && (
        <div className="flex flex-col gap-1 pt-4 border-t border-border">
          <span className="text-sm font-medium">Relevance threshold</span>
          <p className="text-sm text-muted-foreground">
            Current: <span className="text-foreground">{threshold.threshold.toFixed(2)}</span>{" "}
            — {THRESHOLD_SOURCE_LABEL[threshold.source]}
          </p>
          <p className="text-xs text-muted-foreground">
            Signals below this score are kept out of your emails. It adapts to your
            feedback over time.
          </p>
        </div>
      )}

      {saved && !dirty && (
        <p className="flex items-center gap-1.5 text-sm text-positive">
          <Check className="size-4" /> Saved
        </p>
      )}

      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 px-4 py-2.5 rounded-md border border-border-strong bg-surface/95 backdrop-blur-sm shadow-lg">
          <span className="text-xs text-muted-foreground">You have unsaved changes.</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 size={12} className="animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
