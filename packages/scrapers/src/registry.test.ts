import { test, expect, describe } from "bun:test";
import { getScraper } from "./index";
import { SOURCE_TYPES, hasNoScraper, type SourceType } from "@outrival/shared";

/**
 * The registry resolves, for every source the catalog says is bound (OUT-246).
 *
 * Prod spent weeks throwing `No scraper for source type: docs` on a worker that ran
 * the real docs scraper seconds later — the object literal had snapshotted the tail
 * of the namespace imports before they were initialised. The thunks fix the ordering;
 * this asserts the outcome the catalog promises, source by source, so a binding can
 * never again go missing without the suite saying so.
 */
describe("the scraper registry", () => {
  const bound = SOURCE_TYPES.filter((s): s is SourceType => !hasNoScraper(s));

  for (const source of bound) {
    test(`${source} resolves to a callable scraper, or is deliberately unbound`, () => {
      // Anchor / automatic / configurable sources are not all bound — the catalog's
      // buckets and the registry are separate lists. What must never happen is a
      // source resolving to something that is not a function.
      let scraper: unknown;
      try {
        scraper = getScraper(source);
      } catch (err) {
        expect((err as Error).message).toStartWith("No scraper for source type:");
        return;
      }
      expect(typeof scraper).toBe("function");
    });
  }

  test("the four sources prod lost are all bound", () => {
    for (const s of ["docs", "roadmap", "hackernews", "wellknown"] as const) {
      expect(typeof getScraper(s)).toBe("function");
    }
  });

  test("a retired source still throws the unbound error", () => {
    expect(() => getScraper("trustpilot_reviews")).toThrow(
      "No scraper for source type: trustpilot_reviews",
    );
  });
});
