import { test, expect, describe } from "bun:test";
import {
  SEEDABLE_SOURCES,
  DEFAULT_SEED_SOURCES,
  resolveSeedSources,
  seedableSourcesForPlan,
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
    // appstore_reviews / github_repo need a per-competitor URL, so a seeded row
    // could only ever fail.
    const stored = ["homepage", "appstore_reviews", "github_repo"] as SourceType[];
    expect(resolveSeedSources("business", stored)).toEqual(["homepage"]);
  });
});

describe("the seedable set stays honest", () => {
  test("every seedable source is one the user can configure", () => {
    for (const s of SEEDABLE_SOURCES) expect(isConfigurableSource(s)).toBe(true);
  });

  test("the built-in default is the full seedable set", () => {
    expect([...DEFAULT_SEED_SOURCES]).toEqual([...SEEDABLE_SOURCES]);
  });

  test("what a plan offers is what that plan is allowed to run", () => {
    for (const plan of ["free", "starter", "pro", "business"] as const) {
      for (const s of seedableSourcesForPlan(plan)) {
        expect(planAllowsMonitorSource(plan, s)).toBe(true);
      }
    }
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
