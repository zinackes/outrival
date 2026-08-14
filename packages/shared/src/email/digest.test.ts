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

  // patch-20 — the CTA back into the app, measurable via the src tag it carries.
  // Ordering matters as much as presence: a CTA below the unsubscribe/feedback
  // footer is a CTA nobody sees, so this asserts position, not just presence.
  test("readUrl renders a CTA above the feedback block", () => {
    const withCta = renderDigestEmail(
      DIGEST,
      "2026-07-06",
      "2026-07-13",
      {
        useful: "https://api.outrival.io/api/digest-feedback?token=u",
        notUseful: "https://api.outrival.io/api/digest-feedback?token=n",
      },
      undefined,
      undefined,
      "https://outrival.app/dashboard/digests/abc?src=digest_weekly",
    );
    expect(withCta).toContain("https://outrival.app/dashboard/digests/abc?src=digest_weekly");
    expect(withCta).toContain("Open the full briefing");
    const ctaIndex = withCta.indexOf("Open the full briefing");
    const feedbackIndex = withCta.indexOf("Was this briefing useful?");
    // Assert both markers actually exist before comparing positions: an
    // indexOf of -1 on either side would make the ordering check pass
    // vacuously and silently stop guarding the placement.
    expect(ctaIndex).toBeGreaterThanOrEqual(0);
    expect(feedbackIndex).toBeGreaterThanOrEqual(0);
    expect(ctaIndex).toBeLessThan(feedbackIndex);
  });

  test("without readUrl, no CTA is rendered", () => {
    expect(html).not.toContain("Open the full briefing");
  });

  test("a readUrl with & and \" is escaped, not injected raw", () => {
    const withCta = renderDigestEmail(
      DIGEST,
      "2026-07-06",
      "2026-07-13",
      undefined,
      undefined,
      undefined,
      'https://outrival.app/dashboard/digests/abc?src=digest_weekly&x="y"',
    );
    expect(withCta).toContain("&amp;x=&quot;y&quot;");
    expect(withCta).not.toContain('&x="y"');
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

  // patch-20 — the CTA back into the app; the all-quiet email's job is to prove
  // work happened, so its CTA leads to the evidence rather than an empty feed.
  // Ordering matters as much as presence: a CTA below the footer is unseen.
  test("readUrl renders a CTA pointing at the evidence", () => {
    const html = renderAllQuietDigest({
      pages: 12,
      checks: 34,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
      readUrl: "https://outrival.app/dashboard/digests/abc?src=digest_allquiet",
    });
    expect(html).toContain("https://outrival.app/dashboard/digests/abc?src=digest_allquiet");
    expect(html).toContain("See what we checked");
    const ctaIndex = html.indexOf("See what we checked");
    const footerIndex = html.indexOf("Outrival · Automated competitive intelligence");
    // Both markers must exist before comparing positions, or a vacuous -1
    // comparison would pass and stop guarding the placement.
    expect(ctaIndex).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeGreaterThanOrEqual(0);
    expect(ctaIndex).toBeLessThan(footerIndex);
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

// OUT-172 — the accumulated memory block. It is the only part of a brief that is
// worth anything next Monday, and the all-quiet email is where it earns its place:
// a week with nothing in it is exactly the week that reads as "is this running?".
describe("the accumulated memory block", () => {
  const STORIES = [
    {
      competitorId: "c1",
      competitor: "Supabase",
      since: "2026-03-03T09:00:00.000Z",
      sinceLabel: "Mar 3, 2026",
      total: 7,
      facts: [
        {
          category: "pricing",
          before: "Pro · $25/mo",
          after: "Pro · $29/mo",
          at: "2026-05-02T09:00:00.000Z",
          ago: "3 months ago",
        },
        {
          category: "security_compliance",
          before: null,
          after: "SOC 2 Type II published",
          at: "2026-07-20T09:00:00.000Z",
          ago: "3 weeks ago",
        },
      ],
    },
  ];

  test("a quiet week still tells the reader what they know", () => {
    const html = renderAllQuietDigest({
      pages: 12,
      checks: 34,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
      competitorStories: STORIES,
      competitorStoriesOmitted: 2,
      readUrl: "https://outrival.app/dashboard/digests/abc",
    });
    expect(html).toContain("What you know now");
    expect(html).toContain("Watched since Mar 3, 2026 · 7 changes");
    expect(html).toContain("Pro · $29/mo");
    expect(html).toContain("3 weeks ago");
    // A category is pipeline vocabulary; the email spells it as words.
    expect(html).toContain("security compliance");
    expect(html).toContain("+2 more competitors with a history on file");
    // Above the CTA and the footer, or it is never read.
    expect(html.indexOf("What you know now")).toBeLessThan(
      html.indexOf("Outrival · Automated competitive intelligence"),
    );
  });

  test("a first capture states the fact without inventing a before", () => {
    const html = renderAllQuietDigest({
      pages: 1,
      checks: 1,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
      competitorStories: STORIES,
    });
    const fact = html.slice(html.indexOf("SOC 2 Type II published") - 200);
    expect(fact).not.toContain("&rarr;</span> SOC 2");
  });

  test("no story renders no section at all, in both emails", () => {
    const quiet = renderAllQuietDigest({
      pages: 1,
      checks: 1,
      weekStart: "2026-06-29",
      weekEnd: "2026-07-06",
      competitorStories: [],
      competitorStoriesOmitted: 0,
    });
    const weekly = renderDigestEmail(DIGEST, "2026-07-06", "2026-07-13");
    expect(quiet).not.toContain("What you know now");
    expect(weekly).not.toContain("What you know now");
  });

  test("the weekly brief carries it after the week's own blocks", () => {
    const html = renderDigestEmail(
      { ...DIGEST, competitorStories: STORIES, competitorStoriesOmitted: 0 },
      "2026-07-06",
      "2026-07-13",
    );
    expect(html).toContain("What you know now");
    expect(html.indexOf(DIGEST.sections[0]!.insight)).toBeLessThan(
      html.indexOf("What you know now"),
    );
    expect(html).not.toContain("more competitor");
  });
});

// Véracité Intelligence v2 P4 — the double-capture badge. The garde-fou is not
// "the badge renders correctly", it is "the digest is unchanged everywhere else":
// the field is optional, so every caller that doesn't set it must produce the same
// bytes it produced before P4, and a signal whose ledger row says pending,
// not_reproduced or skipped never reaches these tests with a field set at all.
describe("renderDigestEmail — verified badge", () => {
  const BADGED: DigestEmailData = {
    ...DIGEST,
    sections: [
      { ...DIGEST.sections[0]!, verification: { gapMinutes: 47 } },
      DIGEST.sections[1]!,
    ],
  };

  test("says the check with its measurement, on the verified row only", () => {
    const html = renderDigestEmail(BADGED, "2026-07-06", "2026-07-13");
    expect(html).toContain("Verified");
    expect(html).toContain("2 captures 47 min apart");
    // One badge, not one per section: the second signal was never verified.
    expect(html.split("2 captures").length - 1).toBe(1);
  });

  test("an unbadged digest is byte-identical to what it was before P4", () => {
    // The whole point of the field being optional. Every existing caller omits it,
    // and a skipped or not_reproduced outcome is an omission too.
    const before = renderDigestEmail(DIGEST, "2026-07-06", "2026-07-13");
    const explicitlyAbsent = renderDigestEmail(
      { ...DIGEST, sections: DIGEST.sections.map((s) => ({ ...s })) },
      "2026-07-06",
      "2026-07-13",
    );
    expect(explicitlyAbsent).toBe(before);
    expect(before).not.toContain("Verified");
  });

  test("badges the claim without a number when the gap was never measured", () => {
    // Both timestamps have to be stamped for an interval to exist. A confirmed row
    // missing one still earned the badge; it just cannot show a measurement.
    const html = renderDigestEmail(
      {
        ...DIGEST,
        sections: [{ ...DIGEST.sections[0]!, verification: { gapMinutes: null } }],
      },
      "2026-07-06",
      "2026-07-13",
    );
    expect(html).toContain("Verified");
    expect(html).not.toContain("captures");
  });

  test("the badge is the only thing the field adds to the row", () => {
    const before = renderDigestEmail(DIGEST, "2026-07-06", "2026-07-13");
    const after = renderDigestEmail(BADGED, "2026-07-06", "2026-07-13");
    // Same insight, same so-what, same order — the addition sits inside the row and
    // moves nothing else on the page (P4: additions, never a new panel).
    expect(after).toContain(DIGEST.sections[0]!.insight);
    expect(after).toContain(DIGEST.sections[1]!.so_what);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.replace(/\s*<div [^>]*>&#10003;&#10003; Verified[^<]*<\/div>/, "")).toBe(before);
  });
});
