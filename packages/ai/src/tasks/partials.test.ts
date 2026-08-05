import { describe, expect, test } from "bun:test";
import { zipAssessments } from "./classify-structured";
import { isEmptyProfile } from "./extract-self-profile";

// Audit §3.2, "partial persisted as valid" — the two shapes that parsed cleanly and
// were stored as successes while being nothing of the kind. Véracité v2 P3 turns both
// into parse misses, which the callers already know how to retry.

const change = (field: string) => ({ kind: "hero", field, before: "a", after: "b" });

describe("zipAssessments", () => {
  test("zips one significance per change, in the order the prompt asked for", () => {
    expect(zipAssessments([change("h1"), change("cta")], ["major", "trivial"])).toEqual([
      { ...change("h1"), significance: "major" },
      { ...change("cta"), significance: "trivial" },
    ]);
  });

  test("a short array is a parse failure, NOT a tail of fabricated 'minor'", () => {
    expect(zipAssessments([change("h1"), change("cta")], ["major"])).toBeNull();
  });

  test("a long array is a parse failure too — the indices no longer line up", () => {
    expect(zipAssessments([change("h1")], ["major", "minor"])).toBeNull();
  });
});

describe("isEmptyProfile", () => {
  const empty = { category: "", audience: "", valueProp: "", features: [], techStack: [] };

  test("an all-blank extraction is a miss, not a profile", () => {
    expect(isEmptyProfile(empty)).toBe(true);
    expect(isEmptyProfile({ ...empty, category: "   " })).toBe(true);
  });

  test("one field found is a partial extraction and stands", () => {
    expect(isEmptyProfile({ ...empty, category: "scheduling tool" })).toBe(false);
    expect(isEmptyProfile({ ...empty, features: ["calendar sync"] })).toBe(false);
    expect(isEmptyProfile({ ...empty, techStack: ["Postgres"] })).toBe(false);
  });
});
