import { describe, expect, test } from "bun:test";
import type { SharedReport } from "../src/lib/report-outcome";
import {
  REPORT_FAILURE_COPY,
  reportFailureFromStatus,
  reportTitle,
  resolveReportView,
} from "../src/lib/report-outcome";

// OUT-189 — /report/[token] is read by someone outside the org. It used to answer
// every failure with "the link may have been revoked" (so an outage sent readers back
// to the sender for a link that was never broken), and it crashed outright on a
// payload that named a kind it didn't carry.

const landscape: SharedReport = {
  org: { name: "Acme" },
  product: { name: "Acme Cloud" },
  generatedAt: "2026-08-14T10:00:00.000Z",
  self: null,
  selfPricing: [],
  competitors: [],
  pricing: [],
  hiring: [],
  reviews: [],
  recentActivity: [],
  insights: [],
  kind: "landscape",
};

describe("reportFailureFromStatus", () => {
  test("404 is the link, not the server", () => {
    expect(reportFailureFromStatus(404)).toBe("revoked");
    expect(reportFailureFromStatus(410)).toBe("revoked");
  });

  test("every server-side status is retryable, not a dead link", () => {
    for (const status of [500, 502, 503, 504, 429, 400]) {
      expect(reportFailureFromStatus(status)).toBe("unavailable");
    }
  });

  test("the two screens tell the reader to do different things", () => {
    expect(REPORT_FAILURE_COPY.revoked.description).toContain("new one");
    expect(REPORT_FAILURE_COPY.unavailable.description).toContain("Refresh");
    expect(REPORT_FAILURE_COPY.revoked.title).not.toBe(REPORT_FAILURE_COPY.unavailable.title);
  });
});

describe("resolveReportView", () => {
  test("a landscape renders the matrix", () => {
    expect(resolveReportView(landscape)).toEqual({ view: "landscape" });
  });

  test("a payload with no kind is a landscape (links minted before the field)", () => {
    const { kind: _kind, ...legacy } = landscape;
    expect(resolveReportView(legacy)).toEqual({ view: "landscape" });
  });

  test("kind:recap with no recap is incomplete, not a landscape", () => {
    // The crash: the landscape branch reads `pricing` and `competitors`, which a recap
    // payload never carries.
    const orphan = { kind: "recap", org: { name: "Acme" } } as unknown as SharedReport;
    expect(resolveReportView(orphan)).toEqual({ view: "incomplete" });
  });

  test("kind:recap with a recap hands the recap over narrowed", () => {
    const recap = { month: { key: "2026-07", label: "July 2026" } } as SharedReport["recap"];
    expect(resolveReportView({ ...landscape, kind: "recap", recap })).toEqual({
      view: "recap",
      recap: recap!,
    });
  });

  test("kind:battle_card needs both the content and the competitor", () => {
    const content = { their_strengths: [] } as unknown as SharedReport["content"];
    expect(resolveReportView({ ...landscape, kind: "battle_card", content })).toEqual({
      view: "incomplete",
    });
    expect(
      resolveReportView({
        ...landscape,
        kind: "battle_card",
        content,
        competitor: { name: "Globex" },
      }),
    ).toEqual({ view: "battle_card", content: content!, competitor: { name: "Globex" } });
  });

  test("a landscape missing its lists is incomplete rather than a crash", () => {
    const truncated = { kind: "landscape", org: { name: "Acme" } } as unknown as SharedReport;
    expect(resolveReportView(truncated)).toEqual({ view: "incomplete" });
  });
});

describe("reportTitle", () => {
  test("each share names itself (the tab used to say Competitive Snapshot for all three)", () => {
    const recap = { month: { key: "2026-07", label: "July 2026" } } as SharedReport["recap"];
    const content = { their_strengths: [] } as unknown as SharedReport["content"];

    expect(reportTitle(landscape)).toBe("Acme · Competitive snapshot");
    expect(reportTitle({ ...landscape, kind: "recap", recap })).toBe("Acme · July 2026 recap");
    expect(
      reportTitle({
        ...landscape,
        kind: "battle_card",
        content,
        competitor: { name: "Globex" },
      }),
    ).toBe("Acme Cloud vs Globex");
  });

  test("a battle card with no product falls back to the org", () => {
    const content = { their_strengths: [] } as unknown as SharedReport["content"];
    expect(
      reportTitle({
        ...landscape,
        product: null,
        kind: "battle_card",
        content,
        competitor: { name: "Globex" },
      }),
    ).toBe("Acme vs Globex");
  });

  test("no '| Outrival' suffix — the root template adds it", () => {
    expect(reportTitle(landscape)).not.toContain("Outrival");
  });
});
