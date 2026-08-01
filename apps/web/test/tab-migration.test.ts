import { test, expect, describe } from "bun:test";
import {
  resolveTabParam,
  TAB_KEYS,
} from "../src/app/dashboard/competitors/[id]/competitor-detail/tab-migration";

describe("the competitor page has seven reading tabs", () => {
  test("grouped by meaning, in display order", () => {
    expect(TAB_KEYS).toEqual([
      "overview",
      "activity",
      "pricing",
      "hiring",
      "reviews",
      // Content Intelligence v2 P4. Sits beside Positioning: both answer "what
      // are they saying".
      "content",
      "product",
    ]);
  });

  test("every current tab resolves to itself", () => {
    for (const key of TAB_KEYS) {
      expect(resolveTabParam(key)).toEqual({ kind: "tab", tab: key });
    }
  });
});

describe("retired ?tab= deep links still land somewhere", () => {
  test("?tab=content is a real tab again, not a redirect", () => {
    // It was retired into Product & Positioning, then rebuilt as its own tab
    // (Content Intelligence v2 P4). The old notification rows carrying
    // ?tab=content were written about blog and changelog changes, so landing on
    // the Content tab is where they were always trying to go.
    expect(resolveTabParam("content")).toEqual({ kind: "tab", tab: "content" });
  });

  test("?tab=custom opens Product & Positioning too", () => {
    expect(resolveTabParam("custom")).toEqual({ kind: "tab", tab: "product" });
  });

  test("?tab=techstack opens Overview, where the tech stack card now lives", () => {
    expect(resolveTabParam("techstack")).toEqual({ kind: "tab", tab: "overview" });
  });

  test("?tab=battlecard routes to the battle card page", () => {
    // generate-battle-card writes this link into notifications.link_url, so rows
    // already in the database point at it — it can never simply 404.
    expect(resolveTabParam("battlecard")).toEqual({ kind: "route", segment: "battle-card" });
  });

  test("an unknown or absent value keeps the default tab rather than blanking", () => {
    expect(resolveTabParam(null)).toBeNull();
    expect(resolveTabParam("")).toBeNull();
    expect(resolveTabParam("nope")).toBeNull();
  });
});
