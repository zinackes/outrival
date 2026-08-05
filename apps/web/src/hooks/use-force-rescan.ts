"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { api, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { formatDate } from "@/lib/format-date";
import { track } from "@/lib/posthog/events";

interface Options {
  /** Fired right after the re-scan is accepted (before the result is known) so
   *  the caller can flip its own "scraping…" state and reuse existing polling. */
  onStarted?: () => void;
  /** Fired once the outcome is known (or polling gave up). */
  onDone?: () => void;
  /** What is being re-scanned ("Acme · Pricing page"), prefixed to every toast.
   *  Without it, a re-scan fired from a list of sources reported "Re-scan
   *  complete" with no way to tell which row it belonged to. */
  label?: string;
}

// Typical forced scrape resolves in 30-90s; poll a bit past that before giving up.
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 150_000;

function formatDay(iso: string | null): string {
  if (!iso) return "soon";
  return formatDate(iso, { month: "short", day: "numeric" });
}

// Patch-27 — drives the stale-data "Re-scan" affordance. Forces a scrape (bypassing
// the dedup), then polls the forced_rescan_log outcome to show a contextual toast:
// a change was found vs nothing new (with the next automatic check). A 429 means
// the per-tier daily cap was hit — surfaced with an upgrade nudge.
export function useForceRescan(monitorId: string, options?: Options) {
  const [isRescanning, setIsRescanning] = useState(false);
  const activeRef = useRef(false);
  // Every toast below carries the same id, so a second re-scan replaces the first
  // one's outcome instead of stacking on it.
  const forceRescan = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setIsRescanning(true);
    // A forced scrape runs 30-150s; show a single live toast that transforms in
    // place into the outcome instead of leaving the user with no feedback.
    const toastId = `rescan:${monitorId}`;
    const named = (text: string) => (options?.label ? `${options.label} · ${text}` : text);
    try {
      const res = await api.forceRescan(monitorId);
      options?.onStarted?.();

      // Unmetered first scrape (freshly enabled / just-retargeted URL): there's no
      // forced_rescan_log row to poll for an outcome. The parent's own scrape-progress
      // polling (kicked off by onStarted) refreshes the row and reports the result,
      // so there's nothing to say here.
      if (!res.rescanLogId) return;

      toast.loading(named("Re-scanning…"), {
        id: toastId,
        description: "This can take up to a minute.",
      });

      const start = Date.now();
      let outcome: { failed: boolean; hadNewSignal: boolean | null; nextRunAt: string | null } | null =
        null;
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const status = await api.forceRescanStatus(res.rescanLogId).catch(() => null);
        if (status?.done) {
          outcome = { failed: status.failed, hadNewSignal: status.hadNewSignal, nextRunAt: status.nextRunAt };
          break;
        }
      }

      if (!outcome) {
        toast.info(named("Re-scan still running"), {
          id: toastId,
          description: "It's taking longer than usual. The data will refresh on its own.",
        });
      } else if (outcome.failed) {
        toast.error(named("Re-scan failed"), {
          id: toastId,
          description: "We couldn't reach the source. It'll retry automatically.",
        });
      } else if (outcome.hadNewSignal) {
        toast.success(named("Update found"), {
          id: toastId,
          description: "It's in your latest signals.",
        });
      } else {
        toast.info(named("Nothing new"), {
          id: toastId,
          description: `Next automatic check around ${formatDay(outcome.nextRunAt)}.`,
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const detail = (err.data.error ?? {}) as { message?: string; upgradeHint?: boolean };
        // Same shape toastRescanLimit() parses in error-helpers.ts, inlined here;
        // invisible to the paywall_shown funnel without this (plan 022).
        track("paywall_shown", { reason: "rescan_limit_reached" });
        toast.warning(detail.message ?? "Daily re-scan limit reached. It resets tomorrow.", {
          id: toastId,
          action: detail.upgradeHint
            ? {
                label: "View plans",
                onClick: () => {
                  window.location.href = "/dashboard/settings/billing";
                },
              }
            : undefined,
        });
      } else {
        toastApiError(err, { title: named("Re-scan failed"), id: toastId });
      }
    } finally {
      activeRef.current = false;
      setIsRescanning(false);
      options?.onDone?.();
    }
  }, [monitorId, options]);

  return { forceRescan, isRescanning };
}
