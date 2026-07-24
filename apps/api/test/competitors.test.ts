import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { competitors, monitors } from "@outrival/db";
import { SOURCE_TYPES, isConfigurableSource } from "@outrival/shared";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// POST /competitors/:id/monitors guards two invariants at once: tenant ownership
// (assertOwnedCompetitor) and per-plan source gating (isSourceAllowed). Both must
// short-circuit before any monitor is created.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/competitors", competitorsRouter);
  A = await seedOrg(testDb, { plan: "free" });
  B = await seedOrg(testDb, { plan: "free" });
  await testDb.insert(competitors).values({ id: "comp-a", orgId: A.orgId, name: "Acme" });
});

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
    expect(item?.specificProductIds).toEqual([]);

    // Heavy jsonb dropped by the columns projection (plan-012).
    expect(item?.overrides).toBeUndefined();
    expect(item?.platformProfile).toBeUndefined();
    expect(item?.selfProfile).toBeUndefined();
    expect(item?.metadata).toBeUndefined();
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

  beforeAll(async () => {
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

  test("dedup: the same page (canonical URL) is rejected, no extra row", async () => {
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
