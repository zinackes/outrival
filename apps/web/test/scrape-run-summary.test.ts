import { describe, expect, test } from "bun:test";
import {
  scrapeRunProgress,
  scrapeRunSummary,
  type ScrapeRunOutcome,
} from "../src/lib/scrape-run-summary";

function run(partial: Partial<ScrapeRunOutcome> = {}): ScrapeRunOutcome {
  return {
    competitorName: "Acme",
    changed: [],
    unchanged: [],
    failed: [],
    pending: [],
    ...partial,
  };
}

describe("scrapeRunProgress", () => {
  test("names the competitor and counts sources", () => {
    expect(scrapeRunProgress("Acme", 3, 8)).toEqual({
      title: "Scanning Acme…",
      description: "3 of 8 sources checked",
    });
  });

  test("singular for a one-source run", () => {
    expect(scrapeRunProgress("Acme", 0, 1).description).toBe("0 of 1 source checked");
  });
});

describe("scrapeRunSummary", () => {
  test("updates win the headline, and every source is listed once", () => {
    const s = scrapeRunSummary(
      run({ changed: ["Pricing page"], unchanged: ["Homepage", "Blog"] }),
    );
    expect(s.kind).toBe("success");
    expect(s.title).toBe("Acme · 1 update");
    expect(s.description).toBe("Updated: Pricing page · No change: Homepage, Blog");
  });

  test("plural updates", () => {
    expect(scrapeRunSummary(run({ changed: ["Pricing page", "Blog"] })).title).toBe(
      "Acme · 2 updates",
    );
  });

  test("a run where nothing moved is info, not success", () => {
    const s = scrapeRunSummary(run({ unchanged: ["Homepage"] }));
    expect(s.kind).toBe("info");
    expect(s.title).toBe("Acme · nothing new");
  });

  test("a lone failure carries its reason, not a source list", () => {
    const s = scrapeRunSummary(
      run({ failed: [{ label: "Pricing page", reason: "The site refused us." }] }),
    );
    expect(s.kind).toBe("error");
    expect(s.title).toBe("Couldn't scan Acme");
    expect(s.description).toBe("Pricing page: The site refused us.");
  });

  test("several failures and nothing else: one error naming them all", () => {
    const s = scrapeRunSummary(
      run({
        failed: [
          { label: "Pricing page", reason: "The site refused us." },
          { label: "Blog", reason: "Timed out." },
        ],
      }),
    );
    expect(s.kind).toBe("error");
    expect(s.description).toBe("Failed: Pricing page, Blog");
  });

  test("a failure alongside sources that ran downgrades to a warning", () => {
    const s = scrapeRunSummary(
      run({ unchanged: ["Homepage"], failed: [{ label: "Blog", reason: "Timed out." }] }),
    );
    expect(s.kind).toBe("warning");
    expect(s.title).toBe("Acme · nothing new");
    expect(s.description).toBe("No change: Homepage · Failed: Blog");
  });

  test("a change plus a failure still reports the change first", () => {
    const s = scrapeRunSummary(
      run({ changed: ["Pricing page"], failed: [{ label: "Blog", reason: "Timed out." }] }),
    );
    expect(s.kind).toBe("success");
    expect(s.description).toBe("Updated: Pricing page · Failed: Blog");
  });

  test("nothing settled at all: the queue is behind, and it says so", () => {
    const s = scrapeRunSummary(run({ pending: ["Homepage", "Blog"] }));
    expect(s.kind).toBe("warning");
    expect(s.title).toBe("Acme · still queued");
    expect(s.description).toBe("Still queued: Homepage, Blog");
  });
});
