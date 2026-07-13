import { test, expect, describe } from "bun:test";
import {
  algoliaSearchUrl,
  parseAlgoliaHits,
  classifyHits,
  buildHackerNewsDoc,
  parseDocHits,
  newQualifyingHits,
  isQualifying,
  hnThreadUrl,
} from "./hackernews";
import { collectHits } from "./hackernews.scraper";
import { extractContent, isContentCollapsed } from "../lib/extract-content";

// A trimmed but real-shaped HN Algolia `search_by_date` payload. Competitor:
// "Linear" (linear.app) — a deliberately AMBIGUOUS name (also "linear algebra",
// "linear regression"). Hits, one per homonym trap the source must survive:
//   111 show_hn  → the competitor's OWN launch, url on linear.app        → PREMIUM
//   222 homonym  → "Linear algebra", url on a math site (name in title)  → DROPPED (strict)
//   333 quiet    → mention on linear.app but only 12 points              → stored, silent
//   444 traction → mention on linear.app, 210 points                     → content/medium
//   555 offsite  → "Linear raises Series C" on techcrunch (name in title)→ DROPPED (strict) / kept (lenient)
const FIXTURE = JSON.stringify({
  nbHits: 5,
  nbPages: 1,
  hits: [
    {
      objectID: "111",
      title: "Show HN: Linear – issue tracking built for speed",
      url: "https://linear.app",
      author: "founder",
      points: 320,
      num_comments: 140,
      created_at_i: 1784000000,
      _tags: ["story", "show_hn", "author_founder", "story_111"],
    },
    {
      objectID: "222",
      title: "Linear algebra done right, explained",
      url: "https://math.example.com/linear-algebra",
      author: "prof",
      points: 500,
      num_comments: 90,
      created_at_i: 1784001000,
      _tags: ["story", "author_prof", "story_222"],
    },
    {
      objectID: "333",
      title: "Linear ships a new GraphQL API",
      url: "https://linear.app/changelog/graphql",
      author: "eng",
      points: 12,
      num_comments: 3,
      created_at_i: 1784002000,
      _tags: ["story", "author_eng", "story_333"],
    },
    {
      objectID: "444",
      title: "Linear's new usage-based pricing",
      url: "https://linear.app/pricing",
      author: "watcher",
      points: 210,
      num_comments: 88,
      created_at_i: 1784003000,
      _tags: ["story", "author_watcher", "story_444"],
    },
    {
      objectID: "555",
      title: "Linear raises Series C at $1.25B",
      url: "https://techcrunch.com/2026/07/10/linear-series-c",
      author: "press",
      points: 180,
      num_comments: 40,
      created_at_i: 1784004000,
      _tags: ["story", "author_press", "story_555"],
    },
  ],
});

const LINEAR = { name: "Linear", domain: "linear.app" as string | null };

describe("(a) parse a real search_by_date fixture", () => {
  test("endpoint is search_by_date, story-tagged, incrementally bounded", () => {
    const u = algoliaSearchUrl("Linear", 1781408000);
    expect(u).toContain("https://hn.algolia.com/api/v1/search_by_date");
    expect(u).toContain("query=Linear");
    expect(u).toContain("tags=story");
    expect(u).toContain(encodeURIComponent("created_at_i>1781408000"));
  });

  test("parseAlgoliaHits reads objectID/title/url/points/_tags from every hit", () => {
    const raw = parseAlgoliaHits(JSON.parse(FIXTURE));
    expect(raw).toHaveLength(5);
    expect(raw[0]).toMatchObject({
      objectID: "111",
      title: "Show HN: Linear – issue tracking built for speed",
      url: "https://linear.app",
      points: 320,
    });
    expect(raw[0]!._tags).toContain("show_hn");
  });

  test("a malformed / hit-less body yields [] (never throws)", () => {
    expect(parseAlgoliaHits(null)).toEqual([]);
    expect(parseAlgoliaHits({ error: "boom" })).toEqual([]);
  });
});

describe("(b) a Show HN of the competitor → exactly one product/high signal", () => {
  const hits = classifyHits(parseAlgoliaHits(JSON.parse(FIXTURE)), LINEAR);

  test("exactly one show_hn hit, forced product / high, thread URL attached", () => {
    const showHn = hits.filter((h) => h.kind === "show_hn");
    expect(showHn).toHaveLength(1);
    expect(showHn[0]).toMatchObject({
      objectID: "111",
      category: "product",
      severity: "high",
      threadUrl: hnThreadUrl("111"),
    });
  });

  test("on a fresh monitor it emits precisely that one Show HN as new", () => {
    const fresh = newQualifyingHits([], hits);
    const showHnNew = fresh.filter((h) => h.kind === "show_hn");
    expect(showHnNew).toHaveLength(1);
    expect(showHnNew[0]!.objectID).toBe("111");
  });
});

describe("(c) a homonym with no matching domain → no signal (strict is the default)", () => {
  const hits = classifyHits(parseAlgoliaHits(JSON.parse(FIXTURE)), LINEAR);

  test("the 'Linear algebra' story is dropped entirely, not just silenced", () => {
    expect(hits.find((h) => h.objectID === "222")).toBeUndefined();
    // The off-site press story (name in title, third-party domain) is dropped too.
    expect(hits.find((h) => h.objectID === "555")).toBeUndefined();
  });

  test("a payload of ONLY homonyms yields zero signals", () => {
    const homonyms = parseAlgoliaHits(JSON.parse(FIXTURE)).filter((h) =>
      ["222", "555"].includes(h.objectID),
    );
    const classified = classifyHits(homonyms, LINEAR);
    expect(classified).toHaveLength(0);
    expect(newQualifyingHits([], classified)).toHaveLength(0);
  });

  test("lenient mode (name confirmed unambiguous) DOES admit a name-in-title mention", () => {
    const lenient = classifyHits(parseAlgoliaHits(JSON.parse(FIXTURE)), {
      ...LINEAR,
      ambiguousName: false,
    });
    // 555 (techcrunch, "Linear raises Series C", 180 pts) now passes by name-in-title.
    expect(lenient.find((h) => h.objectID === "555")).toMatchObject({
      kind: "traction",
      category: "content",
      severity: "medium",
    });
    // "Linear algebra" also slips in under lenient — exactly why strict is the
    // default and lenient requires an explicit confirmation for THIS name.
    expect(lenient.find((h) => h.objectID === "222")).toBeDefined();
  });
});

describe("(d) dedup by stored objectID across two consecutive runs", () => {
  const run1 = classifyHits(parseAlgoliaHits(JSON.parse(FIXTURE)), LINEAR);
  const run1Doc = buildHackerNewsDoc("Linear", run1);

  test("re-running the exact same result emits no new signal", () => {
    const priorHits = parseDocHits(run1Doc.html);
    expect(newQualifyingHits(priorHits, run1)).toHaveLength(0);
  });

  test("a genuinely new Show HN next run emits exactly one new signal", () => {
    const raw = parseAlgoliaHits(JSON.parse(FIXTURE));
    raw.push({
      objectID: "999",
      title: "Show HN: Linear Insights – analytics",
      url: "https://linear.app/insights",
      author: "founder",
      points: 95,
      num_comments: 10,
      created_at_i: 1784100000,
      _tags: ["story", "show_hn", "author_founder", "story_999"],
    });
    const run2 = classifyHits(raw, LINEAR);
    const priorHits = parseDocHits(run1Doc.html);
    const fresh = newQualifyingHits(priorHits, run2);
    expect(fresh.map((h) => h.objectID)).toEqual(["999"]);
    expect(fresh[0]).toMatchObject({ kind: "show_hn", category: "product", severity: "high" });
  });
});

describe("(e) a story under the points threshold is stored but never signalled", () => {
  const hits = classifyHits(parseAlgoliaHits(JSON.parse(FIXTURE)), LINEAR);

  test("the 12-point mention is kept as below_threshold, not qualifying", () => {
    const quiet = hits.find((h) => h.objectID === "333");
    expect(quiet).toMatchObject({ kind: "below_threshold" });
    expect(isQualifying(quiet!.kind)).toBe(false);
  });

  test("it survives into the snapshot JSON island (stored) yet emits no signal", () => {
    const doc = buildHackerNewsDoc("Linear", hits);
    expect(parseDocHits(doc.html).find((h) => h.objectID === "333")).toBeDefined();
    expect(newQualifyingHits([], hits).find((h) => h.objectID === "333")).toBeUndefined();
  });
});

describe("deterministic snapshot properties", () => {
  const hits = classifyHits(parseAlgoliaHits(JSON.parse(FIXTURE)), LINEAR);

  test("order-independent (stable content hash)", () => {
    const a = buildHackerNewsDoc("Linear", hits);
    const b = buildHackerNewsDoc("Linear", [...hits].reverse());
    expect(a.html).toBe(b.html);
    expect(a.text).toBe(b.text);
  });

  test("a points tick does NOT change the hashed text (points excluded from the line)", () => {
    const bumped = hits.map((h) => ({ ...h, points: h.points + 500, numComments: h.numComments + 9 }));
    // Bumping points keeps every band unchanged (444 stays traction, 333 stays quiet)
    // so the hashed snapshot text is byte-identical → no phantom change.
    expect(buildHackerNewsDoc("Linear", bumped).text).toBe(buildHackerNewsDoc("Linear", hits).text);
  });
});

describe("scraper: empty HN presence is a valid (non-throwing) state", () => {
  test("no hits → an empty snapshot, never a throw (would mass-mark unscrapable)", async () => {
    const { name, hits } = await collectHits(
      "https://acme.com",
      { competitorName: "Acme" },
      { fetchJson: async () => ({ hits: [] }), now: 1784000000000 },
    );
    expect(name).toBe("Acme");
    expect(hits).toEqual([]);
    expect(buildHackerNewsDoc(name, hits).text).toContain("Hacker News mentions and Show HN launches for Acme");
  });

  test("an empty snapshot never grades as collapsed — even for a short name", () => {
    // COLLAPSE_FLOOR (30) on first capture throws → retries → markedUnscrapable. An
    // off-HN competitor (the common case) must survive: the header alone clears it.
    for (const name of ["X", "Acme", "Notion"]) {
      const { html } = buildHackerNewsDoc(name, []);
      expect(isContentCollapsed(extractContent(html, "hackernews"))).toBe(false);
    }
  });

  test("an unreachable Algolia throws so Trigger retries (no false-empty baseline)", async () => {
    await expect(
      collectHits(
        "https://acme.com",
        { competitorName: "Acme" },
        {
          fetchJson: async () => {
            throw new Error("hn algolia HTTP 503");
          },
          now: 1784000000000,
        },
      ),
    ).rejects.toThrow("503");
  });
});
