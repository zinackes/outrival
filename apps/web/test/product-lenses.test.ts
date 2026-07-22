import { test, expect, describe } from "bun:test";
import {
  lensOf,
  lensCounts,
  filterByLens,
  PRODUCT_SOURCES,
  PRODUCT_LENSES,
} from "../src/app/dashboard/competitors/[id]/competitor-detail/product-lenses";

// A realistic mixed feed: the sources this tab absorbed, plus sources that belong
// to other tabs and must not leak in.
const feed = [
  { id: "1", sourceType: "homepage" },
  { id: "2", sourceType: "changelog" },
  { id: "3", sourceType: "hackernews" },
  { id: "4", sourceType: "blog" },
  { id: "5", sourceType: "news" },
  { id: "6", sourceType: "youtube" },
  { id: "7", sourceType: "status" },
  { id: "8", sourceType: "comparison_page" },
  { id: "9", sourceType: "github_repo" },
  { id: "10", sourceType: "custom" },
  { id: "11", sourceType: "wellknown" },
  // Other tabs own these — never rendered here.
  { id: "x1", sourceType: "pricing" },
  { id: "x2", sourceType: "jobs" },
  { id: "x3", sourceType: "appstore_reviews" },
  { id: "x4", sourceType: "tech_stack" },
];

describe("lens mapping", () => {
  test("narrative is how they position, product is what they shipped", () => {
    expect(lensOf("homepage")).toBe("narrative");
    expect(lensOf("blog")).toBe("narrative");
    expect(lensOf("comparison_page")).toBe("narrative");
    expect(lensOf("changelog")).toBe("product");
    expect(lensOf("news")).toBe("product");
    expect(lensOf("status")).toBe("product");
    expect(lensOf("youtube")).toBe("social");
    expect(lensOf("hackernews")).toBe("social");
    expect(lensOf("github_repo")).toBe("social");
  });

  test("sources owned by another tab map to no lens", () => {
    for (const s of ["pricing", "jobs", "appstore_reviews", "trustpilot_public", "tech_stack"]) {
      expect(lensOf(s)).toBeNull();
    }
  });

  test("reddit and the retired review aggregators have no lens", () => {
    // C1 removed reddit from the enum; C3 retired the scraped aggregators.
    for (const s of ["reddit", "g2_reviews", "capterra_reviews", "playstore_reviews"]) {
      expect(lensOf(s)).toBeNull();
    }
  });

  test("every source this tab claims has a lens", () => {
    for (const s of PRODUCT_SOURCES) expect(lensOf(s)).not.toBeNull();
  });
});

describe("chips filter the same feed — no second query, no regression", () => {
  test("All is the mixed chronological feed, order untouched", () => {
    const all = filterByLens(feed, null);
    expect(all.map((c) => c.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  });

  test("the three lens counts sum to All", () => {
    const counts = lensCounts(feed);
    expect(counts).toEqual({ narrative: 4, product: 4, social: 3, all: 11 });
    expect(counts.narrative + counts.product + counts.social).toBe(counts.all);
  });

  test("each lens returns exactly its own sources", () => {
    expect(filterByLens(feed, "narrative").map((c) => c.sourceType)).toEqual([
      "homepage",
      "blog",
      "comparison_page",
      "custom",
    ]);
    expect(filterByLens(feed, "product").map((c) => c.sourceType)).toEqual([
      "changelog",
      "news",
      "status",
      "wellknown",
    ]);
    // Chronological order of the source feed is preserved, not regrouped by source.
    expect(filterByLens(feed, "social").map((c) => c.sourceType)).toEqual([
      "hackernews",
      "youtube",
      "github_repo",
    ]);
  });

  test("the lenses partition All — every item in exactly one chip", () => {
    const all = filterByLens(feed, null).map((c) => c.id).sort();
    const perLens = PRODUCT_LENSES.flatMap((l) => filterByLens(feed, l).map((c) => c.id)).sort();
    expect(perLens).toEqual(all);
  });

  test("an empty feed reports zeroes rather than throwing", () => {
    expect(lensCounts([])).toEqual({ narrative: 0, product: 0, social: 0, all: 0 });
    expect(filterByLens([], "social")).toEqual([]);
  });
});
