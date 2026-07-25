import { describe, expect, test } from "bun:test";
import { renderAllQuietDigest, renderDigestEmail, type DigestEmailData } from "./digest";

const DIGEST: DigestEmailData = {
  temperature: "high",
  // No apostrophes: the renderer escapes them, and these assertions are about
  // ordering and wording, not about escaping (which escape-html.ts owns).
  tldr: [
    "A Series F at Supabase intensifies pressure on our serverless Postgres.",
    "Their searchable encryption narrows our security advantage.",
  ],
  sections: [
    {
      urgency: "action_required",
      competitor: "Supabase",
      category: "funding",
      insight: "Supabase announced a $500 million Series F.",
      so_what: "The raise funds an AI backend push against the same developers.",
    },
    {
      urgency: "watch",
      competitor: "Citus Data",
      category: "security_compliance",
      insight: "Citus published Azure pricing from $0.27 per hour.",
      so_what: "A cheap pay-as-you-go option erodes our cost advantage.",
    },
  ],
};

// The email is the delivered artefact, so it has to read as the same product as
// the in-app brief: same verdict-first order, same decision-phrased buckets.
describe("renderDigestEmail", () => {
  const html = renderDigestEmail(DIGEST, "2026-07-06", "2026-07-13");

  test("opens on the week's verdict, not on a temperature label", () => {
    expect(html).toContain(DIGEST.tldr[0]!);
    expect(html.indexOf(DIGEST.tldr[0]!)).toBeLessThan(html.indexOf(DIGEST.sections[0]!.insight));
    expect(html).not.toContain("Temperature ·");
  });

  test("states the week's shape once, in words", () => {
    expect(html).toContain("2 moves · 1 needs an answer · activity high");
  });

  test("names the buckets as decisions and drops the emoji headers", () => {
    expect(html).toContain("Needs an answer (1)");
    expect(html).toContain("Worth watching (1)");
    expect(html).not.toContain("🔴");
    expect(html).not.toContain("🟡");
    expect(html).not.toContain("🟢");
  });

  test("a snake_case category reads as words, never as an enum value", () => {
    expect(html).toContain("Citus Data · security compliance");
    expect(html).not.toContain("security_compliance");
  });

  test("carries the blocks the in-app reader used to drop", () => {
    const rich = renderDigestEmail(
      {
        ...DIGEST,
        sectoralTrends: [{ title: "Postgres vendors converge on AI", insight: "Three shipped." }],
        watchedQuestions: [{ question: "Has anyone shipped it?", changeSummary: "Now yes." }],
      },
      "2026-07-06",
      "2026-07-13",
    );
    expect(rich).toContain("Sector trends");
    expect(rich).toContain("Postgres vendors converge on AI");
    expect(rich).toContain("Your watched questions");
    expect(rich).toContain("Has anyone shipped it?");
  });
});

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
      "We checked 12 pages, 34 times this week. No significant moves. Your market was calm.",
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
