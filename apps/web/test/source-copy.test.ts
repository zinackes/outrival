import { test, expect, describe } from "bun:test";
import {
  sourceCopy,
  isConcerning,
} from "../src/app/dashboard/competitors/[id]/sources/source-copy";

describe("blocked: the message the collection doctrine forced us to rewrite", () => {
  const copy = sourceCopy({
    state: "blocked",
    sourceType: "homepage",
    fallbacks: ["jobs", "changelog", "Hacker News"],
  });

  test("says we stop, and never promises to route around the refusal", () => {
    expect(copy.message).toContain("blocks automated collection and we don't bypass it");
    // The old copy claimed "we're escalating" — under the doctrine we don't escalate
    // on a refusal at all, so that sentence described behaviour the product removed.
    expect(copy.message).not.toMatch(/escalat/i);
    expect(copy.message).not.toMatch(/retry|trying harder|work around/i);
  });

  test("names the open sources we read instead", () => {
    expect(copy.message).toContain("jobs, changelog, Hacker News");
    expect(copy.message).toContain("No action needed from you");
  });

  test("offers no action, because there is nothing honest to offer", () => {
    expect(copy.action).toBeNull();
    expect(copy.tone).toBe("limited");
  });

  test("with nothing else covered, it still doesn't invent a fallback", () => {
    const alone = sourceCopy({ state: "blocked", sourceType: "homepage", fallbacks: [] });
    expect(alone.message).not.toContain("instead");
    expect(alone.message).toContain("No action needed from you");
  });
});

describe("not available: neutral, and never counted as a gap", () => {
  test("a competitor with no public repo reads as a fact about them", () => {
    const copy = sourceCopy({ state: "not_available", sourceType: "github_repo" });
    expect(copy.message).toBe("No public repo for this competitor.");
    expect(copy.tone).toBe("neutral");
    expect(copy.action).toBeNull();
    // Never phrased as our failure.
    expect(copy.message).not.toMatch(/fail|error|couldn't|unable|blocked/i);
  });

  test("each surface gets its own plain sentence", () => {
    expect(sourceCopy({ state: "not_available", sourceType: "youtube" }).message).toBe(
      "No YouTube channel linked from their site.",
    );
    expect(sourceCopy({ state: "not_available", sourceType: "status" }).message).toBe(
      "They don't publish a status page.",
    );
  });

  test("it is not a concerning state", () => {
    expect(isConcerning("not_available")).toBe(false);
    expect(isConcerning("locked")).toBe(false);
    expect(isConcerning("not_configured")).toBe(false);
    expect(isConcerning("off")).toBe(false);
  });
});

describe("fixable: the only family that asks the user for something", () => {
  test("a redirected site offers Fix URL", () => {
    const copy = sourceCopy({
      state: "fixable",
      sourceType: "blog",
      failureCategory: "site_redirected",
    });
    expect(copy.message).toBe("This page now redirects to a different domain.");
    expect(copy.action).toBe("fix_url");
    expect(copy.tone).toBe("actionable");
  });

  test("an undiagnosed failure still offers Fix URL rather than a dead end", () => {
    const copy = sourceCopy({ state: "fixable", sourceType: "blog", failureCategory: null });
    expect(copy.message).toBe("We couldn't reach this page after several attempts.");
    expect(copy.action).toBe("fix_url");
  });
});

describe("the remaining states", () => {
  test("login and geo explain themselves without offering a false fix", () => {
    expect(sourceCopy({ state: "login_required", sourceType: "jobs" }).message).toContain(
      "behind a login",
    );
    expect(sourceCopy({ state: "login_required", sourceType: "jobs" }).action).toBeNull();
    expect(sourceCopy({ state: "geo_blocked", sourceType: "pricing" }).message).toContain(
      "geo-restricted",
    );
  });

  test("a locked source is an upsell, not a failure", () => {
    const copy = sourceCopy({ state: "locked", sourceType: "jobs", minPlanLabel: "Starter" });
    expect(copy.message).toBe("Available on the Starter plan.");
    expect(copy.action).toBe("upgrade");
    expect(copy.tone).toBe("neutral");
  });

  test("tracking shows freshness", () => {
    expect(
      sourceCopy({ state: "tracking", sourceType: "homepage", freshness: "Scanned 2 hours ago" })
        .message,
    ).toBe("Scanned 2 hours ago");
  });

  test("only blocked / login / geo / fixable read as concerning", () => {
    expect(isConcerning("blocked")).toBe(true);
    expect(isConcerning("login_required")).toBe(true);
    expect(isConcerning("geo_blocked")).toBe(true);
    expect(isConcerning("fixable")).toBe(true);
    expect(isConcerning("tracking")).toBe(false);
    expect(isConcerning("pending")).toBe(false);
  });
});
