import { test, expect, describe } from "bun:test";
import { sourceState } from "@outrival/shared";
import type { Monitor } from "../src/lib/api";
import {
  lastScanLabel,
  monitorStatus,
  nextScanIn,
} from "../src/app/dashboard/competitors/[id]/competitor-detail/monitor-status";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function monitor(over: Partial<Monitor> = {}): Monitor {
  return {
    id: "m1",
    competitorId: "c1",
    sourceType: "roadmap",
    frequency: "weekly",
    config: null,
    lastRunAt: hoursAgo(2),
    nextRunAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    lastChangedAt: null,
    scrapeStartedAt: null,
    scrapePickedUpAt: null,
    lastFailedAt: null,
    lastError: null,
    aiSummary: null,
    aiSummaryUpdatedAt: null,
    isActive: true,
    markedUnscrapable: false,
    ...over,
  };
}

// A source the competitor doesn't have is recorded as a BENIGN SKIP: the worker
// stamps lastRunAt, clears lastFailedAt and markedUnscrapable, and keeps the verdict
// in lastError. Every reading built on the timestamps alone therefore landed on
// "ok" — a green dot and "Scanned 2 hours ago" on the same row as "This competitor
// doesn't have this surface."
const absent = monitor({ lastError: "no_roadmap_portal" });

describe("monitorStatus: the badge stops claiming a page that isn't there", () => {
  test("a recorded 'no such surface' is its own state, never ok", () => {
    expect(monitorStatus(absent, false)).toBe("not_available");
  });

  test("it agrees with sourceState, which drives the sentence beside the badge", () => {
    expect(sourceState({ sourceType: "roadmap", plan: "pro", monitor: absent })).toBe(
      "not_available",
    );
  });

  test("the row says what happened instead of stamping freshness on it", () => {
    const label = lastScanLabel(absent, monitorStatus(absent, false));
    expect(label).toBe("No such surface on this site");
    expect(label).not.toMatch(/scanned/i);
  });

  test("no next scan is announced for a page that doesn't exist", () => {
    expect(nextScanIn(absent, monitorStatus(absent, false), false)).toBeNull();
  });

  test("an open request still outranks it — that IS the newest thing", () => {
    expect(monitorStatus(absent, true)).toBe("running");
    expect(monitorStatus(absent, false, true)).toBe("queued");
  });

  test("every other source is read exactly as before", () => {
    expect(monitorStatus(monitor(), false)).toBe("ok");
    expect(monitorStatus(monitor({ lastRunAt: null }), false)).toBe("idle");
    expect(monitorStatus(monitor({ lastFailedAt: hoursAgo(1) }), false)).toBe("failed");
    expect(monitorStatus(monitor({ isActive: false }), false)).toBe("paused");
    // The marker is matched per source: `no_roadmap_portal` on a blog monitor is not
    // one of ITS neutral outcomes, so it stays whatever the timestamps say.
    expect(monitorStatus(monitor({ sourceType: "blog", lastError: "no_roadmap_portal" }), false)).toBe(
      "ok",
    );
  });
});
