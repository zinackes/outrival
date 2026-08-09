import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  changes,
  competitors,
  monitors,
  organizations,
  productCompetitors,
  products,
  signals,
  snapshots,
} from "@outrival/db";
import { SOURCE_TYPES, isConfigurableSource } from "@outrival/shared";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// POST /competitors/:id/monitors guards two invariants at once: tenant ownership
// (assertOwnedCompetitor) and per-plan source gating (isSourceAllowed). Both must
// short-circuit before any monitor is created.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/competitors", competitorsRouter);
  // Explicit timeout: booting PGlite + migrations + the router's module graph sits
  // around 4.5s on a slow machine, so bun's 5s default for hooks was one import
  // away from timing out and failing the whole file at once.
}, 30_000);

// Per test, not per file: A is on the free plan, so every competitor another test
// leaves behind pushes the roster past the cap and flips pausedByPlan on rows that
// are supposed to read false.
beforeEach(async () => {
  await resetDb();
  A = await seedOrg(testDb, { plan: "free" });
  B = await seedOrg(testDb, { plan: "free" });
  await testDb.insert(competitors).values({ id: "comp-a", orgId: A.orgId, name: "Acme" });
}, 30_000);

const enable = (userId: string, email: string, competitorId: string, sourceType: string) =>
  app.request(
    `/api/competitors/${competitorId}/monitors`,
    asUser(userId, email, { method: "POST", body: JSON.stringify({ sourceType }) }),
  );

describe("GET /competitors roster projection", () => {
  test("list response carries the used fields but omits heavy jsonb columns", async () => {
    await testDb.insert(competitors).values({
      id: "comp-projected",
      orgId: A.orgId,
      name: "Projected Co",
      url: "https://projected.example",
      color: "indigo",
      category: "SaaS",
      overlapScore: 42,
      aiSummary: "Summary text",
      monitoringPaused: false,
      alertsMuted: false,
      // Heavy jsonb the roster must NOT ship (plan-012).
      overrides: { pricingPlans: [] },
      platformProfile: { framework: "next", detectedAt: new Date().toISOString() },
      metadata: { scratch: "value" },
    });

    const res = await app.request("/api/competitors", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { competitors: Record<string, unknown>[] };
    const item = body.competitors.find((c) => c.id === "comp-projected");
    expect(item).toBeDefined();

    // Fields the roster + web list actually use.
    expect(item?.name).toBe("Projected Co");
    expect(item?.url).toBe("https://projected.example");
    expect(item?.color).toBe("indigo");
    expect(item?.category).toBe("SaaS");
    expect(item?.overlapScore).toBe(42);
    expect(item?.aiSummary).toBe("Summary text");
    expect(item?.monitoringPaused).toBe(false);
    expect(item?.alertsMuted).toBe(false);

    // Enrichment computed server-side, must still be present.
    expect(item?.stats).toBeDefined();
    expect(item?.freshness).toBeDefined();
    expect(item?.analysis).toBeDefined();
    expect(item?.pausedByPlan).toBe(false);
    expect(item?.productIds).toEqual([]);

    // Heavy jsonb dropped by the columns projection (plan-012).
    expect(item?.overrides).toBeUndefined();
    expect(item?.platformProfile).toBeUndefined();
    expect(item?.selfProfile).toBeUndefined();
    expect(item?.metadata).toBeUndefined();
  });

  // The roster leads with what a competitor last DID and whether we are still
  // watching it, so the row carries three enrichments the counts cannot express.
  test("row carries the latest move, the 14 day shape and source coverage", async () => {
    const day = 24 * 3600 * 1000;
    await testDb.insert(competitors).values({
      id: "comp-roster",
      orgId: A.orgId,
      name: "Roster Co",
      url: "https://roster.example",
    });
    await testDb.insert(monitors).values([
      { id: "mon-roster-home", competitorId: "comp-roster", sourceType: "homepage", isActive: true },
      // Auto-paused with no diagnosis: broken, and the row names it.
      {
        id: "mon-roster-price",
        competitorId: "comp-roster",
        sourceType: "pricing",
        isActive: true,
        markedUnscrapable: true,
      },
      // A site that REFUSED us. It is reported apart from the failures (nothing is
      // broken and nothing is owed), and it is `isActive: false` because that is what
      // a refusal writes — which is exactly what used to hide it from this query.
      {
        id: "mon-roster-blog",
        competitorId: "comp-roster",
        sourceType: "blog",
        isActive: false,
        markedUnscrapable: true,
        refusedAt: new Date(),
        refusalReason: "robots_disallowed",
      },
    ]);
    await testDb
      .insert(snapshots)
      .values({ id: "snp-roster", monitorId: "mon-roster-home", r2Key: "k", contentHash: "h" });

    const seedSignal = async (
      id: string,
      at: Date,
      severity: "low" | "high",
      category: "product" | "pricing",
      insight: string,
    ) => {
      await testDb
        .insert(changes)
        .values({ id: `chg-${id}`, monitorId: "mon-roster-home", snapshotAfterId: "snp-roster", detectedAt: at });
      await testDb.insert(signals).values({
        id,
        changeId: `chg-${id}`,
        orgId: A.orgId,
        competitorId: "comp-roster",
        severity,
        category,
        insight,
        createdAt: at,
      });
    };
    // 40 days back: outside every window the roster counts, but still a last move.
    await seedSignal("sig-roster-old", new Date(Date.now() - 40 * day), "low", "product", "old move");
    await seedSignal("sig-roster-new", new Date(Date.now() - 2 * day), "high", "pricing", "fresh move");

    const res = await app.request("/api/competitors", asUser(A.userId, A.email));
    const body = (await res.json()) as { competitors: Record<string, any>[] };
    const item = body.competitors.find((c) => c.id === "comp-roster");

    expect(item?.latestMove).toMatchObject({
      insight: "fresh move",
      severity: "high",
      category: "pricing",
    });
    // Oldest day first, one bucket per day, and the 40 day old signal is not in it.
    expect(item?.activity).toHaveLength(14);
    expect(item?.activity[11]).toBe(1);
    expect((item?.activity as number[]).reduce((a, b) => a + b, 0)).toBe(1);
    // The refused blog is counted and named on its own, never inside `failing`, and
    // one blocked source beside two live ones stays a footnote on its row rather
    // than a verdict about the competitor.
    expect(item?.coverage).toEqual({
      sources: 3,
      failing: 1,
      failingSource: "pricing",
      blocked: 1,
      blockedSource: "blog",
      blockedReach: "partial",
    });
  });

  // A competitor whose only signal predates the 14 day window still has a last
  // move: the row says "quiet since", which is the useful thing to say about it.
  test("a competitor silent for weeks still reports its last move", async () => {
    await testDb.insert(competitors).values({
      id: "comp-silent",
      orgId: A.orgId,
      name: "Silent Co",
      url: "https://silent.example",
    });
    await testDb
      .insert(monitors)
      .values({ id: "mon-silent", competitorId: "comp-silent", sourceType: "homepage", isActive: true });
    await testDb
      .insert(snapshots)
      .values({ id: "snp-silent", monitorId: "mon-silent", r2Key: "k2", contentHash: "h2" });
    const at = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    await testDb
      .insert(changes)
      .values({ id: "chg-silent", monitorId: "mon-silent", snapshotAfterId: "snp-silent", detectedAt: at });
    await testDb.insert(signals).values({
      id: "sig-silent",
      changeId: "chg-silent",
      orgId: A.orgId,
      competitorId: "comp-silent",
      severity: "medium",
      category: "content",
      insight: "an old move",
      createdAt: at,
    });

    const res = await app.request("/api/competitors", asUser(A.userId, A.email));
    const body = (await res.json()) as { competitors: Record<string, any>[] };
    const item = body.competitors.find((c) => c.id === "comp-silent");

    expect(item?.latestMove?.insight).toBe("an old move");
    expect(item?.stats.signals7d).toBe(0);
    // Unread is all-time, not windowed like signals7d: a 30 day old signal nobody
    // opened is still waiting to be read, and the sidebar count must say so.
    expect(item?.stats.unread).toBe(1);
    expect((item?.activity as number[]).every((n) => n === 0)).toBe(true);
    expect(item?.coverage).toEqual({
      sources: 1,
      failing: 0,
      failingSource: null,
      blocked: 0,
      blockedSource: null,
      blockedReach: "none",
    });
  });
});

describe("competitors enable-monitor gating", () => {
  test("IDOR: a foreign org cannot enable a monitor on another org's competitor", async () => {
    const res = await enable(B.userId, B.email, "comp-a", "blog");
    expect(res.status).toBe(404);
  });

  test("IDOR: a non-existent competitor id is 404, not a server error", async () => {
    const res = await enable(A.userId, A.email, "does-not-exist", "blog");
    expect(res.status).toBe(404);
  });

  test("plan gating: free org cannot enable a pro-only source (jobs)", async () => {
    const res = await enable(A.userId, A.email, "comp-a", "jobs");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("plan_locked_source");
  });

  test("internal source (sitemap) is never user-enableable", async () => {
    const res = await enable(A.userId, A.email, "comp-a", "sitemap");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("source_not_enableable");
  });

  test("custom is NOT enableable via the standard route — it has its own flow", async () => {
    const res = await enable(A.userId, A.email, "comp-a", "custom");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("use_custom_monitor_endpoint");
  });

  test("no source outside the catalog's configurable list is enableable", async () => {
    // Exhaustive over the enum: automatic sources, never-scraped anchors, the
    // retired review aggregators and the scraper-less linkedin/twitter must all be
    // refused. Guards against a new source_type silently becoming enableable.
    const refusable = SOURCE_TYPES.filter((s) => !isConfigurableSource(s) && s !== "custom");
    for (const source of refusable) {
      const res = await enable(A.userId, A.email, "comp-a", source);
      expect({ source, status: res.status }).toEqual({ source, status: 400 });
      expect((await res.json()).error).toBe("source_not_enableable");
    }
  });

  test("a retired review aggregator can never come back through this route", async () => {
    const res = await enable(A.userId, A.email, "comp-a", "g2_reviews");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("source_not_enableable");
  });

  test("an UNGATED source (changelog) is enableable on the free plan", async () => {
    // Regression: the route gated on the strict allowlist, and changelog belongs to
    // no plan's allowedSources — so it 403'd on every tier, business included, even
    // though the scheduler (planAllowsMonitorSource) would have run it.
    const res = await enable(A.userId, A.email, "comp-a", "changelog");
    expect(res.status).toBe(201);
    const rows = await testDb
      .select()
      .from(monitors)
      .where(and(eq(monitors.competitorId, "comp-a"), eq(monitors.sourceType, "changelog")));
    expect(rows).toHaveLength(1);
  });

  test("roadmap is pro+, and its URL override may point at the portal vendor's host", async () => {
    // The portal is off-domain by construction (acme.canny.io,
    // portal.productboard.com/…), so validateMonitorUrl grants `roadmap` a brand
    // exception — the same one `jobs` gets for ATS hosts. Without it the override
    // every user would paste is rejected as host_not_allowed.
    const locked = await enable(A.userId, A.email, "comp-a", "roadmap");
    expect(locked.status).toBe(403);
    expect((await locked.json()).error).toBe("plan_locked_source");

    const P = await seedOrg(testDb, { plan: "pro" });
    await testDb
      .insert(competitors)
      .values({ id: "comp-p", orgId: P.orgId, name: "Acme Pro", url: "https://acme.example" });

    const withPortal = await app.request(
      `/api/competitors/comp-p/monitors`,
      asUser(P.userId, P.email, {
        method: "POST",
        body: JSON.stringify({ sourceType: "roadmap", url: "https://acme.canny.io/" }),
      }),
    );
    expect(withPortal.status).toBe(201);
    const created = (await withPortal.json()).monitor as {
      config: { url: string };
      frequency: string;
    };
    expect(created.config).toEqual({ url: "https://acme.canny.io/" });
    // Portal statuses move on sprint cadence and the vote bands ignore drift, so a
    // daily read would spend requests to observe nothing.
    expect(created.frequency).toBe("weekly");

    // The exception is scoped to the two vendors — any other off-domain host is still
    // refused, so `roadmap` cannot become a general-purpose off-domain fetcher.
    await testDb
      .insert(competitors)
      .values({ id: "comp-p2", orgId: P.orgId, name: "Acme Pro 2", url: "https://acme.example" });
    const foreign = await app.request(
      `/api/competitors/comp-p2/monitors`,
      asUser(P.userId, P.email, {
        method: "POST",
        body: JSON.stringify({ sourceType: "roadmap", url: "https://evil.example/roadmap" }),
      }),
    );
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error).toBe("invalid_monitor_url");
  });

  test("github_repo needs an explicit repo URL, and accepts github.com", async () => {
    // Nothing discovers a competitor's repo, so without a URL the scraper can only
    // throw; and the repo lives off the competitor's own domain by definition.
    const missing = await enable(A.userId, A.email, "comp-a", "github_repo");
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("repo_url_required");

    const res = await app.request(
      `/api/competitors/comp-a/monitors`,
      asUser(A.userId, A.email, {
        method: "POST",
        body: JSON.stringify({ sourceType: "github_repo", url: "https://github.com/acme/api" }),
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).monitor.config).toEqual({ url: "https://github.com/acme/api" });
  });
});

// The dedicated "Watch a custom page" flow (POST /:id/custom-monitors): eTLD+1
// domain lock, per-competitor quota (backend), several customs coexisting, and
// canonical-URL dedup. Seeds its own starter org + a competitor WITH a url (the
// domain lock needs one).
describe("custom-page monitors", () => {
  let S: { orgId: string; userId: string; email: string };

  const addCustom = (
    u: { userId: string; email: string },
    competitorId: string,
    body: Record<string, unknown>,
  ) =>
    app.request(
      `/api/competitors/${competitorId}/custom-monitors`,
      asUser(u.userId, u.email, { method: "POST", body: JSON.stringify(body) }),
    );

  const countCustoms = async (competitorId: string) =>
    (
      await testDb.query.monitors.findMany({
        where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "custom")),
      })
    ).length;

  beforeEach(async () => {
    // starter → customMonitorsPerCompetitor = 2.
    S = await seedOrg(testDb, { plan: "starter" });
    await testDb
      .insert(competitors)
      .values({ id: "comp-s", orgId: S.orgId, name: "Acme", url: "https://acme.example" });
    // free org A already exists; give it a competitor with a url to prove the free=0 lock.
    await testDb
      .insert(competitors)
      .values({ id: "comp-a-url", orgId: A.orgId, name: "Acme Free", url: "https://acmefree.example" });
  });

  test("(a) rejects a URL off the competitor's registrable domain (eTLD+1)", async () => {
    const res = await addCustom(S, "comp-s", {
      url: "https://not-acme.example/security",
      label: "Security",
      hint: "security",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("custom_url_domain_mismatch");
    expect(await countCustoms("comp-s")).toBe(0);
  });

  test("(c) two customs coexist on one competitor and store distinct URLs", async () => {
    // A subdomain of the competitor's domain is allowed (eTLD+1 collapses it).
    const r1 = await addCustom(S, "comp-s", {
      url: "https://docs.acme.example/security",
      label: "Security docs",
      hint: "security",
    });
    expect(r1.status).toBe(201);
    const m1 = (await r1.json()).monitor as { id: string; config: { url: string; hint: string } };

    const r2 = await addCustom(S, "comp-s", {
      url: "https://acme.example/enterprise",
      label: "Enterprise",
      hint: "product",
    });
    expect(r2.status).toBe(201);
    const m2 = (await r2.json()).monitor as { id: string; config: { url: string } };

    // Distinct monitor rows → the per-monitor diff loop treats them independently.
    expect(m1.id).not.toBe(m2.id);
    expect(m1.config.url).toBe("https://docs.acme.example/security");
    expect(m2.config.url).toBe("https://acme.example/enterprise");
    expect(m1.config.hint).toBe("security");
    expect(await countCustoms("comp-s")).toBe(2);
  });

  // The two tests below read a competitor already at the starter limit, which (c)
  // happens to leave behind. Each seeds its own so neither depends on running after it.
  const fillCustoms = async () => {
    await addCustom(S, "comp-s", {
      url: "https://docs.acme.example/security",
      label: "Security docs",
      hint: "security",
    });
    await addCustom(S, "comp-s", {
      url: "https://acme.example/enterprise",
      label: "Enterprise",
      hint: "product",
    });
  };

  test("dedup: the same page (canonical URL) is rejected, no extra row", async () => {
    await fillCustoms();
    // Trailing slash normalizes to the existing /enterprise custom.
    const res = await addCustom(S, "comp-s", {
      url: "https://acme.example/enterprise/",
      label: "Enterprise dup",
      hint: "product",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("custom_url_duplicate");
    expect(await countCustoms("comp-s")).toBe(2);
  });

  test("(b) per-competitor quota → plan_limit_custom_monitors (backend)", async () => {
    await fillCustoms();
    // starter limit is 2 and comp-s already has 2 → a third distinct page is blocked.
    const res = await addCustom(S, "comp-s", {
      url: "https://acme.example/about",
      label: "About",
      hint: "team",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; limit: number; used: number };
    expect(body.error).toBe("plan_limit_custom_monitors");
    expect(body.limit).toBe(2);
    expect(body.used).toBe(2);
    expect(await countCustoms("comp-s")).toBe(2);
  });

  test("(b) free plan fully locks custom pages (limit 0)", async () => {
    const res = await addCustom(A, "comp-a-url", {
      url: "https://acmefree.example/security",
      label: "Security",
      hint: "security",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; limit: number };
    expect(body.error).toBe("plan_limit_custom_monitors");
    expect(body.limit).toBe(0);
    expect(await countCustoms("comp-a-url")).toBe(0);
  });
});

// A recompute with nothing to judge the competitor on must not touch the stored
// score. Discovery scores a candidate on the text Exa returned for its page; the
// solo re-score only ever had `description`, which the candidate-add path never
// writes — so an 85 from discovery came back as a single-digit guess made from a
// bare domain. The guard short-circuits before the AI call, so no mock is needed.
describe("POST /competitors/:id/recompute-overlap evidence guard", () => {
  test("no summary and no description → 400 no_evidence, score untouched", async () => {
    await testDb.insert(competitors).values({
      id: "comp-no-evidence",
      orgId: A.orgId,
      name: "Blind Co",
      url: "https://blind.example",
      overlapScore: 85,
    });

    const res = await app.request(
      "/api/competitors/comp-no-evidence/recompute-overlap",
      asUser(A.userId, A.email, { method: "POST" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_evidence");

    const row = await testDb.query.competitors.findFirst({
      where: eq(competitors.id, "comp-no-evidence"),
      columns: { overlapScore: true },
    });
    expect(row?.overlapScore).toBe(85);
  });

  test("a competitor with no URL is rejected before the evidence check", async () => {
    await testDb.insert(competitors).values({
      id: "comp-no-url-overlap",
      orgId: A.orgId,
      name: "Urlless Co",
      aiSummary: "Plenty of evidence, but nothing to score against.",
    });

    const res = await app.request(
      "/api/competitors/comp-no-url-overlap/recompute-overlap",
      asUser(A.userId, A.email, { method: "POST" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_url");
  });

  // Multi-SKU: `organizations.productProfile` is the LEGACY org-wide profile, which
  // describes the PRIMARY product only. A competitor discovered for a secondary SKU
  // (discovery runs on that SKU's own self-profile) used to be re-judged against it,
  // so a social-media tool scored 95 for a scheduling SKU came back at 3 against the
  // org's VPS-hosting primary. The secondary SKU must never borrow the org profile:
  // with nothing of its own to score against, the answer is "no profile", not a
  // confident number about a different product.
  test("a secondary SKU's competitor is never judged against the org profile", async () => {
    const C = await seedOrg(testDb, { plan: "free" });
    await testDb
      .update(organizations)
      .set({
        productProfile: {
          category: "VPS hosting",
          audience: "IT administrators",
          valueProp: "Hourly-billed compute",
          pricingModel: "Usage-based",
        },
      })
      .where(eq(organizations.id, C.orgId));

    await testDb.insert(competitors).values([
      { id: "self-primary-c", orgId: C.orgId, name: "Primary SKU", type: "self" },
      // Secondary SKU with no self-profile of its own yet.
      { id: "self-secondary-c", orgId: C.orgId, name: "Secondary SKU", type: "self" },
      {
        id: "comp-secondary-c",
        orgId: C.orgId,
        name: "Scheduler Co",
        url: "https://scheduler.example",
        aiSummary: "Social media scheduling for creators and agencies.",
        overlapScore: 95,
      },
    ]);
    await testDb.insert(products).values([
      { id: "prod-primary-c", orgId: C.orgId, name: "Primary", selfCompetitorId: "self-primary-c", isPrimary: true },
      { id: "prod-secondary-c", orgId: C.orgId, name: "Secondary", selfCompetitorId: "self-secondary-c" },
    ]);
    await testDb
      .insert(productCompetitors)
      .values({ productId: "prod-secondary-c", competitorId: "comp-secondary-c" });

    const res = await app.request(
      "/api/competitors/comp-secondary-c/recompute-overlap",
      asUser(C.userId, C.email, { method: "POST" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_profile");

    const row = await testDb.query.competitors.findFirst({
      where: eq(competitors.id, "comp-secondary-c"),
      columns: { overlapScore: true },
    });
    expect(row?.overlapScore).toBe(95);
  });
});

// The product scope rides a year-long cookie, so it outlives the product it names.
// Serving the archived product's roster meant the workspace showed a removed SKU's
// competitors and hid every live one, with no switcher left to change scope on an org
// back down to one product: the competitors still counted against the plan cap but
// could not be opened or deleted from any surface.
describe("GET /competitors under a stale product scope", () => {
  let S: { orgId: string; userId: string; email: string };
  let livePid: string;
  let archivedPid: string;

  beforeEach(async () => {
    S = await seedOrg(testDb, { plan: "pro" });
    await testDb.insert(competitors).values([
      { id: "comp-live-s", orgId: S.orgId, name: "Live rival" },
      { id: "comp-archived-s", orgId: S.orgId, name: "Stranded rival" },
      { id: "self-live-s", orgId: S.orgId, name: "Us", type: "self" },
      { id: "self-archived-s", orgId: S.orgId, name: "Retired SKU", type: "self" },
    ]);
    await testDb.insert(products).values([
      { id: "prod-live-s", orgId: S.orgId, name: "Main", selfCompetitorId: "self-live-s", isPrimary: true },
      {
        id: "prod-archived-s",
        orgId: S.orgId,
        name: "Retired",
        selfCompetitorId: "self-archived-s",
        status: "archived",
      },
    ]);
    await testDb.insert(productCompetitors).values([
      { productId: "prod-live-s", competitorId: "comp-live-s" },
      { productId: "prod-archived-s", competitorId: "comp-archived-s" },
    ]);
    livePid = "prod-live-s";
    archivedPid = "prod-archived-s";
  }, 30_000);

  const names = async (query: string) => {
    const res = await app.request(`/api/competitors${query}`, asUser(S.userId, S.email));
    expect(res.status).toBe(200);
    return ((await res.json()).competitors as { name: string }[]).map((c) => c.name).sort();
  };

  test("a live product scope still narrows to its own roster", async () => {
    expect(await names(`?productId=${livePid}`)).toEqual(["Live rival"]);
  });

  test("an archived product scope widens to the workspace instead of serving its roster", async () => {
    expect(await names(`?productId=${archivedPid}`)).toEqual(["Live rival", "Stranded rival"]);
  });

  test("an unknown product id widens the same way (no empty dead end)", async () => {
    expect(await names("?productId=does-not-exist")).toEqual(["Live rival", "Stranded rival"]);
  });
});
