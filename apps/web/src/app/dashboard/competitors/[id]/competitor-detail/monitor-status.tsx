"use client";

import { formatDistanceToNow, formatDistanceToNowStrict } from "date-fns";
import { AlertCircle, Loader2, PowerOff } from "lucide-react";
import type { Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";

export type MonitorStatus = "running" | "failed" | "disabled" | "paused" | "ok" | "idle";

export function monitorStatus(m: Monitor, running: boolean): MonitorStatus {
  if (running) return "running";
  // Auto-paused after repeated failures (markedUnscrapable + isActive=false). A
  // distinct, muted state — not the loud "failed" hue — so the row shows the
  // source is intentionally off and won't retry on its own, not mid-retry.
  if (m.markedUnscrapable) return "disabled";
  // Manually paused by the user (isActive=false, no auto-pause flag): a deliberate
  // off state. Kept separate from "disabled" so the copy says "you paused this"
  // rather than "we stopped after failures".
  if (m.isActive === false) return "paused";
  const lastRun = m.lastRunAt ? new Date(m.lastRunAt).getTime() : 0;
  const lastFailed = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : 0;
  if (lastFailed > 0 && lastFailed > lastRun) return "failed";
  if (lastRun > 0) return "ok";
  return "idle";
}

export function SourceStatusIcon({ status }: { status: MonitorStatus }) {
  if (status === "running")
    return <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />;
  if (status === "failed") return <AlertCircle size={13} className="text-critical shrink-0" />;
  if (status === "disabled" || status === "paused")
    return <PowerOff size={13} className="text-muted-foreground shrink-0" />;
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full shrink-0",
        status === "ok" ? "bg-positive" : "border border-muted-foreground/40",
      )}
    />
  );
}

// When the scheduler will next check this source. The hourly cron scrapes any
// active monitor whose nextRunAt is null or already past, so a null/overdue value
// means "on the next hourly run" — we never surface it as a stale past date.
// Returns null when there's nothing meaningful to show (currently scraping, or
// paused after repeated failures — neither is on a schedule).
export function nextScanLabel(
  m: Monitor,
  status: MonitorStatus,
  monitoringPaused: boolean,
): string | null {
  const when = nextScanIn(m, status, monitoringPaused);
  if (!when) return null;
  return when === "paused" ? "Monitoring paused" : `Next scan ${when}`;
}

/**
 * The same schedule as a bare phrase ("in about 3 hours", "within the hour"), for
 * the row summary where it sits right after the cadence word and a second "Next
 * scan" would only repeat what the column already means.
 */
export function nextScanIn(
  m: Monitor,
  status: MonitorStatus,
  monitoringPaused: boolean,
): string | null {
  if (monitoringPaused) return "paused";
  if (status === "running" || status === "disabled") return null;
  if (m.isActive === false) return null;
  const next = m.nextRunAt ? new Date(m.nextRunAt).getTime() : 0;
  if (!next || next <= Date.now()) return "within the hour";
  // Strict, so a schedule reads "in 14 hours" and not "in about 14 hours": the
  // hedge is noise on a number the scheduler treats as a ceiling anyway.
  return formatDistanceToNowStrict(new Date(next), { addSuffix: true });
}

/** How long ago this source last produced a capture, phrased for a dense row. */
export function lastScanLabel(m: Monitor, status: MonitorStatus): string {
  if (status === "running") return "scraping…";
  if (status === "paused") return "Paused, not scraping";
  if (status === "disabled") return "Paused after repeated failures";
  if (status === "failed" && m.lastFailedAt) {
    return `Failed ${formatDistanceToNow(new Date(m.lastFailedAt), { addSuffix: true })}`;
  }
  if (m.lastRunAt) return `Scanned ${formatDistanceToNow(new Date(m.lastRunAt), { addSuffix: true })}`;
  return "Never scanned";
}
