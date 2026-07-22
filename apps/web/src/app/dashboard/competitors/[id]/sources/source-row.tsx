"use client";

import { useState } from "react";
import { Link2, Loader2, Lock, Play, Plus } from "lucide-react";
import {
  MONITOR_FREQUENCIES,
  PLAN_LABELS,
  minPlanForSource,
  planIncludesFrequency,
  minPlanForFrequency,
  sourceState,
  type DetectedTargets,
  type MonitorFrequency,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { sourceShortLabel } from "@/lib/source-labels";
import {
  SourceStatusIcon,
  monitorStatus,
  nextScanLabel,
  lastScanLabel,
} from "../competitor-detail/monitor-status";
import { sourceCopy, isConcerning } from "./source-copy";

const TONE_CLASS = {
  ok: "text-muted-foreground",
  limited: "text-warning",
  actionable: "text-critical",
  neutral: "text-muted-foreground",
} as const;

/**
 * One configurable source. The row always exists, whether or not a monitor does —
 * that is what lets it say "this competitor has no such surface" instead of simply
 * omitting the line and leaving the user to wonder.
 */
export function SourceRow({
  sourceType,
  monitor,
  plan,
  targets,
  fallbacks,
  running,
  monitoringPaused,
  onRun,
  onEnable,
  onEdit,
  onSetActive,
  onLockedFrequency,
  onUpgrade,
}: {
  sourceType: SourceType;
  monitor: Monitor | null;
  plan: Plan;
  targets: DetectedTargets | null;
  /** Other sources we ARE collecting — quoted in the blocked message. */
  fallbacks: string[];
  running: boolean;
  monitoringPaused: boolean;
  onRun: (id: string) => void;
  onEnable: (source: SourceType, url?: string) => Promise<void>;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onSetActive: (id: string, active: boolean) => void;
  onLockedFrequency: (freq: MonitorFrequency) => void;
  onUpgrade: (source: SourceType) => void;
}) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const state = sourceState({ sourceType, plan, monitor, targets });
  const status = monitor ? monitorStatus(monitor, running) : "idle";
  const copy = sourceCopy({
    state,
    sourceType,
    failureCategory: monitor?.lastFailureCategory,
    fallbacks,
    minPlanLabel: PLAN_LABELS[minPlanForSource(sourceType)],
    freshness: monitor ? lastScanLabel(monitor, status) : undefined,
  });
  const nextScan =
    monitor && (state === "tracking" || state === "pending")
      ? nextScanLabel(monitor, status, monitoringPaused)
      : null;
  const currentUrl = monitor?.config?.url ?? "";
  // A repo lives on github.com and can't be derived from the competitor's site, so
  // enabling it needs the URL up front rather than after the fact.
  const needsUrlToEnable = sourceType === "github_repo";

  function openUrlPanel() {
    setUrlValue(currentUrl);
    setUrlOpen((v) => !v);
  }

  async function saveUrl() {
    const url = urlValue.trim();
    if (!url) return;
    setSaving(true);
    try {
      if (monitor) await onEdit(monitor.id, { url });
      else await onEnable(sourceType, url);
      setUrlOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {monitor ? (
          <SourceStatusIcon status={status} />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40" />
        )}
        <span className="w-[132px] shrink-0 truncate text-sm font-medium">
          {sourceShortLabel(sourceType)}
        </span>

        <span className={cn("min-w-0 flex-1 text-sm", TONE_CLASS[copy.tone])}>
          {copy.message}
          {nextScan && <span className="text-muted-foreground"> · {nextScan}</span>}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {copy.action === "upgrade" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onUpgrade(sourceType)}
            >
              <Lock size={11} /> Upgrade
            </Button>
          )}

          {copy.action === "enable" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={enabling}
              onClick={async () => {
                if (needsUrlToEnable) {
                  openUrlPanel();
                  return;
                }
                setEnabling(true);
                try {
                  await onEnable(sourceType);
                } finally {
                  setEnabling(false);
                }
              }}
            >
              {enabling ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Enable
            </Button>
          )}

          {copy.action === "fix_url" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openUrlPanel}>
              <Link2 size={11} /> Fix URL
            </Button>
          )}

          {monitor && state !== "locked" && state !== "not_available" && (
            <>
              {copy.action !== "fix_url" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={openUrlPanel}
                  aria-expanded={urlOpen}
                >
                  <Link2 size={11} /> URL
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={running || monitor.isActive === false}
                onClick={() => onRun(monitor.id)}
              >
                {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                Run
              </Button>
              <Switch
                checked={monitor.isActive !== false}
                onCheckedChange={(v) => onSetActive(monitor.id, v)}
                aria-label={`${sourceShortLabel(sourceType)} monitoring`}
              />
            </>
          )}
        </div>
      </div>

      {monitor && state !== "locked" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[calc(0.5rem+132px+0.75rem)]">
          {MONITOR_FREQUENCIES.map((freq) => {
            const locked = !planIncludesFrequency(plan, freq);
            return (
              <Button
                key={freq}
                type="button"
                size="sm"
                variant={monitor.frequency === freq ? "secondary" : "ghost"}
                className="h-6 gap-1 text-meta capitalize text-muted-foreground"
                onClick={() =>
                  locked ? onLockedFrequency(freq) : void onEdit(monitor.id, { frequency: freq })
                }
              >
                {locked && <Lock size={9} className="opacity-70" />}
                {freq}
                {locked && (
                  <span className="text-meta uppercase tracking-wide opacity-70">
                    {PLAN_LABELS[minPlanForFrequency(freq)]}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {urlOpen && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-border bg-background p-3">
          <Label htmlFor={`url-${sourceType}`} className="text-xs">
            Page URL
          </Label>
          <p className="text-xs text-muted-foreground">
            {/* Retargeting clears the previous page's failure record server-side, so
                a source that was blocked or auto-paused comes back on its own. */}
            Must be on this competitor&apos;s domain. Saving clears this source&apos;s
            failure history and schedules a fresh scan — past snapshots are kept.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`url-${sourceType}`}
              value={urlValue}
              placeholder="https://…"
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) void saveUrl();
              }}
              className="min-w-[240px] flex-1"
            />
            <Button size="sm" onClick={saveUrl} disabled={saving || !urlValue.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setUrlOpen(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export { isConcerning };
