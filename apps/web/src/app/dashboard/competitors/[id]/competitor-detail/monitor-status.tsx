"use client";

import { formatDistanceToNow, formatDistanceToNowStrict } from "date-fns";
import {
  WarningCircleIcon,
  ClockIcon,
  SpinnerIcon,
  PauseCircleIcon,
  ProhibitIcon,
  ShieldSlashIcon,
} from "@/components/icons";
import { hasNoTargetError, isRefused } from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";

export type MonitorStatus =
  | "running"
  | "queued"
  /** The site refuses automated collection and we stop. Not a failure of ours. */
  | "blocked"
  /** This competitor has no such surface. NEUTRAL — never a gap, never an error. */
  | "not_available"
  | "failed"
  | "disabled"
  | "paused"
  | "ok"
  | "idle";

export function monitorStatus(m: Monitor, running: boolean, queued = false): MonitorStatus {
  if (running) return "running";
  // Asked for but not started: the row must not claim to be scanning a site no
  // worker has opened yet. Ranked above the settled states below because the
  // pending request is the newest thing that happened to this source.
  if (queued) return "queued";
  // "No such surface" outranks every settled state, exactly as it does in
  // `sourceState` — same predicate, same rank, so an icon can never contradict the
  // sentence beside it. It has to be read from lastError because the worker records
  // this verdict as a BENIGN SKIP: it stamps lastRunAt and clears the failure
  // columns like a real capture, which landed the row on "ok" — a green dot and
  // "Scanned 2 days ago" over "This competitor doesn't have this surface."
  if (hasNoTargetError(m.sourceType, m.lastError)) return "not_available";
  // A refusal outranks both pause states below. Under the collection doctrine we
  // stop at a refusal by design, so reading it as "auto-paused after repeated
  // failures" describes a retry loop that never ran and offers a Resume that
  // cannot help. Same predicate `sourceState` uses, so the icon on a row can no
  // longer contradict the sentence next to it.
  if (isRefused(m)) return "blocked";
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
    return <SpinnerIcon size={16} className="animate-spin text-muted-foreground shrink-0" />;
  // A clock, not a spinner: nothing is turning yet, and a spinner that runs for
  // half an hour is what made the wait read as a hang in the first place.
  if (status === "queued") return <ClockIcon size={16} className="text-muted-foreground shrink-0" />;
  // Deliberately muted, never the critical hue: a refusal is a real limit but not a
  // defect and not a task. Painting it red made a well-covered competitor read as
  // broken and sent users looking for a fix that must not exist.
  if (status === "blocked")
    return <ShieldSlashIcon size={16} className="text-muted-foreground shrink-0" />;
  // A surface that doesn't exist gets its own glyph rather than the hollow ring of
  // an idle source: "we have never run this" and "there is nothing here to run" are
  // different facts, and only one of them is worth turning on. Muted like the other
  // non-events — it is neither a defect nor a task.
  if (status === "not_available")
    return <ProhibitIcon size={16} className="text-muted-foreground shrink-0" />;
  if (status === "failed") return <WarningCircleIcon size={16} className="text-critical shrink-0" />;
  if (status === "disabled" || status === "paused")
    return <PauseCircleIcon size={16} className="text-muted-foreground shrink-0" />;
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
  // A queued source has a scan pending NOW, so its scheduled next scan is not the
  // thing to show — the queue line below says what it is waiting on.
  // A blocked source has no schedule to announce: we are not going to keep asking a
  // site that told us no. (The re-probe that eventually retries it is ours, not a
  // promise to make to the user.)
  // A source the competitor doesn't have is on the same footing: we do keep
  // re-probing it on its cadence, but that is our business — announcing a next scan
  // for a page that doesn't exist reads as coverage of something.
  if (
    status === "running" ||
    status === "queued" ||
    status === "disabled" ||
    status === "blocked" ||
    status === "not_available"
  )
    return null;
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
  // Says what is actually true: the request is in, the fetch has not begun. The
  // old copy claimed "scraping…" from the moment of the click, so a source that
  // sat in the queue for half an hour looked like a scrape that had hung.
  if (status === "queued") return "queued, waiting for a scanner";
  if (status === "blocked") return "Site blocks automated collection";
  // Never "Scanned 2 days ago": the run did happen, but it found no page to read,
  // and a freshness stamp on it claims data we don't have.
  if (status === "not_available") return "No such surface on this site";
  if (status === "paused") return "Paused, not scraping";
  if (status === "disabled") return "Paused after repeated failures";
  if (status === "failed" && m.lastFailedAt) {
    return `Failed ${formatDistanceToNow(new Date(m.lastFailedAt), { addSuffix: true })}`;
  }
  if (m.lastRunAt) return `Scanned ${formatDistanceToNow(new Date(m.lastRunAt), { addSuffix: true })}`;
  return "Never scanned";
}
