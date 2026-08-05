import { describe, expect, test } from "bun:test";
import {
  ALWAYS_ON_FREQUENCIES,
  alwaysOnFrequenciesFor,
  alwaysOnFrequenciesForSource,
  effectiveFrequencyFor,
} from "./scheduling";
import { PLANS, planIncludesFrequency } from "./constants/plans";
import { AUTOMATIC_SOURCES } from "./sources/catalog";
import { seedFrequencyFor } from "./sources/defaults";
import type { MonitorFrequency } from "./constants/sources";

// OUT-11 — the always-on sources became configurable from pro up. The two rules that
// bound it live here rather than in the UI, because the API gate and the worker's
// downgrade clamp both read them.

describe("ALWAYS_ON_FREQUENCIES", () => {
  test("never offers realtime (an hourly poll of someone else's endpoint)", () => {
    expect(ALWAYS_ON_FREQUENCIES).not.toContain("realtime" as MonitorFrequency);
  });

  test("holds the weekly seed, so no always-on source can be sped up by default", () => {
    for (const source of AUTOMATIC_SOURCES) {
      expect(ALWAYS_ON_FREQUENCIES).toContain(seedFrequencyFor(source));
    }
  });
});

describe("alwaysOnFrequenciesForSource", () => {
  test("subdomains is pinned to its weekly seed — crt.sh 429s under a daily load", () => {
    expect(alwaysOnFrequenciesForSource("subdomains")).toEqual(["weekly"]);
  });

  test("the other always-on sources take the full set", () => {
    for (const source of AUTOMATIC_SOURCES.filter((s) => s !== "subdomains")) {
      expect(alwaysOnFrequenciesForSource(source)).toEqual(ALWAYS_ON_FREQUENCIES);
    }
  });
});

describe("alwaysOnFrequenciesFor", () => {
  test("empty below pro — the block stays read-only", () => {
    for (const source of AUTOMATIC_SOURCES) {
      expect(alwaysOnFrequenciesFor("free", source)).toEqual([]);
      expect(alwaysOnFrequenciesFor("starter", source)).toEqual([]);
    }
  });

  test("pro and business get daily + weekly", () => {
    for (const plan of ["pro", "business"] as const) {
      expect([...alwaysOnFrequenciesFor(plan, "news")].sort()).toEqual(["daily", "weekly"]);
    }
  });

  test("no upgrade unpins a source-locked cadence", () => {
    for (const plan of ["pro", "business"] as const) {
      expect(alwaysOnFrequenciesFor(plan, "subdomains")).toEqual(["weekly"]);
    }
  });

  test("never returns a cadence the plan's own frequency gate would refuse", () => {
    // The API checks this list first and isFrequencyAllowed right after; a value in
    // one and not the other would be a 403 on a control the UI rendered as available.
    for (const plan of PLANS) {
      for (const source of AUTOMATIC_SOURCES) {
        for (const freq of alwaysOnFrequenciesFor(plan, source)) {
          expect(planIncludesFrequency(plan, freq)).toBe(true);
        }
      }
    }
  });
});

describe("effectiveFrequencyFor", () => {
  test("pro keeps a sped-up always-on source at daily", () => {
    expect(effectiveFrequencyFor("pro", "news", "daily")).toBe("daily");
  });

  test("a pro → starter downgrade drops it back to the seed cadence", () => {
    // starter allows `daily` for the sources it pays for, so clampFrequencyToPlan alone
    // would have kept the anchor running daily. This is the case that needs the source
    // type, not just the plan.
    expect(effectiveFrequencyFor("starter", "news", "daily")).toBe("weekly");
    expect(effectiveFrequencyFor("free", "news", "daily")).toBe("weekly");
  });

  test("every always-on source falls back to its own seed cadence", () => {
    for (const source of AUTOMATIC_SOURCES) {
      expect(effectiveFrequencyFor("free", source, "realtime")).toBe(seedFrequencyFor(source));
    }
  });

  test("a source-locked cadence is enforced at reschedule, even on pro", () => {
    // No route can store this today; the clamp is what makes pinning a source later a
    // one-line change instead of a backfill over existing rows.
    expect(effectiveFrequencyFor("pro", "subdomains", "daily")).toBe("weekly");
  });

  test("configurable sources are untouched — still the plain plan clamp", () => {
    expect(effectiveFrequencyFor("starter", "homepage", "daily")).toBe("daily");
    expect(effectiveFrequencyFor("free", "homepage", "daily")).toBe("weekly");
    expect(effectiveFrequencyFor("pro", "homepage", "realtime")).toBe("realtime");
  });
});
