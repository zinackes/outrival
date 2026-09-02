"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  type ChannelMode,
  type NotificationPreferences,
  type RelevanceThresholdInfo,
} from "@/lib/api";
import {
  notificationPreferencesQuery,
  relevanceThresholdQuery,
} from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SettingRow,
  SettingsSection,
} from "@/components/dashboard/settings-page";
import { SettingRowsSkeleton } from "@/components/dashboard/skeletons";
import { useSettingsSaveBar } from "@/components/dashboard/settings-save-bar";
import { toastApiError } from "@/lib/error-helpers";
import { SettingsError } from "@/components/outrival/list-error";

const CHANNEL_OPTIONS: { value: ChannelMode; label: string }[] = [
  { value: "email_immediate", label: "Email (immediate)" },
  { value: "digest_daily", label: "Daily briefing" },
  { value: "digest_weekly", label: "Weekly briefing" },
  { value: "in_app_only", label: "In-app only" },
  { value: "muted", label: "Muted" },
];

const SEVERITY_ROWS: {
  key: "channelCritical" | "channelHigh" | "channelMedium" | "channelLow";
  label: string;
  hint?: string;
}[] = [
  {
    key: "channelCritical",
    label: "Critical",
    hint: "Always delivered. Bypasses quiet hours, the daily cap and the relevance floor.",
  },
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

/**
 * Routing, quiet hours and volume — the three sections below Delivery.
 *
 * It renders the sections itself rather than returning one blob, so each carries
 * the page's section heading instead of the form inventing `<legend>`s at a rank
 * nothing else on the page uses. The old "Briefing cadence" legend also named the
 * wrong thing: it sets immediate emails too, so it is routing, not a cadence.
 */
export function NotificationModerationForm() {
  // Server-seeded on first paint (settings/notifications/page.tsx). prefs/pristine
  // lazy-init from the hydrated cache; a sync effect fills them in for the
  // non-seeded path. threshold is read-only display.
  const prefsQ = useQuery(notificationPreferencesQuery());
  const thresholdQ = useQuery(relevanceThresholdQuery());
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(
    () => prefsQ.data ?? null,
  );
  const [pristine, setPristine] = useState<NotificationPreferences | null>(
    () => prefsQ.data ?? null,
  );
  const initializedRef = useRef(prefsQ.data != null);
  const threshold = thresholdQ.data ?? null;
  const error = prefsQ.error;

  useEffect(() => {
    if (initializedRef.current || !prefsQ.data) return;
    initializedRef.current = true;
    setPrefs(prefsQ.data);
    setPristine(prefsQ.data);
  }, [prefsQ.data]);

  const dirty = prefs != null && pristine != null && !isEqual(prefs, pristine);

  async function save() {
    if (!prefs) return;
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
    } catch (err) {
      toastApiError(err, { title: "Couldn't save preferences" });
      // Rethrow so the page's bar stops before claiming "Saved"; the toast above
      // is the user-facing surface.
      throw err;
    }
  }

  useSettingsSaveBar({
    id: "notification-routing",
    label: "Routing and delivery rules",
    dirty,
    save,
    reset: () => setPrefs(pristine),
  });

  if (error && !prefs)
    return (
      <SettingsError
        title="Routing settings didn't load"
        error={error}
        onRetry={() => void prefsQ.refetch()}
      />
    );
  if (!prefs || !pristine) return <SettingRowsSkeleton rows={4} />;

  const tzAuto = pristine.timezoneDetectedAt !== null;

  return (
    <>
      <SettingsSection
        title="Routing by severity"
        description="How each severity reaches you: in a briefing, as an immediate email, or in-app only."
      >
        <div className="flex flex-col">
          {SEVERITY_ROWS.map((row) => (
            <SettingRow
              key={row.key}
              label={row.label}
              hint={row.hint}
              control={
                <Select
                  value={prefs[row.key]}
                  onValueChange={(v) =>
                    setPrefs({ ...prefs, [row.key]: v as ChannelMode })
                  }
                >
                  <SelectTrigger size="sm" className="w-48" aria-label={row.label}>
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
              }
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Quiet hours"
        description="When immediate emails are held back. In-app updates stay current, and critical alerts always come through."
      >
        <div className="flex flex-col">
          <SettingRow
            htmlFor="tz"
            label={
              <>
                Timezone
                <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                  {tzAuto ? "Auto-detected" : "Set manually"}
                </span>
              </>
            }
            hint="Editing this locks it as a manual choice."
            control={
              <Input
                id="tz"
                value={prefs.timezone}
                onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
                placeholder="Europe/Paris"
                className="h-9 w-48 text-dense"
              />
            }
          />

          <SettingRow
            label="Hold emails between"
            control={
              <>
                <Select
                  value={String(prefs.quietHoursStart)}
                  onValueChange={(v) =>
                    setPrefs({ ...prefs, quietHoursStart: Number(v) })
                  }
                >
                  <SelectTrigger size="sm" className="w-24" aria-label="Quiet hours start">
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
                <span className="text-dense text-muted-foreground">and</span>
                <Select
                  value={String(prefs.quietHoursEnd)}
                  onValueChange={(v) => setPrefs({ ...prefs, quietHoursEnd: Number(v) })}
                >
                  <SelectTrigger size="sm" className="w-24" aria-label="Quiet hours end">
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
              </>
            }
          />

          <SettingRow
            label="Weekends off"
            hint="Nothing is sent on Saturday or Sunday."
            control={
              <Switch
                checked={prefs.weekendOff}
                onCheckedChange={(c) => setPrefs({ ...prefs, weekendOff: c })}
                aria-label="Weekends off"
              />
            }
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Volume"
        description="How much reaches you, and how it is grouped."
      >
        <div className="flex flex-col">
          <SettingRow
            htmlFor="cap"
            label="Maximum emails per day"
            hint="Beyond this, extra emails roll into the daily briefing. Critical alerts always come through."
            control={
              <Input
                id="cap"
                type="number"
                min={1}
                max={100}
                value={prefs.dailyEmailCap}
                onChange={(e) =>
                  setPrefs({ ...prefs, dailyEmailCap: Number(e.target.value) || 1 })
                }
                className="h-9 w-24 tabular-nums text-dense"
              />
            }
          />

          <SettingRow
            label={
              <>
                Group similar signals
                <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                  Recommended
                </span>
              </>
            }
            hint="Several minor changes from one competitor become a single item."
            control={
              <Switch
                checked={prefs.batchingEnabled}
                onCheckedChange={(c) => setPrefs({ ...prefs, batchingEnabled: c })}
                aria-label="Group similar signals"
              />
            }
          />

          {/* Read-only: the threshold is the visible half of the feedback loop
              (Lever 10) — rating signals is an investment, so it is shown paying
              off rather than tuning silently. */}
          {threshold && (
            <SettingRow
              label={
                <>
                  Relevance floor
                  <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                    {THRESHOLD_SOURCE_LABEL[threshold.source]}
                  </span>
                </>
              }
              hint={
                <>
                  Signals scoring under this stay out of your emails.{" "}
                  {threshold.feedback && threshold.feedback.total > 0
                    ? `Outrival tunes it from your ratings: ${threshold.feedback.useful} of ${threshold.feedback.total} rated signal${threshold.feedback.total > 1 ? "s" : ""} marked useful.`
                    : "Rate signals as useful or not and Outrival tunes it from there."}
                  {threshold.source !== "auto_adjusted" &&
                  threshold.autoAdjustMin != null &&
                  (threshold.feedback?.total ?? 0) < threshold.autoAdjustMin
                    ? ` Auto-tuning starts at ${threshold.autoAdjustMin} ratings.`
                    : ""}
                </>
              }
              control={
                <div className="flex w-24 flex-col items-end gap-1.5">
                  <span className="text-content font-semibold tabular-nums">
                    {threshold.threshold.toFixed(2)}
                  </span>
                  <Progress
                    value={Math.round(threshold.threshold * 100)}
                    aria-label="Relevance floor"
                    className="h-1.5 w-full"
                  />
                </div>
              }
            />
          )}
        </div>
      </SettingsSection>
    </>
  );
}
