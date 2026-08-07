import { test, expect } from "bun:test";
import {
  digestGroups,
  digestHeadline,
  digestLabel,
  digestStats,
  digestSupportingPoints,
  isQuietDigest,
  quietSentence,
} from "../src/lib/digest-shape";
import { digestToMarkdown } from "../src/lib/digest-markdown";
import type { Digest, DigestContent } from "../src/lib/api";

const CONTENT: DigestContent = {
  temperature: "high",
  tldr: [
    "Supabase's $500M Series F intensifies pressure on our serverless Postgres.",
    "Their searchable field-level encryption narrows our security advantage.",
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
      category: "pricing",
      insight: "Citus published Azure pricing from $0.27 per hour.",
      so_what: "A cheap pay-as-you-go option erodes our cost advantage.",
    },
    {
      urgency: "action_required",
      competitor: "Supabase",
      category: "product",
      insight: "Supabase shipped searchable field-level encryption.",
      so_what: "It closes a security gap we used to lead on.",
    },
  ],
};

const DIGEST: Digest = {
  id: "d1",
  orgId: "o1",
  weekStart: "2026-07-06",
  weekEnd: "2026-07-13",
  content: CONTENT,
  temperature: "high",
  period: "weekly",
  sentAt: null,
  createdAt: "2026-07-13T09:00:00.000Z",
};

test("digestStats counts urgency bands and ranks movers by volume", () => {
  const stats = digestStats(CONTENT);
  expect(stats.moves).toBe(3);
  expect(stats.action).toBe(2);
  expect(stats.watch).toBe(1);
  expect(stats.fyi).toBe(0);
  expect(stats.movers).toEqual([
    { name: "Supabase", count: 2 },
    { name: "Citus Data", count: 1 },
  ]);
});

test("the headline is the first TL;DR point and the rest supports it", () => {
  expect(digestHeadline(CONTENT)).toBe(CONTENT.tldr[0]);
  expect(digestSupportingPoints(CONTENT)).toEqual([CONTENT.tldr[1]!]);
});

test("groups keep decision order and drop empty bands", () => {
  const groups = digestGroups(CONTENT);
  expect(groups.map((g) => g.urgency)).toEqual(["action_required", "watch"]);
  expect(groups[0]!.items).toHaveLength(2);
});

test("grouping preserves each section's index, which its resolved link is keyed on", () => {
  const groups = digestGroups(CONTENT);
  // The second "Needs an answer" item is section 2, not section 1: display order
  // must never be mistaken for payload order when pairing links.
  expect(CONTENT.sections.indexOf(groups[0]!.items[1]!)).toBe(2);
});

test("a quiet week is recognised and reports the work behind it", () => {
  const quiet: DigestContent = {
    temperature: "low",
    tldr: [],
    sections: [],
    quiet: { pages: 34, checks: 168 },
  };
  expect(isQuietDigest(quiet)).toBe(true);
  expect(quietSentence(quiet)).toBe("All quiet. We checked 34 pages 168 times and nothing moved.");
  // Rows stored before the counts were kept still read as a sentence.
  expect(quietSentence({ temperature: "low", tldr: [], sections: [] })).toBe(
    "All quiet. Nothing moved.",
  );
  expect(isQuietDigest(CONTENT)).toBe(false);
});

test("digestLabel reads a weekly brief as a range and a daily one as a day", () => {
  expect(digestLabel(DIGEST)).toBe("Jul 6 to Jul 13, 2026");
  expect(digestLabel({ ...DIGEST, period: "daily" })).toBe("Mon, Jul 6, 2026");
});

test("digestLabel names the stored dates, not the reader's timezone", () => {
  // weekStart is a bare "YYYY-MM-DD", which parses as UTC midnight. Reading it in
  // a zone west of Greenwich used to print the previous day, so a brief covering
  // Jul 6 to Jul 13 read as Jul 5 to Jul 12 — and differed between the server
  // render and the client's. The label is the stored week, wherever it is read.
  const inLA = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  expect(inLA(DIGEST.weekStart)).toBe("Jul 5");
  expect(digestLabel(DIGEST)).toBe("Jul 6 to Jul 13, 2026");
});

test("markdown export keeps the verdict first and the groups in decision order", () => {
  const md = digestToMarkdown(DIGEST);
  expect(md).toContain("# Competitive brief, Jul 6 to Jul 13, 2026");
  expect(md).toContain(`> ${CONTENT.tldr[0]}`);
  expect(md.indexOf("## Needs an answer")).toBeLessThan(md.indexOf("## Worth watching"));
  expect(md).toContain("### Supabase · funding");
  expect(md).toContain("→ It closes a security gap we used to lead on.");
  expect(md).toContain("**3 moves · 2 need an answer · 2 competitors · activity high**");
});

test("markdown export of a quiet week states the calm instead of emitting empty headings", () => {
  const md = digestToMarkdown({
    ...DIGEST,
    content: { temperature: "low", tldr: [], sections: [], quiet: { pages: 12, checks: 0 } },
  });
  expect(md).toContain("All quiet. We checked 12 pages and nothing moved.");
  expect(md).not.toContain("## Needs an answer");
});
