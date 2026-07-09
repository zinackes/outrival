import { describe, expect, test } from "bun:test";
import { renderAllQuietDigest } from "./digest";

// Lever 6 — the all-quiet weekly briefing. No AI call: the copy is templated
// straight from the week's scrape counts, so these lock the exact wording and
// the "checks omitted when unavailable/zero" behavior the digest job relies on.
describe("renderAllQuietDigest", () => {
  test("renders the pages + checks copy when both are known", () => {
    const html = renderAllQuietDigest({
      pages: 12,
      checks: 34,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
    });
    expect(html).toContain(
      "We checked 12 pages, 34 times this week. No significant moves — your market was calm.",
    );
  });

  test("checks=0 omits the 'times' clause entirely", () => {
    const html = renderAllQuietDigest({
      pages: 12,
      checks: 0,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
    });
    expect(html).toContain("We checked 12 pages this week. No significant moves");
    expect(html).not.toContain("times");
  });

  test("singular page/time wording", () => {
    const html = renderAllQuietDigest({
      pages: 1,
      checks: 1,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
    });
    expect(html).toContain("We checked 1 page, 1 time this week.");
  });

  test("includes the unsubscribe link only when a URL is given", () => {
    const withLink = renderAllQuietDigest({
      pages: 3,
      checks: 0,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
      unsubscribeUrl: "https://api.outrival.io/api/digest-feedback/unsubscribe?token=abc",
    });
    expect(withLink).toContain("Unsubscribe");
    expect(withLink).toContain("https://api.outrival.io/api/digest-feedback/unsubscribe?token=abc");

    const withoutLink = renderAllQuietDigest({
      pages: 3,
      checks: 0,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
    });
    expect(withoutLink).not.toContain("Unsubscribe");
  });

  test("makes no network/AI call — pure string templating", () => {
    // Sanity check: calling it synchronously (no await) proves it can't be
    // doing an async provider call under the hood.
    const html = renderAllQuietDigest({
      pages: 0,
      checks: 0,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
    });
    expect(typeof html).toBe("string");
    expect(html).toContain("We checked 0 pages this week.");
  });
});
