"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { formatDate } from "@/lib/format-date";

interface Options {
  /** Fired right after the re-scan is accepted (before the result is known) so
   *  the caller can flip its own "scraping…" state and reuse existing polling. */
  onStarted?: () => void;
  /** Fired once the outcome is known (or polling gave up). */
  onDone?: () => void;
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

  const forceRescan = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setIsRescanning(true);
    // A forced scrape runs 30-150s; show a single live toast that transforms in
    // place into the outcome instead of leaving the user with no feedback.
    let toastId: string | number | undefined;
    try {
      const res = await api.forceRescan(monitorId);
      options?.onStarted?.();
      toastId = toast.loading("Re-scanning… this can take up to a minute.");

      const start = Date.now();
      let outcome: { hadNewSignal: boolean | null; nextRunAt: string | null } | null = null;
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const status = await api.forceRescanStatus(res.rescanLogId).catch(() => null);
        if (status?.done) {
          outcome = { hadNewSignal: status.hadNewSignal, nextRunAt: status.nextRunAt };
          break;
        }
      }

      if (!outcome) {
        toast.info(
          "Re-scan started — it's taking a little longer than usual. The data will refresh shortly.",
          { id: toastId },
        );
      } else if (outcome.hadNewSignal) {
        toast.success("Re-scan complete — we found an update. It's in your latest signals.", {
          id: toastId,
        });
      } else {
        toast.info(
          `Re-scan complete — nothing new. Next automatic check around ${formatDay(outcome.nextRunAt)}.`,
          { id: toastId },
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const detail = (err.data.error ?? {}) as { message?: string; upgradeHint?: boolean };
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
        toastApiError(err, { title: "Re-scan failed", id: toastId });
      }
    } finally {
      activeRef.current = false;
      setIsRescanning(false);
      options?.onDone?.();
    }
  }, [monitorId, options]);

  return { forceRescan, isRescanning };
}
