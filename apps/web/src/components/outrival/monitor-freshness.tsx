"use client";

import type { SourceType } from "@outrival/shared";
import { useForceRescan } from "@/hooks/use-force-rescan";
import { FreshnessDot } from "./freshness-dot";

// Patch-27 — wires the actionable FreshnessDot to the force-rescan hook for a
// single monitored source. Owns the hook (so it can live inside a list .map),
// and reports the start back to the parent so its existing scrape polling shows
// the row as running and refreshes it on completion.
export function MonitorFreshnessAction({
  monitorId,
  sourceType,
  lastScrapedAt,
  status,
  canForceRescan = true,
  onStarted,
}: {
  monitorId: string;
  sourceType: SourceType;
  lastScrapedAt: string | null;
  status: "success" | "failed" | null;
  canForceRescan?: boolean;
  onStarted?: () => void;
}) {
  const { forceRescan, isRescanning } = useForceRescan(monitorId, { onStarted });
  return (
    <FreshnessDot
      lastScrapedAt={lastScrapedAt}
      status={status}
      sourceType={sourceType}
      canForceRescan={canForceRescan}
      onForceRescan={forceRescan}
      rescanning={isRescanning}
    />
  );
}
