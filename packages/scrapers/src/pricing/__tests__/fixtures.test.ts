import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { PricingStatus } from "@outrival/shared";
import { detectPricingSignals } from "../signals";
import { determineStatus } from "../determine-status";

const FIXTURES = join(import.meta.dir, "..", "__fixtures__");

function statusOf(name: string): PricingStatus {
  const html = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
  return determineStatus(detectPricingSignals(html)).status;
}

// End-to-end on real captured pricing pages (2026-06-01): detector + status
// logic must land each on the status the patch calls for. This is the
// "test on real fixtures, not theory" gate.
describe("pricing taxonomy on real fixtures", () => {
  test.each<[string, PricingStatus]>([
    ["linear", "public"],
    ["notion", "public_partial"],
    ["crayon", "gated_demo"],
    ["segment", "dynamic"],
  ])("%s → %s", (name, expected) => {
    expect(statusOf(name)).toBe(expected);
  });
});
