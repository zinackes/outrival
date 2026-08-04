import { test, expect } from "bun:test";
import { parseFeed } from "../feeds/rss";
import { buildRoadmapDoc } from "../roadmap/snapshot";
import { docsIsland } from "../docs/openapi";
import { extractContent } from "../lib/extract-content";
import {
  buildChangelogIsland,
  docsTitleFromUrl,
  parseChangelogItems,
  parseDocsItems,
  parseRoadmapItems,
} from "./parse";
import { typeChangelogEntry, partitionByHeuristic } from "./changelog-type";
import { buildMonthSeries, detectShippingVelocityShift, previousMonthKey } from "./velocity";
import type { MonthPoint } from "./velocity";

// ── Ingestion: real feed formats, writer → reader round trip ─────────────────
// The island is built by the SAME function the changelog scraper calls, so a
// renamed field fails here rather than going quiet in production.

function snapshotOf(xml: string, feedUrl = "https://acme.com/feed.xml"): string {
  const items = parseFeed(xml);
  return `<!doctype html><html><body><section><h2>Changelog</h2></section>${buildChangelogIsland(
    feedUrl,
    items,
  )}</body></html>`;
}

test("ingests an RSS 2.0 changelog feed", () => {
  const items = parseChangelogItems(
    snapshotOf(`<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Acme Changelog</title>
      <item>
        <title>Breaking change: the v1 auth header is gone</title>
        <link>https://acme.com/changelog/auth</link>
        <guid>chg-42</guid>
        <pubDate>Wed, 01 May 2024 10:00:00 GMT</pubDate>
        <description><![CDATA[Requests must now send Authorization.]]></description>
      </item>
      <item>
        <title>Dark mode</title>
        <link>https://acme.com/changelog/dark</link>
        <guid>chg-43</guid>
        <pubDate>Tue, 30 Apr 2024 09:00:00 GMT</pubDate>
      </item>
    </channel></rss>`),
  );

  expect(items).toHaveLength(2);
  const auth = items.find((i) => i.externalId === "chg-42");
  expect(auth).toMatchObject({
    title: "Breaking change: the v1 auth header is gone",
    url: "https://acme.com/changelog/auth",
    publishedAt: "2024-05-01T10:00:00.000Z",
    body: "Requests must now send Authorization.",
  });
});

test("ingests an Atom feed, falling back to the entry id", () => {
  const items = parseChangelogItems(
    snapshotOf(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <title>Acme</title>
      <entry>
        <title>Launched billing</title>
        <id>tag:acme,2024:1</id>
        <link rel="alternate" href="https://acme.com/posts/billing"/>
        <published>2024-04-15T08:00:00Z</published>
      </entry>
    </feed>`),
  );

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    externalId: "tag:acme,2024:1",
    url: "https://acme.com/posts/billing",
    publishedAt: "2024-04-15T08:00:00.000Z",
  });
});

test("an entry whose title closes a script tag cannot break the island", () => {
  const items = parseChangelogItems(
    snapshotOf(`<?xml version="1.0"?><rss version="2.0"><channel>
      <item>
        <title>Fixed &lt;/script&gt; escaping in embeds</title>
        <guid>chg-1</guid>
      </item>
      <item><title>Second entry</title><guid>chg-2</guid></item>
    </channel></rss>`),
  );
  expect(items).toHaveLength(2);
  expect(items[0]?.title).toContain("</script>");
});

test("a changelog with no feed yields no items rather than guessed ones", () => {
  expect(parseChangelogItems("<html><body><h1>Changelog</h1><p>We ship a lot.</p></body></html>")).toEqual(
    [],
  );
});

test("duplicate feed guids collapse to one row", () => {
  const items = parseChangelogItems(
    snapshotOf(`<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>First</title><guid>same</guid></item>
      <item><title>Second</title><guid>same</guid></item>
    </channel></rss>`),
  );
  expect(items).toHaveLength(1);
  expect(items[0]?.title).toBe("First");
});

// ── Roadmap: the island rides along without touching the diff ────────────────

const PORTAL = {
  vendor: "canny" as const,
  url: "https://acme.canny.io/feature-requests",
  truncated: false,
  entries: [
    { id: "e1", title: "Dark mode", status: "planned", votes: 240, url: "https://acme.canny.io/p/dark" },
    { id: "e2", title: "SSO", status: "in progress", votes: 91, url: null },
  ],
};

test("ingests roadmap entries with their status", () => {
  const items = parseRoadmapItems(buildRoadmapDoc(PORTAL).html);
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    externalId: "e1",
    title: "Dark mode",
    status: "planned",
    itemType: "roadmap_entry",
    // A portal states a status, not a publication date. Stamping the capture time
    // would turn our scrape schedule into their shipping cadence.
    publishedAt: null,
  });
});

test("the roadmap island is invisible to the diff, so it cannot move a hash", () => {
  const doc = buildRoadmapDoc(PORTAL);
  const content = extractContent(doc.html, "roadmap");
  expect(content).not.toContain("outrival-roadmap");
  expect(content).not.toContain('"entries"');
  // The body a reader sees is unchanged by the island riding beside it.
  expect(content).toContain("Dark mode");
});

// ── Typing: the loud types are decided by keywords, in three languages ───────

test("types breaking changes, deprecations, security and fixes without a model", () => {
  expect(typeChangelogEntry({ title: "Breaking change: renamed the events API" })).toBe("breaking");
  expect(typeChangelogEntry({ title: "The /v1/users endpoint is deprecated" })).toBe("deprecation");
  expect(typeChangelogEntry({ title: "Security fix for CVE-2026-1234" })).toBe("security");
  expect(typeChangelogEntry({ title: "Fixed a crash when exporting CSV" })).toBe("fix");
});

test("types release notes written in French and German", () => {
  expect(typeChangelogEntry({ title: "Changement cassant sur l'API de facturation" })).toBe(
    "breaking",
  );
  expect(typeChangelogEntry({ title: "L'ancien webhook est obsolète" })).toBe("deprecation");
  expect(typeChangelogEntry({ title: "Breaking-Änderungen an der Suche" })).toBe("breaking");
  expect(typeChangelogEntry({ title: "Der alte Endpunkt ist veraltet" })).toBe("deprecation");
  expect(typeChangelogEntry({ title: "Fehlerbehebung im Editor" })).toBe("fix");
});

test("a line that both breaks and fixes is typed by what breaks", () => {
  expect(
    typeChangelogEntry({ title: "Fixes a breaking change in the deprecated auth endpoint" }),
  ).toBe("breaking");
});

test("an ordinary release note is left for the model", () => {
  expect(typeChangelogEntry({ title: "Dashboard filters now remember your last view" })).toBeNull();
  expect(typeChangelogEntry({ title: "v4.2.0" })).toBeNull();
});

test("the body decides when the title says nothing", () => {
  expect(
    typeChangelogEntry({ title: "v4.2.0", body: "This release deprecates the legacy SDK." }),
  ).toBe("deprecation");
});

test("partitioning sends only the untyped entries to the model", () => {
  const mk = (title: string) => ({
    externalId: title,
    title,
    url: null,
    publishedAt: null,
    body: null,
    status: null,
    itemType: null,
  });
  const { typed, untyped } = partitionByHeuristic([
    mk("Breaking change: new auth"),
    mk("Faster search"),
    mk("Fixed a rendering bug"),
  ]);
  expect(typed.map((t) => t.itemType)).toEqual(["breaking", "fix"]);
  expect(untyped.map((u) => u.title)).toEqual(["Faster search"]);
});

// ── Velocity: what must NOT fire is the point ────────────────────────────────

const OPTS = { threshold: 0.5, baselineMonths: 3, minBaselineItems: 8 };
const series = (...counts: number[]): MonthPoint[] =>
  counts.map((count, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, count }));

test("fires when the latest complete month crosses the band upward", () => {
  // Baseline 4/4/4 = 12 items, current 9 → 2.25x.
  const shift = detectShippingVelocityShift(series(4, 4, 4, 9), "2025-12", OPTS);
  expect(shift).toMatchObject({ month: "2026-04", count: 9, direction: "accelerating" });
  expect(shift?.baseline.map((b) => b.count)).toEqual([4, 4, 4]);
});

test("fires when shipping stops", () => {
  const shift = detectShippingVelocityShift(series(5, 4, 6, 1), "2025-12", OPTS);
  expect(shift).toMatchObject({ direction: "slowing", count: 1 });
});

test("does not fire under the item minimum — a three-entry feed has no cadence", () => {
  // Baseline 1/1/1 = 3 items, well under 8, even though 4 is 4x the average.
  expect(detectShippingVelocityShift(series(1, 1, 1, 4), "2025-12", OPTS)).toBeNull();
});

test("does not fire without enough history", () => {
  expect(detectShippingVelocityShift(series(4, 4, 12), "2025-12", OPTS)).toBeNull();
});

test("does not count months that predate the oldest entry we hold", () => {
  // A feed serving only its recent entries makes older months read as zero. Those
  // zeros are our blindness, not their silence — and counting them would report an
  // acceleration at a competitor shipping at a flat rate.
  expect(detectShippingVelocityShift(series(0, 0, 9, 10), "2026-03", OPTS)).toBeNull();
});

test("a sustained ramp is one piece of news, not one per month", () => {
  // 2026-04 crossed; 2026-05 is still elevated against a baseline that has not yet
  // absorbed it, and must stay silent.
  const first = detectShippingVelocityShift(series(4, 4, 4, 12), "2025-12", OPTS);
  expect(first?.month).toBe("2026-04");
  const second = detectShippingVelocityShift(series(4, 4, 4, 12, 13), "2025-12", OPTS);
  expect(second).toBeNull();
});

test("a dip and a genuine re-cross fire again", () => {
  const shift = detectShippingVelocityShift(series(4, 4, 4, 12, 4, 4, 13), "2025-12", OPTS);
  expect(shift).toMatchObject({ month: "2026-07", direction: "accelerating" });
});

test("a flat cadence never fires", () => {
  expect(detectShippingVelocityShift(series(5, 4, 6, 5), "2025-12", OPTS)).toBeNull();
});

// ── Series construction ──────────────────────────────────────────────────────

test("months with no release are real zeros inside the observed range", () => {
  expect(
    buildMonthSeries([{ month: "2026-01", count: 3 }, { month: "2026-04", count: 2 }], "2026-01", "2026-04"),
  ).toEqual([
    { month: "2026-01", count: 3 },
    { month: "2026-02", count: 0 },
    { month: "2026-03", count: 0 },
    { month: "2026-04", count: 2 },
  ]);
});

test("the series rolls over a year boundary", () => {
  expect(buildMonthSeries([], "2025-11", "2026-01").map((p) => p.month)).toEqual([
    "2025-11",
    "2025-12",
    "2026-01",
  ]);
});

test("the evaluated month is the last one that ENDED", () => {
  expect(previousMonthKey(new Date("2026-08-01T00:30:00Z"))).toBe("2026-07");
  expect(previousMonthKey(new Date("2026-01-15T12:00:00Z"))).toBe("2025-12");
});

// ── Docs: a listing with no dates, read as the difference between two captures ─
// The islands are built by the SAME function the docs scraper calls, so a renamed
// field fails here rather than going quiet in production.

function docsPage(payload: unknown): string {
  return `<!doctype html><html><body><section><h2>Docs</h2></section>${docsIsland(
    payload,
  )}</body></html>`;
}

const sitemapCapture = (pages: string[]) =>
  docsPage({ mode: "sitemap", docsRoot: "https://acme.com/docs", pages, hashes: [] });

test("the first docs capture publishes nothing", () => {
  // Three hundred pages that already existed are not three hundred things a vendor
  // documented today, and a docs index states no date we could file them under.
  const pages = ["https://acme.com/docs/intro", "https://acme.com/docs/api/rate-limits"];
  expect(parseDocsItems(sitemapCapture(pages), null)).toEqual([]);
});

test("a page that was not in the previous capture is a publication", () => {
  const before = sitemapCapture(["https://acme.com/docs/intro"]);
  const after = sitemapCapture([
    "https://acme.com/docs/intro",
    "https://acme.com/docs/api/rate-limits",
  ]);
  const items = parseDocsItems(after, before);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    externalId: "https://acme.com/docs/api/rate-limits",
    // The index publishes no titles, so the slug is the only honest one available.
    title: "Rate limits",
    itemType: "doc_page",
    // Never invented: `first_seen_at` is the true statement about a page appearing.
    publishedAt: null,
  });
});

test("a page that disappeared is not a publication either way", () => {
  const before = sitemapCapture(["https://acme.com/docs/a", "https://acme.com/docs/b"]);
  expect(parseDocsItems(sitemapCapture(["https://acme.com/docs/a"]), before)).toEqual([]);
});

test("a new operation in a published spec is the same fact in another shape", () => {
  const spec = (operations: { method: string; path: string }[]) =>
    docsPage({ mode: "openapi", specUrl: "https://acme.com/openapi.json", operations, schemas: [] });
  const items = parseDocsItems(
    spec([
      { method: "GET", path: "/v1/charges" },
      { method: "POST", path: "/v1/refunds" },
    ]),
    spec([{ method: "GET", path: "/v1/charges" }]),
  );
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ externalId: "POST /v1/refunds", itemType: "doc_endpoint" });
});

test("a vendor publishing a spec for the first time announces nothing", () => {
  // The mode flip replaces a page list with an operation list. Every line reads as
  // new, which is the phantom the scraper's own mode-flip guard exists to prevent.
  const after = docsPage({
    mode: "openapi",
    specUrl: "https://acme.com/openapi.json",
    operations: [{ method: "GET", path: "/v1/charges" }],
    schemas: [],
  });
  expect(parseDocsItems(after, sitemapCapture(["https://acme.com/docs/intro"]))).toEqual([]);
});

test("a docs title falls back to the URL when the slug says nothing", () => {
  expect(docsTitleFromUrl("https://acme.com/docs/api/rate-limits")).toBe("Rate limits");
  expect(docsTitleFromUrl("https://acme.com/docs/getting_started.html")).toBe("Getting started");
  expect(docsTitleFromUrl("https://acme.com/")).toBe("https://acme.com/");
});
