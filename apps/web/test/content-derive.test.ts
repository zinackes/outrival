import { test, expect, describe } from "bun:test";
import type { ContentItemRow } from "../src/lib/api";
import {
  boardColumns,
  docsArea,
  docsSections,
  groupByMonth,
  kindGroups,
  viewFor,
} from "../src/app/dashboard/competitors/[id]/competitor-detail/content-derive";

/**
 * The four readings the Content tab gives one table (OUT-13).
 *
 * Each reading is a grouping decision, and a grouping decision is where a tab
 * quietly starts lying: an unrecognised roadmap column read as "planned" announces
 * a commitment that was a refusal, and a docs page filed under the month we scraped
 * it reports a vendor who documented their product this afternoon.
 */

let seq = 0;

function row(over: Partial<ContentItemRow> = {}): ContentItemRow {
  const n = ++seq;
  return {
    id: `ci-${n}`,
    sourceType: "blog",
    itemType: null,
    status: null,
    statusNormalized: null,
    votes: null,
    title: `Item ${n}`,
    url: `https://rival.com/p/${n}`,
    publishedAt: "2026-08-01T00:00:00.000Z",
    firstSeenAt: "2026-08-02T00:00:00.000Z",
    topics: [],
    summary: null,
    enriched: false,
    ...over,
  };
}

describe("viewFor", () => {
  test("each source gets the reading its entries are shaped like", () => {
    expect(viewFor("roadmap")).toBe("board");
    expect(viewFor("changelog")).toBe("releases");
    expect(viewFor("docs")).toBe("pages");
    // A blog IS a dated list, and so is the mixed view.
    expect(viewFor("blog")).toBe("feed");
    expect(viewFor("all")).toBe("feed");
  });
});

describe("boardColumns", () => {
  const entry = (statusNormalized: string | null, over: Partial<ContentItemRow> = {}) =>
    row({ sourceType: "roadmap", itemType: "roadmap_entry", statusNormalized, ...over });

  test("columns run in commitment order, and only the states holding an entry appear", () => {
    const columns = boardColumns([
      entry("delivered"),
      entry("under_review"),
      entry("in_progress"),
    ]);
    expect(columns.map((c) => c.status)).toEqual(["under_review", "in_progress", "delivered"]);
  });

  test("a status we do not recognise lands in Other, never in the nearest column", () => {
    // Reading an unknown label as `planned` would announce a shipping commitment
    // the portal never made.
    const columns = boardColumns([entry("shipping-in-2027"), entry(null)]);
    expect(columns).toHaveLength(1);
    expect(columns[0]?.status).toBe("other");
    expect(columns[0]?.items).toHaveLength(2);
  });

  test("the portal's own words ride along, deduped, unless they are our word twice", () => {
    const columns = boardColumns([
      entry("planned", { status: "up next" }),
      entry("planned", { status: "up next" }),
      entry("planned", { status: "shipping soon" }),
      entry("delivered", { status: "delivered" }),
    ]);
    const planned = columns.find((c) => c.status === "planned");
    expect(planned?.theirWords).toEqual(["up next", "shipping soon"]);
    // Saying "Delivered — delivered" is the same word printed twice.
    expect(columns.find((c) => c.status === "delivered")?.theirWords).toEqual([]);
  });

  test("cards rank on votes, and an entry with no count sorts below every one that has", () => {
    const columns = boardColumns([
      entry("planned", { title: "Quiet", votes: null }),
      entry("planned", { title: "Loudest", votes: 300 }),
      entry("planned", { title: "Loud", votes: 12 }),
    ]);
    expect(columns[0]?.items.map((i) => i.title)).toEqual(["Loudest", "Loud", "Quiet"]);
  });
});

describe("docsArea", () => {
  const page = (url: string) => row({ sourceType: "docs", itemType: "doc_page", url });

  test("the first segment that names something, past the housekeeping ones", () => {
    expect(docsArea(page("https://rival.com/docs/webhooks/retries"))).toBe("webhooks");
    expect(docsArea(page("https://rival.com/docs/api/v2/billing/invoices"))).toBe("billing");
    expect(docsArea(page("https://rival.com/en/reference/latest/sso"))).toBe("sso");
  });

  test("separators and page extensions are not part of the area's name", () => {
    expect(docsArea(page("https://rival.com/docs/getting-started.html"))).toBe("getting started");
    expect(docsArea(page("https://rival.com/docs/access_control/roles"))).toBe("access control");
  });

  test("an endpoint is placed by its PATH, since every operation shares one spec URL", () => {
    const endpoint = (title: string) =>
      row({
        sourceType: "docs",
        itemType: "doc_endpoint",
        title,
        url: "https://rival.com/openapi.json",
      });
    expect(docsArea(endpoint("POST /v1/charges"))).toBe("charges");
    // A path parameter names a variable, not a part of the product.
    expect(docsArea(endpoint("DELETE /v1/{customer}/subscriptions"))).toBe("subscriptions");
  });

  test("a path with nothing but housekeeping on it says so rather than guessing", () => {
    expect(docsArea(page("https://rival.com/docs/api/"))).toBe("Elsewhere");
  });
});

describe("docsSections", () => {
  test("biggest area first, and a section of endpoints knows it is endpoints", () => {
    const sections = docsSections([
      row({ sourceType: "docs", itemType: "doc_page", url: "https://r.com/docs/billing/a" }),
      row({ sourceType: "docs", itemType: "doc_page", url: "https://r.com/docs/billing/b" }),
      row({
        sourceType: "docs",
        itemType: "doc_endpoint",
        title: "GET /v1/webhooks",
        url: "https://r.com/spec.json",
      }),
    ]);
    expect(sections.map((s) => s.area)).toEqual(["billing", "webhooks"]);
    expect(sections[0]?.endpointsOnly).toBe(false);
    expect(sections[1]?.endpointsOnly).toBe(true);
  });
});

describe("groupByMonth", () => {
  test("undated items get their own trailing group, never this month's", () => {
    // Filing them under the month of OUR scrape would claim a publication date the
    // publisher never gave.
    const groups = groupByMonth([
      row({ publishedAt: "2026-08-01T00:00:00.000Z" }),
      row({ publishedAt: "2026-07-20T00:00:00.000Z" }),
      row({ publishedAt: null, firstSeenAt: "2026-08-03T00:00:00.000Z" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["August 2026", "July 2026", "Undated"]);
    expect(groups.at(-1)?.undated).toBe(true);
  });
});

describe("kindGroups", () => {
  const counts = [
    { sourceType: "changelog", itemType: "fix", count: 9 },
    { sourceType: "changelog", itemType: "breaking", count: 1 },
    { sourceType: "blog", itemType: "case_study", count: 4 },
    { sourceType: "blog", itemType: null, count: 6 },
  ];

  test("on a source, only that source's own vocabulary is on offer", () => {
    const groups = kindGroups(counts, "changelog");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.source).toBe("changelog");
    // Its own order, not frequency: `breaking` leads even at a count of one.
    expect(groups[0]?.kinds.map((k) => k.itemType)).toEqual(["breaking", "fix"]);
  });

  test("on All, kinds stay grouped under the source they belong to", () => {
    const groups = kindGroups(counts, "all");
    expect(groups.map((g) => g.source)).toEqual(["changelog", "blog"]);
    // Unread is a state, not a kind, so it sits last inside its source.
    expect(groups[1]?.kinds.map((k) => k.itemType)).toEqual(["case_study", null]);
  });
});
