import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeTextDiff } from "@outrival/shared";
import { extractContent } from "../lib/extract-content";
import { extractStateIsland, isCannyHost, parseCannyPortal } from "./canny";
import { matchProductboardPortal, parseProductboardPortal } from "./productboard";
import { buildRoadmapDoc, entryLine, sortEntries, voteBand } from "./snapshot";
import { discoverRoadmapPortal, looksLikePortalUrl, portalLinkIn } from "./discover";
import { scrape, type RoadmapDeps } from "./roadmap.scraper";
import type { RoadmapEntry } from "./types";

/**
 * The `roadmap` source's contract, in four parts:
 *   (a) each vendor's PUBLIC structure parses into a sorted entry list
 *   (b) a status move and a vote surge each surface as exactly one -/+ pair through
 *       the production diff path, while day-to-day vote drift surfaces as nothing
 *   (c) a private portal is marked as such, and never fakes a snapshot
 *   (d) every other "nothing to read" case degrades cleanly, also without a snapshot
 *
 * (b) deliberately runs `computeTextDiff(extractContent(before), extractContent(after))`
 * — the exact pair scrape-monitor calls on the generic path — rather than a parallel
 * differ, so the assertions are about what production will actually see.
 *
 * The two fixtures are REAL captures, reduced to a dozen entries each:
 *   canny-roadmap.html      — vendasta.canny.io (roadmap view, 3 statuses)
 *   productboard-portal.json — portal.productboard.com/pb/1-productboard-portal
 */

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

const CANNY_HTML = fixture("canny-roadmap.html");
const CANNY_URL = "https://vendasta.canny.io/";
const PB_JSON = fixture("productboard-portal.json");
const PB_URL = "https://portal.productboard.com/pb/1-productboard-portal/tabs/5-planned";
const PB_TARGET = matchProductboardPortal(PB_URL)!;

function portalOf(parse: ReturnType<typeof parseCannyPortal>) {
  if (!parse.ok) throw new Error(`expected a portal, got ${parse.reason}`);
  return parse.portal;
}

/** Rebuild a Canny page from a mutated state island, so edits stay realistic. */
function cannyPageWith(mutate: (state: Record<string, unknown>) => void): string {
  const state = extractStateIsland(CANNY_HTML);
  if (!state) throw new Error("fixture island did not parse");
  mutate(state);
  return `<!doctype html><html><body><script>window.__data = ${JSON.stringify(state)};</script></body></html>`;
}

/** Every post in the island, so tests can mutate one by title. */
function eachPost(state: Record<string, unknown>, fn: (post: Record<string, unknown>) => void) {
  for (const board of Object.values(state.posts as Record<string, Record<string, unknown>>)) {
    for (const post of Object.values(board)) fn(post as Record<string, unknown>);
  }
}

// --- (a) vendor parsing -----------------------------------------------------

describe("canny adapter", () => {
  test("recognises customer boards by host, not Canny's own site", () => {
    expect(isCannyHost("https://vendasta.canny.io/")).toBe(true);
    expect(isCannyHost("https://feedback.canny.io/feature-requests")).toBe(true);
    expect(isCannyHost("https://www.canny.io/pricing")).toBe(false);
    expect(isCannyHost("https://help.canny.io/en/articles/1")).toBe(false);
    expect(isCannyHost("https://canny.io/")).toBe(false);
    expect(isCannyHost("https://acme.com/roadmap")).toBe(false);
  });

  test("parses the state island despite the bare `undefined` Canny emits", () => {
    // The island is a JS object literal, not JSON — a strict JSON.parse fails on it.
    expect(CANNY_HTML).toContain("undefined");
    expect(() => JSON.parse(CANNY_HTML.slice(CANNY_HTML.indexOf("{")))).toThrow();
    expect(extractStateIsland(CANNY_HTML)).not.toBeNull();
  });

  test("reads the roadmap into entries carrying status, votes and a permalink", () => {
    const portal = portalOf(parseCannyPortal(CANNY_HTML, CANNY_URL));

    expect(portal.vendor).toBe("canny");
    expect(portal.entries).toHaveLength(12);
    // hasNextPage on the roadmap → the vendor served only part of it.
    expect(portal.truncated).toBe(true);

    const statuses = new Set(portal.entries.map((e) => e.status));
    expect(statuses).toEqual(new Set(["planned", "in progress", "complete"]));

    const entry = portal.entries.find((e) => e.title === "AI Assistant @ the Business App Level");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("planned");
    expect(entry!.votes).toBe(21);
    expect(entry!.id).toMatch(/^[a-f0-9]{24}$/);
    expect(entry!.url).toBe(
      "https://vendasta.canny.io/ai-workforce/p/ai-assistant-the-business-app-level",
    );
  });

  test("a page with no state island is unparsable, never an empty portal", () => {
    const res = parseCannyPortal("<html><body>Just a marketing page</body></html>", CANNY_URL);
    expect(res).toEqual({ ok: false, reason: "unparsable" });
  });
});

describe("productboard adapter", () => {
  test("extracts the portal path from any portal route", () => {
    expect(matchProductboardPortal(PB_URL)?.portalPath).toBe("pb/1-productboard-portal");
    expect(
      matchProductboardPortal("https://portal.productboard.com/pb/1-productboard-portal/c/195-x")
        ?.portalPath,
    ).toBe("pb/1-productboard-portal");
    expect(matchProductboardPortal(PB_URL)?.url).toBe(
      "https://portal.productboard.com/pb/1-productboard-portal",
    );
    expect(matchProductboardPortal("https://portal.productboard.com/")).toBeNull();
    expect(matchProductboardPortal("https://www.productboard.com/product-portal/")).toBeNull();
  });

  test("joins cards to the tabs that are their statuses", () => {
    const parsed = parseProductboardPortal(JSON.parse(PB_JSON), PB_TARGET);
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.portal.vendor).toBe("productboard");
    expect(parsed.portal.entries).toHaveLength(12);
    // The columns are named by the portal owner — no fixed vocabulary is assumed.
    expect(new Set(parsed.portal.entries.map((e) => e.status))).toEqual(
      new Set(["launched", "planned", "under consideration", "beta"]),
    );

    const card = parsed.portal.entries.find((e) => e.title === "Export timeline & column boards as PNG");
    expect(card).toBeDefined();
    expect(card!.status).toBe("launched");
    expect(card!.votes).toBe(21);
    expect(card!.url).toBe(
      "https://portal.productboard.com/pb/1-productboard-portal/c/790-export-timeline-column-boards-as-png",
    );
    // One response carries the whole portal — nothing is paged away.
    expect(parsed.portal.truncated).toBe(false);
  });

  test("a card with no tab assignment is not on the roadmap", () => {
    const payload = JSON.parse(PB_JSON);
    payload.portalCardAssignments = payload.portalCardAssignments.slice(0, 2);
    const parsed = parseProductboardPortal(payload, PB_TARGET);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.portal.entries).toHaveLength(2);
  });
});

// --- (b) the diff, through the production path ------------------------------

describe("vote banding", () => {
  test("bands are stable under drift and move on a surge", () => {
    expect(voteBand(0)).toBe(0);
    expect(voteBand(13)).toBe(13);
    // Drift: a handful of new votes stays inside the band.
    expect(voteBand(16)).toBe(voteBand(13));
    expect(voteBand(20)).toBe(voteBand(13));
    // Surge: ~+35% or more crosses it.
    expect(voteBand(22)).toBe(21);
    expect(voteBand(200)).toBe(144);
    // Never below zero, never fractional.
    expect(voteBand(-5)).toBe(0);
    expect(voteBand(Number.NaN)).toBe(0);
  });

  test("the exact count never reaches the diff-bearing body", () => {
    const line = entryLine({ id: "x", title: "Dark mode", status: "planned", votes: 137, url: null });
    expect(line).toBe("[planned] Dark mode — votes 89+");
    expect(line).not.toContain("137");
  });
});

describe("snapshot ordering", () => {
  test("sorts by stable id, so nothing moves when a status or vote changes", () => {
    const base: RoadmapEntry[] = [
      { id: "c", title: "Third", status: "planned", votes: 1, url: null },
      { id: "a", title: "First", status: "complete", votes: 900, url: null },
      { id: "b", title: "Second", status: "in progress", votes: 40, url: null },
    ];
    const order = sortEntries(base).map((e) => e.id);
    expect(order).toEqual(["a", "b", "c"]);

    // Re-sorting after a status flip + a vote surge yields the SAME order.
    const moved = base.map((e) => (e.id === "b" ? { ...e, status: "complete", votes: 4000 } : e));
    expect(sortEntries(moved).map((e) => e.id)).toEqual(order);
  });
});

describe("the production diff", () => {
  const diffOf = (beforeHtml: string, afterHtml: string) =>
    computeTextDiff(
      extractContent(beforeHtml, "roadmap"),
      extractContent(afterHtml, "roadmap"),
    );

  const docFor = (html: string) => buildRoadmapDoc(portalOf(parseCannyPortal(html, CANNY_URL))).html;

  const entryLinesIn = (blocks: string[]) =>
    blocks.flatMap((block) => block.split("\n")).filter((l) => l.startsWith("["));

  /**
   * The NET entry-level change. `diffLines` groups adjacent lines into blocks and can
   * re-emit an untouched neighbour inside an added block (a trailing insertion pulls
   * the previous line in with it), so comparing the two sides is what isolates the
   * lines that genuinely moved.
   */
  const netEntryChange = (diff: ReturnType<typeof computeTextDiff>) => {
    const gone = entryLinesIn(diff.removed);
    const appeared = entryLinesIn(diff.added);
    const goneSet = new Set(gone);
    const appearedSet = new Set(appeared);
    return {
      gone: gone.filter((l) => !appearedSet.has(l)),
      appeared: appeared.filter((l) => !goneSet.has(l)),
    };
  };

  test("a status move surfaces as exactly one -/+ pair, disturbing nothing else", () => {
    const before = docFor(CANNY_HTML);
    const after = docFor(
      cannyPageWith((state) =>
        eachPost(state, (p) => {
          if (p.title === "AI Assistant @ the Business App Level") p.status = "in progress";
        }),
      ),
    );

    const diff = diffOf(before, after);
    expect(diff.hasChanges).toBe(true);

    // Exactly one line left and one arrived — sorting by stable id is what buys this.
    // Ordered by votes or status, the moved entry would relocate and drag its
    // neighbourhood into the diff with it.
    const { gone, appeared } = netEntryChange(diff);
    expect(gone).toHaveLength(1);
    expect(appeared).toHaveLength(1);
    expect(gone[0]).toContain("[planned] AI Assistant @ the Business App Level");
    expect(appeared[0]).toContain("[in progress] AI Assistant @ the Business App Level");

    // The header's per-status counts moved with it, so the shape of the board is
    // readable in the diff without counting lines.
    expect(diff.removed.join("\n")).toContain("in progress: 4, planned: 4");
    expect(diff.added.join("\n")).toContain("in progress: 5, planned: 3");
  });

  test("a vote surge surfaces, and ordinary vote drift does not", () => {
    const bump = (votes: number) =>
      docFor(
        cannyPageWith((state) =>
          eachPost(state, (p) => {
            if (p.title === "AI Assistant @ the Business App Level") p.score = votes;
          }),
        ),
      );

    const before = docFor(CANNY_HTML); // 21 votes → band 21
    // +5 votes over a week: real, but not news. The snapshot must not move at all.
    expect(diffOf(before, bump(26)).hasChanges).toBe(false);
    // Half again as much support, and demand has visibly built: band 21 → 34.
    const surge = diffOf(before, bump(36));
    expect(surge.hasChanges).toBe(true);
    const { gone, appeared } = netEntryChange(surge);
    expect(gone).toHaveLength(1);
    expect(appeared).toHaveLength(1);
    expect(gone[0]).toContain("votes 21+");
    expect(appeared[0]).toContain("votes 34+");
  });

  test("a brand-new roadmap entry surfaces as a single added line", () => {
    const after = docFor(
      cannyPageWith((state) => {
        const boards = state.posts as Record<string, Record<string, unknown>>;
        const boardId = Object.keys(boards)[0]!;
        boards[boardId]!["ai-agent-marketplace"] = {
          _id: "ffffffffffffffffffffffff",
          title: "AI agent marketplace",
          status: "planned",
          score: 12,
          urlName: "ai-agent-marketplace",
          board: { urlName: "ai-workforce" },
        };
        (state.roadmap as { posts: unknown[] }).posts.push({
          boardID: boardId,
          postURLName: "ai-agent-marketplace",
        });
      }),
    );

    const { gone, appeared } = netEntryChange(diffOf(docFor(CANNY_HTML), after));
    expect(gone).toHaveLength(0);
    expect(appeared).toHaveLength(1);
    expect(appeared[0]).toContain("[planned] AI agent marketplace — votes 8+");
  });
});

// --- (c) private portals ----------------------------------------------------

describe("private portals", () => {
  const deps = (over: Partial<RoadmapDeps>): RoadmapDeps => ({
    reachable: async () => false,
    fetchHtml: async () => null,
    fetchPortalHtml: async () => ({ kind: "transient" }),
    fetchPortalApi: async () => ({ kind: "transient" }),
    ...over,
  });

  test("a Canny board with restricted access is marked private, not empty", () => {
    const closed = cannyPageWith((state) => {
      state.posts = {};
      (state.roadmap as { posts: unknown[] }).posts = [];
      for (const board of Object.values(
        (state.boards as { items: Record<string, { settings: { access: string } }> }).items,
      )) {
        board.settings.access = "private";
      }
    });
    expect(parseCannyPortal(closed, CANNY_URL)).toEqual({ ok: false, reason: "private" });
  });

  test("a public Canny board with no posts is empty, not private", () => {
    const empty = cannyPageWith((state) => {
      state.posts = {};
      (state.roadmap as { posts: unknown[] }).posts = [];
    });
    expect(parseCannyPortal(empty, CANNY_URL)).toEqual({ ok: false, reason: "empty" });
  });

  test("a ProductBoard portal that is no longer public is private", () => {
    const payload = JSON.parse(PB_JSON);
    payload.config.publiclyAccessible = false;
    expect(parseProductboardPortal(payload, PB_TARGET)).toEqual({ ok: false, reason: "private" });

    const jwtGated = JSON.parse(PB_JSON);
    jwtGated.portals[0].enforceJwtToken = true;
    expect(parseProductboardPortal(jwtGated, PB_TARGET)).toEqual({ ok: false, reason: "private" });
  });

  test("the scraper throws portal_private and returns no snapshot — Canny", async () => {
    const closed = cannyPageWith((state) => {
      state.posts = {};
      (state.roadmap as { posts: unknown[] }).posts = [];
      for (const board of Object.values(
        (state.boards as { items: Record<string, { settings: { access: string } }> }).items,
      )) {
        board.settings.access = "private";
      }
    });
    const promise = scrape(
      "c1",
      CANNY_URL,
      {},
      deps({ fetchPortalHtml: async () => ({ kind: "body", text: closed }) }),
    );
    await expect(promise).rejects.toThrow("roadmap: portal_private");
  });

  test("the scraper throws portal_private and returns no snapshot — ProductBoard 403", async () => {
    // The live endpoint answers `403 {"error":"Invalid space or portal"}` for a
    // gated portal; a refusal is recorded, never worked around.
    const promise = scrape("c1", PB_URL, {}, deps({ fetchPortalApi: async () => ({ kind: "denied" }) }));
    await expect(promise).rejects.toThrow("roadmap: portal_private");
  });
});

// --- (d) every other "nothing to read" degrades cleanly ---------------------

describe("clean degradation", () => {
  const deps = (over: Partial<RoadmapDeps>): RoadmapDeps => ({
    reachable: async () => false,
    fetchHtml: async () => null,
    fetchPortalHtml: async () => ({ kind: "transient" }),
    fetchPortalApi: async () => ({ kind: "transient" }),
    ...over,
  });

  test("no portal anywhere → no_roadmap_portal, never an empty snapshot", async () => {
    await expect(scrape("c1", "https://acme.com", {}, deps({}))).rejects.toThrow(
      "roadmap: no_roadmap_portal",
    );
  });

  test("a vendor payload we can no longer read is a LOUD failure, not a guess", async () => {
    // Canny changed its island shape: the honest outcome is a retried failure, so the
    // breakage is visible. Inventing a listing would diff as a roadmap rewrite.
    const promise = scrape(
      "c1",
      CANNY_URL,
      {},
      deps({ fetchPortalHtml: async () => ({ kind: "body", text: "<html><body>hello</body></html>" }) }),
    );
    await expect(promise).rejects.toThrow("roadmap: canny_parse_failed");
  });

  test("a guessed subdomain that is not a portal is absence, not breakage", async () => {
    // We probed feedback.acme.com on spec; a normal page there proves there is no
    // portal, and must not be reported as a vendor breaking its payload.
    const promise = scrape(
      "c1",
      "https://acme.com",
      {},
      deps({
        reachable: async (u) => u.startsWith("https://feedback.acme.com"),
        fetchPortalHtml: async () => ({ kind: "body", text: "<html><body>Support</body></html>" }),
      }),
    );
    await expect(promise).rejects.toThrow("roadmap: no_roadmap_portal");
  });

  test("a transient failure retries instead of degrading", async () => {
    const promise = scrape("c1", PB_URL, {}, deps({ fetchPortalApi: async () => ({ kind: "transient" }) }));
    await expect(promise).rejects.toThrow("roadmap: portal_fetch_failed");
  });

  test("a successful scrape emits a snapshot with the exact counts kept out of the body", async () => {
    const out = await scrape(
      "c1",
      CANNY_URL,
      {},
      deps({ fetchPortalHtml: async () => ({ kind: "body", text: CANNY_HTML }) }),
    );
    expect(out.level).toBe(0);
    expect(out.screenshotBuffer.length).toBe(0);
    expect(out.metadata.vendor).toBe("canny");
    expect(out.metadata.entries).toBe(12);
    expect(out.metadata.discoveredVia).toBe("given");
    expect(Object.values(out.metadata.votes as Record<string, number>)).toContain(21);
    // 39 is a real vote count in the fixture; it is metadata only, never diffable.
    expect(Object.values(out.metadata.votes as Record<string, number>)).toContain(39);
    expect(out.text).not.toContain("votes 39");
  });
});

// --- discovery --------------------------------------------------------------

describe("portal discovery", () => {
  test("a URL override that is already a portal wins verbatim", async () => {
    expect(looksLikePortalUrl(CANNY_URL)).toBe("canny");
    expect(looksLikePortalUrl(PB_URL)).toBe("productboard");
    expect(looksLikePortalUrl("https://acme.com")).toBeNull();

    const found = await discoverRoadmapPortal(PB_URL, { reachable: async () => true });
    expect(found).toEqual({ url: PB_URL, vendor: "productboard", source: "given" });
  });

  test("falls back to {brand}.canny.io before probing the competitor's own subdomains", async () => {
    const probed: string[] = [];
    const found = await discoverRoadmapPortal("https://acme.com/product", {
      reachable: async (u) => {
        probed.push(u);
        return false;
      },
      fetchHtml: async (u) => {
        probed.push(u);
        return u === "https://acme.canny.io/" ? CANNY_HTML : null;
      },
    });
    expect(found).toEqual({ url: "https://acme.canny.io/", vendor: "canny", source: "canny_subdomain" });
    expect(probed[0]).toBe("https://acme.canny.io/");
  });

  test("an unclaimed {brand}.canny.io is not a portal — Canny 200s for every brand", async () => {
    // The shell Canny serves for a subdomain nobody owns: the island parses, and says
    // so. Reachability cannot see this, which is why the probe reads the page.
    const unclaimed = cannyPageWith((state) => {
      state.company = { error: null, loading: false, notFound: true };
      state.boards = { items: {} };
      state.posts = {};
      state.roadmap = { hasNextPage: false };
    });
    const found = await discoverRoadmapPortal("https://acme.com", {
      reachable: async (u) => u === "https://feedback.acme.com/",
      fetchHtml: async (u) => (u === "https://acme.canny.io/" ? unclaimed : null),
    });
    // Before the island check this returned the phantom Canny page, so the real
    // portal one probe further down was never reached and the scrape reported
    // `portal_private` — a portal that does not exist, called closed.
    expect(found).toEqual({ url: "https://feedback.acme.com/", vendor: null, source: "subdomain" });
  });

  test("finds a custom-domain portal on a conventional subdomain", async () => {
    const found = await discoverRoadmapPortal("https://acme.com", {
      reachable: async (u) => u === "https://feedback.acme.com/",
    });
    // Vendor unknown from the host alone — the payload identifies it.
    expect(found).toEqual({ url: "https://feedback.acme.com/", vendor: null, source: "subdomain" });
  });

  test("follows a roadmap link from the nav, including one to a vendor host", () => {
    const base = new URL("https://acme.com");
    const html = `<nav><a href="/pricing">Pricing</a><a href="https://acme.canny.io/">Roadmap</a></nav>
      <footer><a href="https://partner.example.com/roadmap">Partner roadmap</a></footer>`;
    expect(portalLinkIn(html, "nav a, header a", base)).toBe("https://acme.canny.io/");
    // A third party's roadmap on someone else's domain is never followed.
    expect(portalLinkIn(html, "footer a", base)).toBeNull();
  });
});
