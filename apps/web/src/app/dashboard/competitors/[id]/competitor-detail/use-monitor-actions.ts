"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { MonitorFrequency, SourceType, CustomMonitorHint } from "@outrival/shared";
import { api, ApiError, type Monitor } from "@/lib/api";
import { competitorDetailQuery } from "@/lib/queries";
import { track } from "@/lib/posthog/events";
import { toastApiError, toastRescanLimit } from "@/lib/error-helpers";
import { friendlyScrapeError } from "@/lib/scrape-errors";
import { sourceShortLabel } from "@/lib/source-labels";
import { paywallFromError, type PaywallReason } from "@/components/outrival/paywall-dialog";
import { POLL_TIMEOUT_MS, POLL_INTERVAL_MS, isServerScraping } from "./shared";
import type { CompetitorData } from "../competitor-detail-view";

// Sources whose tab data is written by an async DOWNSTREAM extraction job
// (extract-pricing / extract-jobs / extract-reviews), not by the scrape itself.
// Their per-tab query has nothing new to show at the instant the scrape's lastRunAt
// moves — the extraction lands seconds-to-minutes later.
const EXTRACTION_BACKED_SOURCES = new Set<string>([
  "pricing",
  "jobs",
  // Reviews v2: App Store (RSS) + Trustpilot surface are the live review sources.
  "appstore_reviews",
  "trustpilot_public",
]);

// Rather than guess the extraction delay with fixed timers (the old scheme gave up
// at 70s and left slow extractions stuck until a hard refresh), poll the detail
// until aiSummaryUpdatedAt advances past the pre-scrape baseline — bounded by a
// hard deadline for the rare case where extraction never stamps.
const EXTRACTION_WATCH_INTERVAL_MS = 5000;
const EXTRACTION_WATCH_TIMEOUT_MS = 210_000;

/** What the "Watch a custom page" dialog needs back to stay open on a bad URL. */
export type CustomAddResult = { ok: true } | { ok: false; message: string };

/**
 * Every write against a competitor's monitors, plus the scrape-progress poller that
 * reports their outcome. Lives in a hook because two pages need it: the competitor
 * detail view (run a source from an empty state) and the Sources page (toggle,
 * retarget, enable, add a custom page). Duplicating it would mean two pollers
 * drifting apart on the same query cache.
 */
export function useMonitorActions(id: string) {
  const queryClient = useQueryClient();
  const competitorQ = useQuery(competitorDetailQuery(id));
  const data = competitorQ.data ?? null;

  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Watches downstream extraction results. Holds the poll interval + the monitors
  // we're waiting on (baseline aiSummaryUpdatedAt at scrape-finish + a deadline).
  const extractionWatchRef = useRef<{
    interval: ReturnType<typeof setInterval> | null;
    monitors: Map<string, { baseline: string | null; deadline: number }>;
  }>({ interval: null, monitors: new Map() });
  const scrapingStartRef = useRef<
    Map<
      string,
      {
        startedAt: number;
        lastRunAt: string | null;
        lastFailedAt: string | null;
        lastChangedAt: string | null;
        aiSummaryUpdatedAt: string | null;
      }
    >
  >(new Map());
  const seededRef = useRef(false);

  function setData(updater: (prev: CompetitorData | null) => CompetitorData | null) {
    queryClient.setQueryData<CompetitorData>(competitorDetailQuery(id).queryKey, (prev) =>
      updater(prev ?? null) ?? undefined,
    );
  }

  /** Patch one monitor in the cached detail — for optimistic writes. */
  function patchMonitor(monitorId: string, patch: Partial<Monitor>) {
    setData((d) =>
      d
        ? { ...d, monitors: d.monitors.map((m) => (m.id === monitorId ? { ...m, ...patch } : m)) }
        : d,
    );
  }

  /** Refetch the detail and return the fresh data (the poller + mutations await it). */
  async function refresh() {
    const r = await competitorQ.refetch();
    return r.data ?? null;
  }

  // Broad-invalidate every per-tab query for this competitor (not the heavy detail,
  // refreshed separately by the pollers) so whichever tab is active refetches.
  function invalidateExtractionTabs() {
    void queryClient.invalidateQueries({
      queryKey: ["competitor", id],
      predicate: (q) => q.queryKey[2] !== "detail",
    });
  }

  function watchExtraction(pending: { id: string; baseline: string | null }[]) {
    const ref = extractionWatchRef.current;
    const deadline = Date.now() + EXTRACTION_WATCH_TIMEOUT_MS;
    for (const p of pending) ref.monitors.set(p.id, { baseline: p.baseline, deadline });
    if (ref.interval) return;
    ref.interval = setInterval(async () => {
      const fresh = await refresh();
      const now = Date.now();
      let touched = false;
      for (const [mid, meta] of ref.monitors) {
        const updated = fresh?.monitors.find((x) => x.id === mid)?.aiSummaryUpdatedAt ?? null;
        // Extraction stamped a fresh summary → its tab data has landed. Or the
        // deadline passed → give up and refresh once regardless.
        if ((updated !== null && updated !== meta.baseline) || now > meta.deadline) {
          ref.monitors.delete(mid);
          touched = true;
        }
      }
      if (touched) invalidateExtractionTabs();
      if (ref.monitors.size === 0 && ref.interval) {
        clearInterval(ref.interval);
        ref.interval = null;
      }
    }, EXTRACTION_WATCH_INTERVAL_MS);
  }

  // Restore the in-progress state after a refresh: any monitor the server still
  // reports as scraping is re-tracked so the poll resumes and reports its outcome.
  useEffect(() => {
    if (!data || seededRef.current) return;
    seededRef.current = true;
    const running = data.monitors.filter(isServerScraping);
    if (running.length === 0) return;
    for (const m of running) {
      scrapingStartRef.current.set(m.id, {
        startedAt: m.scrapeStartedAt ? new Date(m.scrapeStartedAt).getTime() : Date.now(),
        lastRunAt: m.lastRunAt,
        lastFailedAt: m.lastFailedAt,
        lastChangedAt: m.lastChangedAt,
        aiSummaryUpdatedAt: m.aiSummaryUpdatedAt,
      });
    }
    setScrapingIds(new Set(running.map((m) => m.id)));
  }, [data]);

  useEffect(() => {
    if (scrapingIds.size === 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;

    pollRef.current = setInterval(async () => {
      const fresh = await refresh();
      if (!fresh) return;
      const finished: string[] = [];
      // Subset of `finished` whose lastChangedAt moved during the run — i.e. the
      // scrape produced a real diff, not just a no-op re-fetch of identical content.
      const changed: string[] = [];
      const failed: string[] = [];
      const timedOut: string[] = [];
      // Pre-scrape aiSummaryUpdatedAt per finished extraction-backed source, so the
      // watcher can tell when the downstream extraction has stamped a fresh one.
      const extractionBaselines = new Map<string, string | null>();
      const now = Date.now();
      for (const monitorId of scrapingIds) {
        const tracker = scrapingStartRef.current.get(monitorId);
        if (!tracker) continue;
        const updated = fresh.monitors.find((m) => m.id === monitorId);
        const updatedRun = updated?.lastRunAt ?? null;
        const updatedFailed = updated?.lastFailedAt ?? null;
        if (updatedRun !== null && updatedRun !== tracker.lastRunAt) {
          finished.push(monitorId);
          if (updated && EXTRACTION_BACKED_SOURCES.has(updated.sourceType)) {
            extractionBaselines.set(monitorId, tracker.aiSummaryUpdatedAt);
          }
          const updatedChanged = updated?.lastChangedAt ?? null;
          if (updatedChanged !== null && updatedChanged !== tracker.lastChangedAt) {
            changed.push(monitorId);
          }
        } else if (updatedFailed !== null && updatedFailed !== tracker.lastFailedAt) {
          failed.push(monitorId);
        } else if (now - tracker.startedAt > POLL_TIMEOUT_MS) {
          timedOut.push(monitorId);
        }
      }
      if (finished.length === 0 && failed.length === 0 && timedOut.length === 0) return;

      setScrapingIds((prev) => {
        const next = new Set(prev);
        for (const fid of [...finished, ...failed, ...timedOut]) {
          next.delete(fid);
          scrapingStartRef.current.delete(fid);
        }
        return next;
      });

      if (finished.length > 0) {
        const changedSet = new Set(changed);
        const label = (mid: string) =>
          fresh.monitors.find((m) => m.id === mid)?.sourceType ?? mid;
        const changedLabels = finished.filter((mid) => changedSet.has(mid)).map(label);
        const unchangedLabels = finished.filter((mid) => !changedSet.has(mid)).map(label);
        if (changedLabels.length > 0) {
          toast.success("Change detected", {
            description: `${changedLabels.join(", ")}: new snapshot captured`,
          });
        }
        if (unchangedLabels.length > 0) {
          toast.info("Scrape complete · no change", { description: unchangedLabels.join(", ") });
        }
        void queryClient.invalidateQueries({ queryKey: ["competitor", id] });

        // Extraction-backed sources write their tab data in a downstream job that
        // finishes AFTER lastRunAt moves — the invalidate above refetches data that
        // isn't there yet. Watch each such source until its extraction stamps a fresh
        // aiSummaryUpdatedAt, unless it already landed within this tick.
        const pending = finished
          .filter((mid) => extractionBaselines.has(mid))
          .filter((mid) => {
            const current = fresh.monitors.find((x) => x.id === mid)?.aiSummaryUpdatedAt ?? null;
            return current === (extractionBaselines.get(mid) ?? null);
          })
          .map((mid) => ({ id: mid, baseline: extractionBaselines.get(mid) ?? null }));
        if (pending.length > 0) watchExtraction(pending);
      }
      if (failed.length > 0) {
        for (const mid of failed) {
          const m = fresh.monitors.find((x) => x.id === mid);
          toast.error(`Scrape failed · ${m?.sourceType ?? mid}`, {
            description: friendlyScrapeError(m?.lastError, m?.sourceType),
          });
        }
        void queryClient.invalidateQueries({ queryKey: ["competitor", id] });
      }
      if (timedOut.length > 0) {
        const labels = timedOut
          .map((mid) => fresh.monitors.find((m) => m.id === mid)?.sourceType ?? mid)
          .join(", ");
        toast.warning("Scrape still running", {
          description: `${labels}: still in progress after 5 min, will continue in background. Refresh the page later to see results.`,
        });
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scrapingIds, id]);

  // Tear down the extraction watch when switching competitor or unmounting (it
  // invalidates this id's queries).
  useEffect(() => {
    const ref = extractionWatchRef.current;
    return () => {
      if (ref.interval) clearInterval(ref.interval);
      ref.interval = null;
      ref.monitors.clear();
    };
  }, [id]);

  function trackScrapeStart(monitor: Monitor) {
    scrapingStartRef.current.set(monitor.id, {
      startedAt: Date.now(),
      lastRunAt: monitor.lastRunAt,
      lastFailedAt: monitor.lastFailedAt,
      lastChangedAt: monitor.lastChangedAt,
      aiSummaryUpdatedAt: monitor.aiSummaryUpdatedAt,
    });
    setScrapingIds((prev) => new Set(prev).add(monitor.id));
  }

  function untrackScrape(monitorId: string) {
    scrapingStartRef.current.delete(monitorId);
    setScrapingIds((prev) => {
      const next = new Set(prev);
      next.delete(monitorId);
      return next;
    });
  }

  async function runMonitor(
    monitorId: string,
    list?: Monitor[],
  ): Promise<"ok" | "limit" | "error"> {
    const available = list ?? data?.monitors;
    if (!available) return "error";
    const monitor = available.find((m) => m.id === monitorId);
    if (!monitor) return "error";
    trackScrapeStart(monitor);
    try {
      await api.runMonitor(monitorId);
      track("scrape_triggered", { sourceType: monitor.sourceType });
      toast.info(`Scrape started · ${monitor.sourceType}`, {
        description: "Polling for completion…",
      });
      return "ok";
    } catch (e) {
      untrackScrape(monitorId);
      // A re-scan past the daily cap (patch-27) → friendly limit toast + upgrade nudge.
      if (toastRescanLimit(e)) return "limit";
      toastApiError(e, { title: "Couldn't start the scrape" });
      return "error";
    }
  }

  // Intelligent rate limiting (patch-22): a manual re-scrape of a source that was
  // checked recently with no change is friction, not blocked. Mirrors the server
  // GET /monitors/:id/staleness thresholds, computed client-side from data we already
  // have. The user can always force it.
  function monitorStaleness(m: Monitor): "very_recent" | "fresh" | "outdated" {
    const minutesSince = m.lastRunAt
      ? (Date.now() - new Date(m.lastRunAt).getTime()) / 60000
      : Infinity;
    const changedSinceRun =
      !!m.lastChangedAt &&
      !!m.lastRunAt &&
      new Date(m.lastChangedAt).getTime() >= new Date(m.lastRunAt).getTime();
    if (minutesSince < 30) return "very_recent";
    if (minutesSince < 1440 && !changedSinceRun) return "fresh";
    return "outdated";
  }

  function requestRunMonitor(monitorId: string, list?: Monitor[]) {
    const monitor = (list ?? data?.monitors)?.find((m) => m.id === monitorId);
    if (monitor) {
      const s = monitorStaleness(monitor);
      if (s !== "outdated") {
        toast.info(s === "very_recent" ? "Scraped just now" : "No changes since last scrape", {
          description:
            s === "very_recent"
              ? "This source was checked in the last 30 minutes."
              : "Nothing has changed since the last scrape, so re-scanning will likely find nothing new.",
          action: { label: "Re-scan anyway", onClick: () => void runMonitor(monitorId) },
        });
        return;
      }
    }
    void runMonitor(monitorId);
  }

  async function runAllMonitors() {
    if (!data) return;
    // Skip paused sources — "Scrape all" shouldn't wake a source the user turned off.
    const idle = data.monitors.filter((m) => !scrapingIds.has(m.id) && m.isActive !== false);
    if (idle.length === 0) return;
    setRunningAll(true);
    try {
      // Each re-scan counts against the daily cap; stop at the first limit hit so
      // we don't fire one 429 toast per remaining source.
      for (const m of idle) {
        const result = await runMonitor(m.id);
        if (result === "limit") break;
      }
    } finally {
      setRunningAll(false);
    }
  }

  // Re-activate an auto-paused source (markedUnscrapable): the resume endpoint
  // clears the failure state, re-enables scheduling, and kicks a fresh scrape.
  async function resumeMonitor(monitorId: string) {
    const monitor = data?.monitors.find((m) => m.id === monitorId);
    if (!monitor) return;
    trackScrapeStart(monitor);
    try {
      await api.resumeMonitor(monitorId);
      toast.success(`${sourceShortLabel(monitor.sourceType)} resumed`, {
        description: "A fresh scrape is on its way.",
      });
      await refresh();
    } catch (e) {
      untrackScrape(monitorId);
      toastApiError(e, { title: "Couldn't resume this source" });
    }
  }

  // Manually pause / enable a single source (distinct from the competitor-wide
  // monitoringPaused and from the auto-pause after repeated failures). A paused source
  // keeps its data + config; the scheduler simply skips it until re-enabled. Optimistic
  // flip so the row updates immediately; revert on failure.
  async function setMonitorActive(monitorId: string, active: boolean) {
    const monitor = data?.monitors.find((m) => m.id === monitorId);
    if (!monitor) return;
    const flip = (value: boolean) =>
      setData((d) =>
        d
          ? {
              ...d,
              monitors: d.monitors.map((m) =>
                m.id === monitorId ? { ...m, isActive: value } : m,
              ),
            }
          : d,
      );
    flip(active);
    try {
      // The row's toggle flips optimistically, so the new state is already visible —
      // a success toast would just be noise. Errors still surface below.
      await api.updateMonitor(monitorId, { isActive: active });
    } catch (e) {
      flip(!active);
      toastApiError(e, { title: "Couldn't update the source" });
    }
  }

  async function enableMonitor(sourceType: SourceType, url?: string) {
    try {
      await api.addCompetitorMonitor(id, sourceType, url ? { url } : undefined);
      const fresh = await refresh();
      const created = fresh?.monitors.find((m) => m.sourceType === sourceType);
      if (created && fresh) {
        toast.success(`${sourceShortLabel(sourceType)} monitoring enabled`, {
          description: "Starting first scrape…",
        });
        await runMonitor(created.id, fresh.monitors);
      } else {
        toast.success(`${sourceShortLabel(sourceType)} monitoring enabled`);
      }
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
        return;
      }
      toastApiError(e, { title: "Couldn't enable that source" });
    }
  }

  async function editMonitor(
    monitorId: string,
    patch: { url?: string; frequency?: MonitorFrequency },
  ) {
    // The selected segment renders off monitor.frequency, so without this it only
    // moved once the PATCH *and* the heavy detail refetch had both landed — a full
    // second of a click that looks like it did nothing. Flip it now, revert on error.
    const previousFrequency = data?.monitors.find((m) => m.id === monitorId)?.frequency;
    if (patch.frequency) patchMonitor(monitorId, { frequency: patch.frequency });
    try {
      await api.updateMonitor(monitorId, patch);
      await refresh();
      // A frequency-only change is reflected instantly by the selected segment, so it
      // needs no toast. Retargeting is async (the source re-scans) and clears the
      // previous page's failure verdict server-side — that one's worth confirming.
      if (patch.url) toast.success("Source repointed, we'll scan it shortly");
    } catch (e) {
      if (patch.frequency && previousFrequency) {
        patchMonitor(monitorId, { frequency: previousFrequency });
      }
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
        return;
      }
      toastApiError(e, { title: "Couldn't update the monitor" });
    }
  }

  // Add a custom-page monitor via the dedicated endpoint. Returns a result the
  // dialog uses: `ok` closes it (and kicks off the first scrape), otherwise the
  // domain-mismatch / duplicate message is shown inline so the user can fix the URL.
  async function addCustomMonitor(input: {
    url: string;
    label: string;
    hint: CustomMonitorHint;
  }): Promise<CustomAddResult> {
    try {
      const { monitor } = await api.addCustomMonitor(id, input);
      const fresh = await refresh();
      toast.success("Watching custom page", { description: "Starting first scrape…" });
      await runMonitor(monitor.id, fresh?.monitors);
      return { ok: true };
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
        return { ok: true };
      }
      if (e instanceof ApiError) {
        if (e.code === "custom_url_domain_mismatch") {
          return { ok: false, message: "That page isn't on this competitor's domain." };
        }
        if (e.code === "custom_url_duplicate") {
          return { ok: false, message: "You're already watching that page." };
        }
        if (e.code === "invalid_monitor_url") {
          return { ok: false, message: "That doesn't look like a valid https URL." };
        }
      }
      toastApiError(e, { title: "Couldn't add that page" });
      return { ok: true };
    }
  }

  async function removeCustomMonitor(monitorId: string) {
    try {
      await api.deleteMonitor(monitorId);
      await refresh();
      toast.success("Stopped watching that page");
    } catch (e) {
      toastApiError(e, { title: "Couldn't remove that page" });
    }
  }

  // Switch a competitor's URL-based review source. Reviews v2 leaves App Store as the
  // only such source, so this is effectively inert today, but kept for when another
  // URL-based review source returns. Enable the new source FIRST so a plan/URL
  // rejection surfaces the paywall without losing the existing monitor.
  async function switchReviewSource(oldMonitorId: string, source: SourceType, url: string) {
    try {
      const { monitor } = await api.addCompetitorMonitor(id, source, { url });
      await api.deleteMonitor(oldMonitorId);
      const fresh = await refresh();
      toast.success(`Switched to ${sourceShortLabel(source)}`, {
        description: "Starting first scrape…",
      });
      await runMonitor(monitor.id, fresh?.monitors);
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
        return;
      }
      toastApiError(e, { title: "Couldn't switch the review source" });
    }
  }

  return {
    data,
    error: competitorQ.error,
    scrapingIds,
    setScrapingIds,
    runningAll,
    paywall,
    setPaywall,
    setData,
    refresh,
    runMonitor,
    requestRunMonitor,
    runAllMonitors,
    resumeMonitor,
    setMonitorActive,
    enableMonitor,
    editMonitor,
    addCustomMonitor,
    removeCustomMonitor,
    switchReviewSource,
  };
}
