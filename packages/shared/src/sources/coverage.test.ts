import { test, expect, describe } from "bun:test";
import {
  blockedReach,
  isRefused,
  sourceState,
  buildCoverage,
  coverageHeadline,
  fallbackSources,
  ATTENTION_OF,
  RIBBON_ATTENTIONS,
  type MonitorCoverageFields,
} from "./coverage";
import type { SourceType } from "../constants/sources";

const monitor = (over: Partial<MonitorCoverageFields> = {}): MonitorCoverageFields => ({
  sourceType: "homepage",
  isActive: true,
  markedUnscrapable: false,
  lastRunAt: "2026-07-20T10:00:00Z",
  ...over,
});

/** A monitor whose LAST run failed with `category` — the only state a diagnosis describes. */
const failed = (category: string): Partial<MonitorCoverageFields> => ({
  lastFailureCategory: category,
  lastFailedAt: "2026-07-20T10:05:00Z",
});

// The one predicate every surface asks: the competitor page, the Sources page, the
// Activity attention list and the API all read a refusal through it, so a red
// "failed, resume it" can no longer sit above a note saying we stop by design.
describe("isRefused", () => {
  test("an explicit refusal on the last run", () => {
    expect(isRefused(monitor({ refusedAt: "2026-07-20T10:05:00Z", markedUnscrapable: true }))).toBe(
      true,
    );
  });

  test("anti_bot with no refusedAt still counts", () => {
    expect(isRefused(monitor({ ...failed("anti_bot"), markedUnscrapable: true }))).toBe(true);
  });

  test("a later successful capture disproves an older refusal", () => {
    expect(
      isRefused(
        monitor({
          refusedAt: "2026-07-19T10:00:00Z",
          lastFailedAt: "2026-07-19T10:00:00Z",
          lastRunAt: "2026-07-20T10:00:00Z",
        }),
      ),
    ).toBe(false);
  });

  test("a transient failure is not a refusal", () => {
    expect(isRefused(monitor(failed("site_dead")))).toBe(false);
  });

  test("no monitor is not a refusal", () => {
    expect(isRefused(null)).toBe(false);
  });
});

// Which refusals are worth saying at the COMPETITOR level. A blocked blog is a
// footnote on its row; a blocked homepage changes what we know about them at all.
describe("blockedReach", () => {
  const cov = (over: Partial<Record<"tracked" | "pending" | "blocked", SourceType[]>>) =>
    buildCoverage([
      ...(over.tracked ?? []).map((s) => ({ sourceType: s, state: "tracking" as const })),
      ...(over.pending ?? []).map((s) => ({ sourceType: s, state: "pending" as const })),
      ...(over.blocked ?? []).map((s) => ({ sourceType: s, state: "blocked" as const })),
    ]);

  test("no refusal at all", () => {
    expect(blockedReach(cov({ tracked: ["homepage", "blog"] }))).toBe("none");
  });

  test("a blocked blog beside a healthy roster stays on its own row", () => {
    expect(
      blockedReach(cov({ tracked: ["homepage", "pricing", "jobs", "changelog"], blocked: ["blog"] })),
    ).toBe("partial");
  });

  test("a blocked homepage is competitor-level however much else works", () => {
    expect(
      blockedReach(cov({ tracked: ["blog", "jobs", "changelog", "docs"], blocked: ["homepage"] })),
    ).toBe("widespread");
  });

  test("most of what we watch refusing is competitor-level too", () => {
    expect(blockedReach(cov({ tracked: ["jobs"], blocked: ["blog", "changelog"] }))).toBe(
      "widespread",
    );
  });

  test("sources merely off or absent never inflate the reach", () => {
    // One blocked blog against one tracked source: without the denominator rule, a
    // barely-configured competitor would read as widely blocked.
    const c = buildCoverage([
      { sourceType: "homepage", state: "tracking" },
      { sourceType: "jobs", state: "not_configured" },
      { sourceType: "docs", state: "locked" },
      { sourceType: "status", state: "not_available" },
      { sourceType: "blog", state: "blocked" },
    ]);
    expect(blockedReach(c)).toBe("widespread");
    // …and with a second live source the same blocked blog drops back to a footnote.
    expect(
      blockedReach(
        buildCoverage([
          { sourceType: "homepage", state: "tracking" },
          { sourceType: "changelog", state: "tracking" },
          { sourceType: "jobs", state: "not_configured" },
          { sourceType: "blog", state: "blocked" },
        ]),
      ),
    ).toBe("partial");
  });
});

describe("sourceState", () => {
  test("a healthy monitor is tracking", () => {
    expect(sourceState({ sourceType: "homepage", plan: "pro", monitor: monitor() })).toBe("tracking");
  });

  test("a never-run monitor is pending, not a gap", () => {
    expect(
      sourceState({ sourceType: "homepage", plan: "pro", monitor: monitor({ lastRunAt: null }) }),
    ).toBe("pending");
  });

  test("a re-scrape in flight is pending", () => {
    expect(
      sourceState({
        sourceType: "homepage",
        plan: "pro",
        monitor: monitor({ scrapeStartedAt: "2026-07-20T11:00:00Z" }),
      }),
    ).toBe("pending");
  });

  test("an explicit refusal is blocked", () => {
    expect(
      sourceState({
        sourceType: "homepage",
        plan: "pro",
        monitor: monitor({ refusedAt: "2026-07-20T10:05:00Z", isActive: false, markedUnscrapable: true }),
      }),
    ).toBe("blocked");
  });

  test("anti_bot without refusedAt is still blocked", () => {
    expect(
      sourceState({
        sourceType: "pricing",
        plan: "pro",
        monitor: monitor({ sourceType: "pricing", lastFailureCategory: "anti_bot", markedUnscrapable: true }),
      }),
    ).toBe("blocked");
  });

  test("login and geo have their own states", () => {
    expect(
      sourceState({
        sourceType: "jobs",
        plan: "pro",
        monitor: monitor({ sourceType: "jobs", ...failed("login_required") }),
      }),
    ).toBe("login_required");
    expect(
      sourceState({
        sourceType: "jobs",
        plan: "pro",
        monitor: monitor({ sourceType: "jobs", ...failed("geo_blocked") }),
      }),
    ).toBe("geo_blocked");
  });

  test("a moved or dead site is fixable", () => {
    for (const category of ["site_redirected", "site_dead", "spa_empty", "unknown"]) {
      expect(
        sourceState({ sourceType: "blog", plan: "pro", monitor: monitor({ sourceType: "blog", ...failed(category) }) }),
      ).toBe("fixable");
    }
  });

  test("a capture since the diagnosis clears it — a recovered source is tracking", () => {
    // The failure columns are sticky: only the next failure overwrites them. A
    // homepage that failed once and has scraped fine ever since read "This page
    // appears to be down or gone." forever, next to a green last-scan.
    expect(
      sourceState({
        sourceType: "homepage",
        plan: "pro",
        monitor: monitor({
          ...failed("site_dead"),
          lastRunAt: "2026-07-20T12:00:00Z", // captured AFTER the failure
        }),
      }),
    ).toBe("tracking");
    // Same for a refusal the site has since lifted.
    expect(
      sourceState({
        sourceType: "homepage",
        plan: "pro",
        monitor: monitor({
          refusedAt: "2026-07-19T09:00:00Z",
          lastFailedAt: "2026-07-19T09:00:00Z",
          lastRunAt: "2026-07-20T12:00:00Z",
        }),
      }),
    ).toBe("tracking");
  });

  test("a user-paused source is off, but an auto-paused one is not", () => {
    expect(
      sourceState({ sourceType: "blog", plan: "pro", monitor: monitor({ sourceType: "blog", isActive: false }) }),
    ).toBe("off");
    // Auto-pause also clears isActive — it must not read as a deliberate choice.
    expect(
      sourceState({
        sourceType: "blog",
        plan: "pro",
        monitor: monitor({ sourceType: "blog", isActive: false, markedUnscrapable: true }),
      }),
    ).toBe("fixable");
  });
});

describe("NOT AVAILABLE is neutral, never a failure", () => {
  test("a competitor with no YouTube channel is not_available, not broken", () => {
    // The scraper throws "youtube: no_channel" — today that auto-pauses the monitor
    // and reads as a monitoring failure. It is simply a competitor without a channel.
    expect(
      sourceState({
        sourceType: "youtube",
        plan: "pro",
        monitor: monitor({
          sourceType: "youtube",
          lastError: "youtube: no_channel",
          markedUnscrapable: true,
          isActive: false,
        }),
      }),
    ).toBe("not_available");
  });

  test("a competitor publishing no developer docs is not_available", () => {
    expect(
      sourceState({
        sourceType: "docs",
        plan: "pro",
        monitor: monitor({
          sourceType: "docs",
          lastError: "docs: no_docs_surface",
          markedUnscrapable: true,
        }),
      }),
    ).toBe("not_available");
  });

  test("docs that exist but expose no index stays FIXABLE (the user can point us at it)", () => {
    // Deliberately NOT not_available: no_docs_index means we found their docs and
    // couldn't enumerate them, which a URL override fixes. Calling that "they have no
    // docs" would hide an actionable gap behind neutral copy.
    expect(
      sourceState({
        sourceType: "docs",
        plan: "pro",
        monitor: monitor({
          sourceType: "docs",
          lastError: "docs: no_docs_index",
          markedUnscrapable: true,
        }),
      }),
    ).toBe("fixable");
  });

  test("no resolvable status host is not_available", () => {
    expect(
      sourceState({
        sourceType: "status",
        plan: "pro",
        monitor: monitor({
          sourceType: "status",
          lastError: "status: no resolvable status host from https://acme.com",
          markedUnscrapable: true,
        }),
      }),
    ).toBe("not_available");
  });

  test("no Trustpilot profile is not_available", () => {
    expect(
      sourceState({
        sourceType: "trustpilot_public",
        plan: "pro",
        monitor: monitor({
          sourceType: "trustpilot_public",
          lastError: "No Trustpilot business unit for acme.com",
        }),
      }),
    ).toBe("not_available");
  });

  test("a private/absent GitHub repo is not_available", () => {
    expect(
      sourceState({
        sourceType: "github_repo",
        plan: "pro",
        monitor: monitor({
          sourceType: "github_repo",
          lastError: "GitHub repo not found or private: acme/api",
        }),
      }),
    ).toBe("not_available");
  });

  test("an unrelated failure on the same source stays a failure", () => {
    // no_channel is the neutral case; an unreachable feed is a real problem.
    expect(
      sourceState({
        sourceType: "youtube",
        plan: "pro",
        monitor: monitor({
          sourceType: "youtube",
          lastError: "youtube: feed_unreachable",
          ...failed("unknown"),
        }),
      }),
    ).toBe("fixable");
  });

  test("detection that found no status page marks it not_available with no monitor", () => {
    expect(
      sourceState({
        sourceType: "status",
        plan: "pro",
        monitor: null,
        targets: { statusPage: false, changelog: true },
      }),
    ).toBe("not_available");
  });

  test("without detection results, an absent monitor is only not_configured", () => {
    expect(sourceState({ sourceType: "status", plan: "pro", monitor: null })).toBe("not_configured");
  });
});

describe("plan gating", () => {
  test("a source above the plan is locked, not a gap", () => {
    expect(sourceState({ sourceType: "jobs", plan: "free", monitor: null })).toBe("locked");
  });

  test("the padlock wins over a stale monitor row after a downgrade", () => {
    expect(
      sourceState({
        sourceType: "appstore_reviews",
        plan: "free",
        monitor: monitor({ sourceType: "appstore_reviews" }),
      }),
    ).toBe("locked");
  });

  test("an ungated source is never locked", () => {
    expect(sourceState({ sourceType: "changelog", plan: "free", monitor: monitor({ sourceType: "changelog" }) })).toBe(
      "tracking",
    );
  });
});

describe("coverage summary", () => {
  const label = (s: SourceType) => s.replace(/_/g, " ");

  const coverage = buildCoverage([
    { sourceType: "homepage", state: "blocked" },
    { sourceType: "pricing", state: "tracking" },
    { sourceType: "blog", state: "tracking" },
    { sourceType: "changelog", state: "tracking" },
    { sourceType: "jobs", state: "tracking" },
    { sourceType: "status", state: "tracking" },
    { sourceType: "appstore_reviews", state: "pending" },
    { sourceType: "youtube", state: "not_available" },
    { sourceType: "github_repo", state: "not_available" },
    { sourceType: "trustpilot_public", state: "locked" },
  ]);

  test("not-applicable sources never enter the denominator", () => {
    expect(coverage.notApplicable).toEqual(["youtube", "github_repo"]);
    expect(coverage.tracked).not.toContain("youtube");
    expect(coverage.pending).not.toContain("github_repo");
  });

  test("the headline is positive and carries no ratio", () => {
    const line = coverageHeadline(coverage, label);
    expect(line).toBe("Tracking 6 sources · 1 blocked (homepage)");
    // The anxious framing this replaces: "6/9", "3 missing", "67% covered".
    expect(line).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(line).not.toMatch(/missing|gap|%/i);
  });

  test("a fully covered competitor gets no blocked clause", () => {
    const clean = buildCoverage([
      { sourceType: "homepage", state: "tracking" },
      { sourceType: "youtube", state: "not_available" },
    ]);
    expect(coverageHeadline(clean, label)).toBe("Tracking 1 source");
  });

  test("a blocked surface names the open sources we use instead", () => {
    // The differentiating angle: a protected homepage doesn't blind the product.
    expect(fallbackSources(coverage, "homepage")).toEqual([
      "pricing",
      "blog",
      "changelog",
      "jobs",
      "status",
      "appstore_reviews",
    ]);
  });
});

describe("a competitor added moments ago", () => {
  const label = (s: SourceType) => s.replace(/_/g, " ");

  // Every source enabled at creation, every first scrape still in flight.
  const justAdded = buildCoverage(
    (["homepage", "pricing", "blog", "changelog"] as SourceType[]).map((sourceType) => ({
      sourceType,
      state: "pending" as const,
    })),
  );

  test("says it is checking, rather than asserting unverified coverage", () => {
    expect(coverageHeadline(justAdded, label)).toBe("Checking 4 sources…");
  });

  test("pending sources still count as covered, never as gaps", () => {
    expect(justAdded.pending).toHaveLength(4);
    expect(justAdded.notApplicable).toEqual([]);
    expect(justAdded.blocked).toEqual([]);
  });

  test("as soon as one capture lands, the line flips to Tracking", () => {
    const partly = buildCoverage([
      { sourceType: "homepage", state: "blocked" },
      { sourceType: "pricing", state: "tracking" },
      { sourceType: "blog", state: "pending" },
      { sourceType: "status", state: "not_available" },
    ]);
    // The blocked homepage is named at once — and the still-unverified blog counts
    // as covered, so the pre-check never reads worse than reality.
    expect(coverageHeadline(partly, label)).toBe("Tracking 2 sources · 1 blocked (homepage)");
    expect(fallbackSources(partly, "homepage")).toEqual(["pricing", "blog"]);
  });
});

describe("attention grouping: a refusal is not a task", () => {
  test("only fixable is filed as something the user can do", () => {
    expect(ATTENTION_OF.fixable).toBe("fixable");
    // These three carry action: null in the copy layer precisely because the
    // collection doctrine says we stop rather than route around a refusal. Heading
    // them with a call to act would contradict the sentence printed inside them.
    expect(ATTENTION_OF.blocked).toBe("closed");
    expect(ATTENTION_OF.login_required).toBe("closed");
    expect(ATTENTION_OF.geo_blocked).toBe("closed");
  });

  test("a surface they don't have is its own group, never a failure", () => {
    expect(ATTENTION_OF.not_available).toBe("unavailable");
    expect(ATTENTION_OF.off).toBe("idle");
    expect(ATTENTION_OF.locked).toBe("idle");
    expect(ATTENTION_OF.not_configured).toBe("idle");
  });

  test("both covered states collapse into one group", () => {
    expect(ATTENTION_OF.tracking).toBe("collecting");
    expect(ATTENTION_OF.pending).toBe("collecting");
  });

  test("the ribbon leaves not-available out of the denominator", () => {
    expect(RIBBON_ATTENTIONS).not.toContain("unavailable");
    // Every other group is represented, so the bar always accounts for the whole
    // applicable set and can't silently drop a state.
    const covered = new Set<string>(RIBBON_ATTENTIONS);
    for (const attention of Object.values(ATTENTION_OF)) {
      if (attention !== "unavailable") expect(covered.has(attention)).toBe(true);
    }
  });
});
