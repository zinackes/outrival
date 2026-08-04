import { test, expect, describe } from "bun:test";
import {
  SEEDABLE_SOURCES,
  SELECTABLE_DEFAULT_SOURCES,
  DETECTION_SEEDED_SOURCES,
  DEFAULT_SEED_SOURCES,
  resolveSeedSources,
  defaultSourcesForPlan,
  wantsDetectedSource,
  seedFrequencyFor,
} from "./defaults";
import { isConfigurableSource } from "./catalog";
import { planAllowsMonitorSource } from "../constants/plans";
import type { SourceType } from "../constants/sources";

describe("what a new competitor is seeded with", () => {
  test("a free workspace keeps exactly the pre-existing three sources", () => {
    // The whole safety argument for defaulting this ON: plan gating means free
    // orgs see no behaviour change and no extra scrape at all.
    expect(resolveSeedSources("free", null)).toEqual(["homepage", "pricing", "blog"]);
  });

  test("starter adds hiring, pro adds the developer surfaces", () => {
    expect(resolveSeedSources("starter", null)).toEqual([
      "homepage",
      "pricing",
      "blog",
      "jobs",
    ]);
    expect(resolveSeedSources("pro", null)).toEqual([
      "homepage",
      "pricing",
      "blog",
      "jobs",
      "docs",
      "roadmap",
    ]);
  });

  test("the homepage survives an org that opted out of everything", () => {
    // It anchors platform detection, profile extraction, pricing discovery and the
    // visual diff — dropping it would quietly disable half the pipeline.
    expect(resolveSeedSources("pro", [])).toEqual(["homepage"]);
  });

  test("an org's narrowed set is honoured", () => {
    expect(resolveSeedSources("pro", ["homepage", "jobs"])).toEqual(["homepage", "jobs"]);
  });

  test("a stored source above the plan waits instead of being seeded", () => {
    // Stored on purpose: it starts applying the day the org upgrades, which is what
    // the upgrade banner then has something to say about.
    expect(resolveSeedSources("free", ["homepage", "jobs", "docs"])).toEqual(["homepage"]);
    expect(resolveSeedSources("pro", ["homepage", "jobs", "docs"])).toEqual([
      "homepage",
      "jobs",
      "docs",
    ]);
  });

  test("a source that can't be seeded blind is ignored even if stored", () => {
    // github_repo needs a per-competitor URL nothing discovers; appstore_reviews is
    // stored on purpose but seeded from detection, never from this path.
    const stored = ["homepage", "appstore_reviews", "github_repo"] as SourceType[];
    expect(resolveSeedSources("business", stored)).toEqual(["homepage"]);
  });
});

describe("the seedable set stays honest", () => {
  test("every selectable source is one the user can configure", () => {
    for (const s of SELECTABLE_DEFAULT_SOURCES) expect(isConfigurableSource(s)).toBe(true);
  });

  test("the built-in default is the full selectable set", () => {
    expect([...DEFAULT_SEED_SOURCES]).toEqual([...SELECTABLE_DEFAULT_SOURCES]);
  });

  test("a detection-seeded source is offered but never seeded blind", () => {
    for (const s of DETECTION_SEEDED_SOURCES) {
      expect(SELECTABLE_DEFAULT_SOURCES).toContain(s);
      expect(SEEDABLE_SOURCES).not.toContain(s);
      expect(resolveSeedSources("business", null)).not.toContain(s);
    }
  });

  test("what a plan offers is what that plan is allowed to run", () => {
    for (const plan of ["free", "starter", "pro", "business"] as const) {
      for (const s of defaultSourcesForPlan(plan)) {
        expect(planAllowsMonitorSource(plan, s)).toBe(true);
      }
    }
  });
});

describe("detection-seeded sources", () => {
  test("an org that never customised its defaults wants them", () => {
    expect(wantsDetectedSource("appstore_reviews", null)).toBe(true);
  });

  test("an org that unticked one is honoured, and a neighbour doesn't re-enable it", () => {
    expect(wantsDetectedSource("appstore_reviews", ["homepage", "pricing"])).toBe(false);
    expect(wantsDetectedSource("appstore_reviews", ["homepage", "appstore_reviews"])).toBe(true);
  });

  test("a source nothing seeds from detection is never provisioned by that path", () => {
    // Stored or not: only DETECTION_SEEDED_SOURCES have a URL detection can resolve.
    expect(wantsDetectedSource("github_repo", ["github_repo"])).toBe(false);
    expect(wantsDetectedSource("docs", null)).toBe(false);
  });
});

describe("seed cadence", () => {
  test("slow surfaces are weekly, the live ones daily", () => {
    expect(seedFrequencyFor("homepage")).toBe("daily");
    expect(seedFrequencyFor("pricing")).toBe("daily");
    expect(seedFrequencyFor("jobs")).toBe("daily");
    // Blog stays weekly, as it was seeded before this change.
    expect(seedFrequencyFor("blog")).toBe("weekly");
    expect(seedFrequencyFor("docs")).toBe("weekly");
    expect(seedFrequencyFor("roadmap")).toBe("weekly");
  });

  test("anything unnamed falls to weekly, the safe side", () => {
    expect(seedFrequencyFor("sitemap")).toBe("weekly");
    expect(seedFrequencyFor("hackernews")).toBe("weekly");
  });
});
