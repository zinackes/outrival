import { test, expect, describe } from "bun:test";
import {
  SOURCE_TYPES,
  SOURCE_BUCKETS,
  SOURCE_GROUPS,
  CONFIGURABLE_SOURCES,
  ALL_CONFIGURABLE_SOURCES,
  RETIRED_SOURCES,
  UNIMPLEMENTED_SOURCES,
  sourceBucket,
  isConfigurableSource,
  isAutomaticSource,
  isHiddenSource,
} from "./catalog";
import { PLANS, PLAN_LIMITS, planAllowsMonitorSource } from "../constants/plans";
import type { SourceType } from "../constants/sources";

describe("source catalog is a partition of SOURCE_TYPES", () => {
  const placed = Object.values(SOURCE_BUCKETS).flat();

  test("every enum value is placed in exactly one bucket", () => {
    // Exhaustive: a new source_type fails here until it is deliberately placed —
    // no source can be silently absent from the Sources page.
    const missing = SOURCE_TYPES.filter((s) => !placed.includes(s));
    expect(missing).toEqual([]);
  });

  test("no source appears in two buckets", () => {
    const seen = new Set<string>();
    const duplicated = placed.filter((s) => (seen.has(s) ? true : (seen.add(s), false)));
    expect(duplicated).toEqual([]);
  });

  test("no bucket holds a value that is not in the enum", () => {
    const phantom = placed.filter((s) => !SOURCE_TYPES.includes(s));
    expect(phantom).toEqual([]);
  });

  test("sourceBucket is total over SourceType", () => {
    for (const s of SOURCE_TYPES) expect(() => sourceBucket(s)).not.toThrow();
  });
});

describe("the buckets encode the product rules", () => {
  test("groups list exactly the configurable sources, in order", () => {
    expect(SOURCE_GROUPS.flatMap((g) => CONFIGURABLE_SOURCES[g])).toEqual([
      ...ALL_CONFIGURABLE_SOURCES,
    ]);
  });

  test("no retired review aggregator is offered anywhere", () => {
    // Reviews v2 retired these for legal reasons; they must not resurface as a row.
    for (const s of RETIRED_SOURCES) {
      expect(isConfigurableSource(s)).toBe(false);
      expect(isAutomaticSource(s)).toBe(false);
      expect(isHiddenSource(s)).toBe(true);
    }
  });

  test("g2_reviews specifically has no row (no connected-vendor flow exists)", () => {
    expect(sourceBucket("g2_reviews")).toBe("retired");
  });

  test("reddit is gone from the enum entirely", () => {
    expect(SOURCE_TYPES.includes("reddit" as SourceType)).toBe(false);
  });

  test("sources without a scraper are never configurable", () => {
    // getScraper throws for these — a row would create a monitor that fails every
    // run and auto-pauses.
    for (const s of UNIMPLEMENTED_SOURCES) expect(isConfigurableSource(s)).toBe(false);
  });

  test("every configurable source can actually run on some plan", () => {
    // Guards the enable route's gate: a row the backend would always 403 is a lie.
    for (const s of ALL_CONFIGURABLE_SOURCES) {
      expect(PLANS.some((p) => planAllowsMonitorSource(p, s))).toBe(true);
    }
  });

  test("every plan-listed source is configurable", () => {
    // The reverse direction: a source a plan advertises must have a row to turn on.
    for (const p of PLANS) {
      for (const s of PLAN_LIMITS[p].allowedSources) {
        expect(isConfigurableSource(s)).toBe(true);
      }
    }
  });
});
