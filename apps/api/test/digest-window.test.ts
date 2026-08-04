import { describe, expect, test } from "bun:test";
import { inProgressWindow } from "../src/lib/digest-window";
import { CRON_SCHEDULES } from "@outrival/queue";

// The "in progress" card promises a window the weekly cron will honour. Nothing
// enforces that at runtime — the cron computes its own bounds in the worker — so the
// duplication is what these cases pin down. A card that names Jul 27 to Aug 3 while
// the cron writes Jul 20 to Jul 27 is worse than no card at all.

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("inProgressWindow", () => {
  test("mid-week, it names the window closing on the next Monday", () => {
    const w = inProgressWindow(new Date("2026-07-29T14:00:00Z")); // Wednesday
    expect(iso(w.start)).toBe("2026-07-27");
    expect(iso(w.end)).toBe("2026-08-03");
    expect(w.nextRunAt.toISOString()).toBe("2026-08-03T08:00:00.000Z");
  });

  test("Sunday night still belongs to the week about to be written", () => {
    const w = inProgressWindow(new Date("2026-08-02T23:59:00Z"));
    expect(iso(w.start)).toBe("2026-07-27");
    expect(iso(w.end)).toBe("2026-08-03");
  });

  test("Monday BEFORE the cron fires, the open window is still last Monday's", () => {
    // The eight hours anchoring on midnight would get wrong: the run has not happened,
    // so the week being collected has not rolled over yet.
    for (const at of ["2026-08-03T00:00:00Z", "2026-08-03T07:59:59Z"]) {
      const w = inProgressWindow(new Date(at));
      expect(iso(w.start)).toBe("2026-07-27");
      expect(iso(w.end)).toBe("2026-08-03");
      expect(w.nextRunAt.toISOString()).toBe("2026-08-03T08:00:00.000Z");
    }
  });

  test("Monday AFTER the cron fires, a fresh window opens", () => {
    const w = inProgressWindow(new Date("2026-08-03T08:00:01Z"));
    expect(iso(w.start)).toBe("2026-08-03");
    expect(iso(w.end)).toBe("2026-08-10");
    expect(w.nextRunAt.toISOString()).toBe("2026-08-10T08:00:00.000Z");
  });

  test("the window is always exactly seven days, and ends on a Monday", () => {
    // Walk a full week hour by hour: no gap, no overlap, no drift across a weekend.
    for (let h = 0; h < 24 * 8; h++) {
      const now = new Date(Date.UTC(2026, 6, 27) + h * 3600_000);
      const w = inProgressWindow(now);
      expect(w.end.getTime() - w.start.getTime()).toBe(7 * 24 * 3600_000);
      expect(w.end.getUTCDay()).toBe(1); // Monday
      expect(w.start.getUTCDay()).toBe(1);
      expect(w.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  test("it reads the same schedule the worker runs", () => {
    // If the cron ever moves off Monday 08:00 UTC, this card starts lying.
    expect(CRON_SCHEDULES["generate-weekly-digest"]).toBe("0 8 * * 1");
  });
});
