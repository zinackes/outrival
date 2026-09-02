import { describe, expect, test } from "bun:test";
import { pendingContentIngest } from "../src/lib/ingest-first-run";

/**
 * OUT-246 — the decision behind scrape-monitor's no-change catch-up for the content
 * listings.
 *
 * The bug it closes: blog / changelog / roadmap ingestion was enqueued from the
 * CHANGED-capture branch alone. A competitor whose first capture never reached the
 * ingest (job expired in the concurrency-1 AI lane, R2 read failed, monitor predates
 * the feature) was stuck for good — the listing does not move, the hash does not
 * move, and the no-change branch returned above the enqueue every week. The Content
 * tab stayed empty with no way back short of a manual "Re-scan".
 *
 * What is asserted here is the gate, not the enqueue: the run must be owed exactly
 * once per source, and never on a source whose ingest cannot read a standalone
 * capture.
 */

const stamped = (key: string) => ({ [key]: new Date().toISOString() });

describe("pendingContentIngest", () => {
  test("a listing whose ingest never ran is owed a catch-up", () => {
    expect(pendingContentIngest("blog", null)).toBe("blog");
    expect(pendingContentIngest("changelog", {})).toBe("changelog");
    expect(pendingContentIngest("roadmap", { someOtherKey: 1 })).toBe("roadmap");
  });

  test("the marker closes it, and only for its own source", () => {
    const meta = stamped("blogFirstRunAt");
    expect(pendingContentIngest("blog", meta)).toBeNull();
    // Same competitor, a changelog monitor: the phases shipped separately, so one
    // ingest having run says nothing about the other.
    expect(pendingContentIngest("changelog", meta)).toBe("changelog");
  });

  test("docs is outside the catch-up", () => {
    // Its ingest reads the DIFFERENCE between two captures — a docs index dates
    // nothing, so a newly documented page is only knowable as a delta. An unchanged
    // capture has none, and re-running it would write a baseline of the whole manual.
    expect(pendingContentIngest("docs", {})).toBeNull();
  });

  test("a non-content source is never owed one", () => {
    for (const source of ["sitemap", "homepage", "pricing", "jobs"]) {
      expect(pendingContentIngest(source, {})).toBeNull();
    }
  });

  test("a malformed marker reads as never-run rather than latching", () => {
    // A run that throws before its stamp must simply happen again on the next
    // capture; the same must hold for a key we cannot parse.
    expect(pendingContentIngest("blog", { blogFirstRunAt: "not-a-date" })).toBe("blog");
    expect(pendingContentIngest("blog", { blogFirstRunAt: 17 })).toBe("blog");
  });
});
