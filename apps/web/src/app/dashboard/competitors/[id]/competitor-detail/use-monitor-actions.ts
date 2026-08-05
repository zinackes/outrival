"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import type { MonitorFrequency, SourceType, CustomMonitorHint } from "@outrival/shared";
import { api, ApiError, type Monitor } from "@/lib/api";
import { competitorDetailQuery } from "@/lib/queries";
import { track } from "@/lib/posthog/events";
import { toastApiError, toastRescanLimit } from "@/lib/error-helpers";
import { friendlyScrapeError } from "@/lib/scrape-errors";
import {
  scrapeRunProgress,
  scrapeRunSummary,
  type ScrapeRunOutcome,
} from "@/lib/scrape-run-summary";
import { sourceShortLabel } from "@/lib/source-labels";
import { paywallFromError, type PaywallReason } from "@/components/outrival/paywall-dialog";
import { QUEUE_TIMEOUT_MS, POLL_INTERVAL_MS, isServerInFlight } from "./shared";
import type { CompetitorData } from "../competitor-detail-view";

// A scrape only writes the snapshot. Everything a tab reads lands in DOWNSTREAM
// jobs enqueued just before lastRunAt moves — extract-pricing / extract-jobs /
// extract-reviews for the data tabs, classify-change → generate-signal for the
// changes and signals. At the instant the poller calls a scrape "finished", none
// of it exists yet, so the invalidation fired there refetches emptiness.
//
// Watching monitors.aiSummaryUpdatedAt for the landing didn't work: that stamp is
// written only when the best-effort AI source summary returns, so an AI failure or
// an extraction that bails early (parse_failed / empty_unverified) never moves it
// and the tab sat on its empty state until a hard reload. Re-check on a widening
// schedule instead — whatever lands, whenever it lands, shows up on its own.
// invalidateQueries only refetches MOUNTED queries, so this costs the active tab's
// queries plus the detail, not the whole cache.
const RECHECK_STEPS_MS = [3000, 5000, 8000, 13000, 21000, 34000, 55000];

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
  // Post-scrape recheck chain: the pending timer + how far into RECHECK_STEPS_MS
  // we are. A newly finished scrape restarts it from the first step.
  const recheckRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; step: number }>({
    timer: null,
    step: 0,
  });
  const scrapingStartRef = useRef<
    Map<
      string,
      {
        startedAt: number;
        lastRunAt: string | null;
        lastFailedAt: string | null;
        lastChangedAt: string | null;
      }
    >
  >(new Map());
  // The single live toast that covers one scrape run, whatever it fans out to.
  // Opened when the first source starts, updated in place as they settle, and
  // replaced by one summary line when the last one does — see lib/scrape-run-summary.
  const runRef = useRef<(ScrapeRunOutcome & { total: number }) | null>(null);
  // Which competitor the in-progress seeding below already ran for. Keyed by id,
  // not a boolean: the pager swaps `id` without remounting this hook, and a bare
  // flag left a scrape running on the newly opened competitor untracked — so its
  // results only appeared on a reload, the same symptom this file exists to avoid.
  const seededRef = useRef<string | null>(null);

  function setData(updater: (prev: CompetitorData | null) => CompetitorData | null) {
    queryClient.setQueryData<CompetitorData>(competitorDetailQuery(id).queryKey, (prev) =>
      updater(prev ?? null) ?? undefined,
    );
  }

  /**
   * Patch one monitor in the cached detail — for optimistic writes. Both lists, since
   * the payload splits configurable from always-on and the caller only has an id: an
   * always-on cadence change patched into `monitors` alone would land nowhere and the
   * segment would sit on its old value until the refetch came back.
   */
  function patchMonitor(monitorId: string, patch: Partial<Monitor>) {
    const apply = (list: Monitor[]) =>
      list.map((m) => (m.id === monitorId ? { ...m, ...patch } : m));
    setData((d) =>
      d
        ? { ...d, monitors: apply(d.monitors), automaticMonitors: apply(d.automaticMonitors) }
        : d,
    );
  }

  /** Refetch the detail and return the fresh data (the poller + mutations await it). */
  async function refresh() {
    const r = await competitorQ.refetch();
    return r.data ?? null;
  }

  // Re-read this competitor (detail + whichever tab is mounted) on a widening
  // schedule, so downstream extraction and classification results appear without
  // a reload. Called on every scrape finish; a later finish restarts the chain.
  function scheduleRecheck() {
    const ref = recheckRef.current;
    if (ref.timer) clearTimeout(ref.timer);
    ref.step = 0;
    const tick = () => {
      const delay = RECHECK_STEPS_MS[ref.step];
      if (delay === undefined) {
        ref.timer = null;
        return;
      }
      ref.step += 1;
      ref.timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["competitor", id] });
        tick();
      }, delay);
    };
    tick();
  }

  // One id for the whole run, so every update lands in the same toast instead of
  // stacking a new one per source per poll tick.
  const runToastId = `scrape:${id}`;

  /** Open the run toast, or widen it when more sources join a run already going. */
  function openRun(sources: number, competitorName: string) {
    const run = runRef.current;
    if (run) run.total += sources;
    else {
      runRef.current = {
        competitorName,
        total: sources,
        changed: [],
        unchanged: [],
        failed: [],
        pending: [],
      };
    }
    renderRun();
  }

  function renderRun() {
    const run = runRef.current;
    if (!run) return;
    const done =
      run.changed.length + run.unchanged.length + run.failed.length + run.pending.length;
    const { title, description } = scrapeRunProgress(run.competitorName, done, run.total);
    toast.loading(title, { id: runToastId, description });
  }

  /** Last source settled: replace the live toast with the one-line outcome. */
  function closeRun() {
    const run = runRef.current;
    if (!run) return;
    runRef.current = null;
    const { kind, title, description } = scrapeRunSummary(run);
    toast[kind](title, { id: runToastId, description });
  }

  // Restore the in-progress state after a refresh: any monitor the server still
  // reports as scraping is re-tracked so the poll resumes and reports its outcome.
  useEffect(() => {
    if (!data || seededRef.current === id) return;
    seededRef.current = id;
    // Queued counts as in-flight here: a job that has not been picked up yet is
    // still coming, and dropping it from the tracker is what left a source with no
    // outcome toast when the queue was behind.
    const running = data.monitors.filter(isServerInFlight);
    if (running.length === 0) return;
    for (const m of running) {
      scrapingStartRef.current.set(m.id, {
        startedAt: m.scrapeStartedAt ? new Date(m.scrapeStartedAt).getTime() : Date.now(),
        lastRunAt: m.lastRunAt,
        lastFailedAt: m.lastFailedAt,
        lastChangedAt: m.lastChangedAt,
      });
    }
    setScrapingIds(new Set(running.map((m) => m.id)));
    openRun(running.length, data.competitor.name);
  }, [data, id]);

  useEffect(() => {
    if (scrapingIds.size === 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      // Nothing left in flight — the run is over, so report it once.
      closeRun();
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
      const now = Date.now();
      for (const monitorId of scrapingIds) {
        const tracker = scrapingStartRef.current.get(monitorId);
        if (!tracker) continue;
        const updated = fresh.monitors.find((m) => m.id === monitorId);
        const updatedRun = updated?.lastRunAt ?? null;
        const updatedFailed = updated?.lastFailedAt ?? null;
        if (updatedRun !== null && updatedRun !== tracker.lastRunAt) {
          finished.push(monitorId);
          const updatedChanged = updated?.lastChangedAt ?? null;
          if (updatedChanged !== null && updatedChanged !== tracker.lastChangedAt) {
            changed.push(monitorId);
          }
        } else if (updatedFailed !== null && updatedFailed !== tracker.lastFailedAt) {
          failed.push(monitorId);
          // The give-up point has to cover the QUEUE wait, not just the fetch: at
          // the old 5 minutes the poller stopped watching sources that were still
          // waiting their turn, so their result never produced a toast and the row
          // fell back to looking idle.
        } else if (now - tracker.startedAt > QUEUE_TIMEOUT_MS) {
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

      // Everything below only records what settled; the toast itself is the run's
      // single live one, refreshed once at the end of the tick.
      const run = runRef.current;
      const label = (mid: string) => {
        const m = fresh.monitors.find((x) => x.id === mid);
        return m ? sourceShortLabel(m.sourceType) : mid;
      };

      if (finished.length > 0) {
        const changedSet = new Set(changed);
        if (run) {
          for (const mid of finished) {
            (changedSet.has(mid) ? run.changed : run.unchanged).push(label(mid));
          }
        }
        void queryClient.invalidateQueries({ queryKey: ["competitor", id] });
        // That invalidation lands before any downstream job has written anything —
        // the extractions and the classify → signal chain were only just enqueued.
        // Keep re-reading for a couple of minutes so their results surface here.
        scheduleRecheck();
      }
      if (failed.length > 0) {
        if (run) {
          for (const mid of failed) {
            const m = fresh.monitors.find((x) => x.id === mid);
            run.failed.push({
              label: label(mid),
              reason: friendlyScrapeError(m?.lastError, m?.sourceType),
            });
          }
        }
        void queryClient.invalidateQueries({ queryKey: ["competitor", id] });
      }
      if (timedOut.length > 0 && run) {
        for (const mid of timedOut) run.pending.push(label(mid));
      }
      // Keep the live count moving while sources remain. When this tick settled the
      // last of them, say nothing: the effect above is about to close the run with
      // its summary, and re-rendering "Scanning…" first would flash for a frame.
      const settled = finished.length + failed.length + timedOut.length;
      if (settled < scrapingIds.size) renderRun();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scrapingIds, id]);

  // Tear down the recheck chain when switching competitor or unmounting (it
  // invalidates this id's queries). The run toast goes with it: a "Scanning…"
  // spinner never auto-dismisses, so leaving the page would strand it on screen.
  useEffect(() => {
    const ref = recheckRef.current;
    const toastId = `scrape:${id}`;
    return () => {
      if (ref.timer) clearTimeout(ref.timer);
      ref.timer = null;
      if (runRef.current) {
        runRef.current = null;
        toast.dismiss(toastId);
      }
    };
  }, [id]);

  function trackScrapeStart(monitor: Monitor) {
    scrapingStartRef.current.set(monitor.id, {
      startedAt: Date.now(),
      lastRunAt: monitor.lastRunAt,
      lastFailedAt: monitor.lastFailedAt,
      lastChangedAt: monitor.lastChangedAt,
    });
    setScrapingIds((prev) => new Set(prev).add(monitor.id));
    openRun(1, data?.competitor.name ?? "this competitor");
  }

  function untrackScrape(monitorId: string) {
    scrapingStartRef.current.delete(monitorId);
    setScrapingIds((prev) => {
      const next = new Set(prev);
      next.delete(monitorId);
      return next;
    });
    // The scrape never started (the enqueue itself failed), so it owes no outcome:
    // shrink the run, and drop its toast entirely if nothing else is left in it.
    // The caller reports the failure — a summary here would be a second toast for
    // the same event.
    const run = runRef.current;
    if (!run) return;
    run.total -= 1;
    if (run.total <= 0) {
      runRef.current = null;
      toast.dismiss(runToastId);
    } else {
      renderRun();
    }
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
          // Clicking the same source twice replaces this toast instead of piling
          // a second identical one on top.
          id: `staleness:${monitorId}`,
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

  /**
   * Run every idle source, or only those of `only` when given.
   *
   * The scoped form is what a TAB's "Re-scan now" needs: a tab reads several
   * sources at once, and running just the first of them re-scanned one surface
   * while the reader watched a page fed by four. It also bypasses the staleness
   * gate `requestRunMonitor` applies, which on a group would have turned one
   * click into one dismissible toast per fresh source.
   */
  async function runAllMonitors(only?: readonly SourceType[]) {
    if (!data) return;
    // Passed straight to an onClick, `only` is the click event, and reading
    // `.includes` off it threw before a single source ran — the button did
    // nothing. The signature says "a list or nothing", so anything else is
    // nothing.
    const scope = Array.isArray(only) ? only : undefined;
    // Skip paused sources — "Scrape all" shouldn't wake a source the user turned off.
    const idle = data.monitors.filter(
      (m) =>
        !scrapingIds.has(m.id) &&
        m.isActive !== false &&
        (!scope || scope.includes(m.sourceType)),
    );
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
      // No "a scrape is on its way" here: the run toast opened by trackScrapeStart
      // above is already saying exactly that, live.
      toast.success(`${sourceShortLabel(monitor.sourceType)} resumed`);
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
      toast.success(`${sourceShortLabel(sourceType)} monitoring enabled`);
      if (created && fresh) await runMonitor(created.id, fresh.monitors);
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
    const previousFrequency = [
      ...(data?.monitors ?? []),
      ...(data?.automaticMonitors ?? []),
    ].find((m) => m.id === monitorId)?.frequency;
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
      toast.success("Watching custom page");
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
      toast.success(`Switched to ${sourceShortLabel(source)}`);
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
