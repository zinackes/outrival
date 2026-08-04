import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  changes,
  competitors,
  messagingVersions,
  monitors,
  numericClaims,
  signals,
  snapshots,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

/**
 * Positioning Intelligence v2 P1, read side.
 *
 * The homepage signal could always say the copy changed and never what it changed
 * FROM — the previous wording lived inside a snapshot nobody read. What is worth
 * pinning here is that the block can only ever print what was captured: it shows a
 * rewrite only when a version was actually opened in this capture's window, and a
 * claim only in the words the page itself printed.
 */
let app: Hono;
let competitorsApp: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let org: { orgId: string; userId: string; email: string };

let seq = 0;
const T = (day: number, h = 12) => new Date(Date.UTC(2026, 6, day, h, 0, 0));

async function seedCompetitor() {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  const monitorId = `mon-${n}`;
  const snapshotId = `snp-${n}`;
  await testDb.insert(competitors).values({ id: competitorId, orgId: org.orgId, name: `C${n}` });
  await testDb.insert(monitors).values({ id: monitorId, competitorId, sourceType: "homepage" });
  await testDb
    .insert(snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${n}`, contentHash: `h-${n}` });
  return { competitorId, monitorId, snapshotId };
}

async function seedSignal(
  src: { competitorId: string; monitorId: string; snapshotId: string },
  detectedAt: Date,
  structuredDiff: unknown[],
): Promise<string> {
  const n = ++seq;
  await testDb.insert(changes).values({
    id: `chg-${n}`,
    monitorId: src.monitorId,
    snapshotAfterId: src.snapshotId,
    diffText: "homepage",
    diffType: "structured",
    structuredDiff,
    detectedAt,
  });
  await testDb.insert(signals).values({
    id: `sig-${n}`,
    changeId: `chg-${n}`,
    orgId: org.orgId,
    competitorId: src.competitorId,
    severity: "medium",
    category: "content",
    insight: `insight ${n}`,
    createdAt: detectedAt,
  });
  return `sig-${n}`;
}

async function seedVersion(
  competitorId: string,
  capturedAt: Date,
  copy: { h1: string; subheadline?: string; primaryCta?: string; valueProps?: string[] },
) {
  await testDb.insert(messagingVersions).values({
    competitorId,
    h1: copy.h1,
    subheadline: copy.subheadline ?? null,
    primaryCta: copy.primaryCta ?? null,
    valueProps: copy.valueProps ?? [],
    capturedAt,
    snapshotKey: `snapshots/${competitorId}/homepage/${capturedAt.toISOString()}`,
  });
}

async function seedClaim(
  competitorId: string,
  observedAt: Date,
  claim: { value: number; rawText: string; context?: string; unit?: string; pattern?: string },
) {
  await testDb.insert(numericClaims).values({
    competitorId,
    monitorId: "m",
    pattern: claim.pattern ?? "user_count",
    unit: claim.unit ?? "customers",
    context: claim.context ?? "customers",
    value: claim.value,
    rawText: claim.rawText,
    observedAt,
  });
}

const claimChange = (metadata: Record<string, unknown>) => ({
  kind: "numeric_claim_changed",
  field: "numeric_claim_changed",
  before: "10,000 customers",
  after: "15,000 customers",
  metadata,
});

async function facts(signalId: string) {
  const res = await app.request(`/api/signals/${signalId}/detail`, asUser(org.userId));
  expect(res.status).toBe(200);
  return (await res.json()).signal.facts;
}

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { signalsRouter } = await import("../src/routes/signals");
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/signals", signalsRouter);
  competitorsApp = mountApp("/api/competitors", competitorsRouter);
  org = await seedOrg(testDb);
});

describe("homepage fact block — messaging", () => {
  test("names what the copy went FROM, and how long that wording had stood", async () => {
    const src = await seedCompetitor();
    await seedVersion(src.competitorId, T(1), {
      h1: "Track your collection",
      subheadline: "Know what you own",
      primaryCta: "Start free trial",
    });
    await seedVersion(src.competitorId, T(20), {
      h1: "Buy, sell, trade",
      subheadline: "The marketplace for collectors",
      primaryCta: "Book a demo",
    });

    const block = await facts(await seedSignal(src, T(20), []));

    expect(block.kind).toBe("positioning");
    expect(block.messaging.h1Before).toBe("Track your collection");
    expect(block.messaging.h1After).toBe("Buy, sell, trade");
    expect(block.messaging.subheadlineBefore).toBe("Know what you own");
    // The CTA move is the go-to-market half, invisible in the headline.
    expect(block.messaging.ctaBefore).toBe("Start free trial");
    expect(block.messaging.ctaAfter).toBe("Book a demo");
    expect(block.messaging.previousSince).toBe("2026-07-01");
  });

  test("an unchanged CTA is left out rather than printed as a move", async () => {
    const src = await seedCompetitor();
    await seedVersion(src.competitorId, T(1), { h1: "Before", primaryCta: "Start free" });
    await seedVersion(src.competitorId, T(20), { h1: "After", primaryCta: "Start free" });

    const block = await facts(await seedSignal(src, T(20), []));
    expect(block.messaging.ctaBefore).toBeNull();
    expect(block.messaging.ctaAfter).toBeNull();
  });

  test("the very first wording we ever recorded has no before", async () => {
    const src = await seedCompetitor();
    await seedVersion(src.competitorId, T(20), { h1: "The only wording we hold" });

    const block = await facts(await seedSignal(src, T(20), []));
    expect(block.messaging.h1Before).toBeNull();
    expect(block.messaging.previousSince).toBeNull();
  });

  test("copy that stood still through this capture is NOT reported as a rewrite", async () => {
    // The signal is about something else on the page. Printing the standing
    // headline as a before/after would invent a repositioning that never happened.
    const src = await seedCompetitor();
    await seedVersion(src.competitorId, T(1), { h1: "Old" });
    await seedVersion(src.competitorId, T(5), { h1: "Current, and unchanged since" });

    expect(await facts(await seedSignal(src, T(20), []))).toBeNull();
  });
});

describe("homepage fact block — claims", () => {
  test("prints the claim in the words the page used, with its trajectory", async () => {
    const src = await seedCompetitor();
    await seedClaim(src.competitorId, T(1), { value: 8000, rawText: "8,000+ customers" });
    await seedClaim(src.competitorId, T(10), { value: 10000, rawText: "10,000+ customers" });
    await seedClaim(src.competitorId, T(20), { value: 15000, rawText: "15,000+ customers" });

    const block = await facts(
      await seedSignal(src, T(20), [
        claimChange({
          variation: 0.5,
          pattern: "user_count",
          unit: "customers",
          context: "customers",
          rawTextBefore: "10,000+ customers",
          rawTextAfter: "15,000+ customers",
          milestone: 10000,
        }),
      ]),
    );

    expect(block.claims).toHaveLength(1);
    const [claim] = block.claims;
    // VERBATIM, both sides — "10,000 customers" is a sentence they never published.
    expect(claim.before).toBe("10,000+ customers");
    expect(claim.after).toBe("15,000+ customers");
    expect(claim.milestone).toBe(10000);
    // Oldest first, so it reads as a trajectory rather than backwards.
    expect(claim.series.map((p: { value: number }) => p.value)).toEqual([8000, 10000, 15000]);
  });

  test("a claim change with no verbatim spans is dropped, not reformatted", async () => {
    // Changes written before the spans were carried: rendering our own
    // "10,000 customers" as if it were the page's words would be a fabrication.
    const src = await seedCompetitor();
    const block = await facts(
      await seedSignal(src, T(20), [claimChange({ variation: 0.5, context: "customers" })]),
    );
    expect(block).toBeNull();
  });

  test("the series only holds the claim the signal is about", async () => {
    const src = await seedCompetitor();
    await seedClaim(src.competitorId, T(10), { value: 99.9, rawText: "99.9% uptime", unit: "%", context: "uptime", pattern: "uptime" });
    await seedClaim(src.competitorId, T(20), { value: 15000, rawText: "15,000+ customers" });

    const block = await facts(
      await seedSignal(src, T(20), [
        claimChange({
          variation: 0.5,
          pattern: "user_count",
          unit: "customers",
          context: "customers",
          rawTextBefore: "10,000+ customers",
          rawTextAfter: "15,000+ customers",
        }),
      ]),
    );

    expect(block.claims[0].series).toHaveLength(1);
    expect(block.claims[0].series[0].rawText).toBe("15,000+ customers");
  });
});

describe("GET /:id/messaging-timeline", () => {
  test("returns every distinct wording, newest first, with its CTA", async () => {
    const src = await seedCompetitor();
    await seedVersion(src.competitorId, T(1), { h1: "First", primaryCta: "Sign up" });
    await seedVersion(src.competitorId, T(10), { h1: "Second", valueProps: ["Fast"] });

    const res = await competitorsApp.request(
      `/api/competitors/${src.competitorId}/messaging-timeline`,
      asUser(org.userId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions.map((v: { h1: string }) => v.h1)).toEqual(["Second", "First"]);
    expect(body.versions[1].primaryCta).toBe("Sign up");
    expect(body.versions[0].valueProps).toEqual(["Fast"]);
    expect(body.nextCursor).toBeNull();
  });

  test("pages on capturedAt, so a scrape landing mid-scroll cannot shift the page", async () => {
    const src = await seedCompetitor();
    for (const day of [1, 5, 10]) await seedVersion(src.competitorId, T(day), { h1: `V${day}` });

    const first = await (
      await competitorsApp.request(
        `/api/competitors/${src.competitorId}/messaging-timeline?limit=2`,
        asUser(org.userId),
      )
    ).json();
    expect(first.versions.map((v: { h1: string }) => v.h1)).toEqual(["V10", "V5"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await (
      await competitorsApp.request(
        `/api/competitors/${src.competitorId}/messaging-timeline?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
        asUser(org.userId),
      )
    ).json();
    expect(second.versions.map((v: { h1: string }) => v.h1)).toEqual(["V1"]);
    expect(second.nextCursor).toBeNull();
  });

  test("another org's competitor is not found", async () => {
    const src = await seedCompetitor();
    const other = await seedOrg(testDb);
    const res = await competitorsApp.request(
      `/api/competitors/${src.competitorId}/messaging-timeline`,
      asUser(other.userId),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/claims", () => {
  test("one row per (pattern, unit, context), latest value first, series oldest-first", async () => {
    const src = await seedCompetitor();
    await seedClaim(src.competitorId, T(1), { value: 8000, rawText: "8,000+ customers" });
    await seedClaim(src.competitorId, T(20), { value: 15000, rawText: "15,000+ customers" });
    await seedClaim(src.competitorId, T(20), {
      value: 99.9,
      rawText: "99.9% uptime",
      unit: "%",
      context: "uptime",
      pattern: "uptime",
    });

    const body = await (
      await competitorsApp.request(`/api/competitors/${src.competitorId}/claims`, asUser(org.userId))
    ).json();

    expect(body.claims).toHaveLength(2);
    const customers = body.claims.find((c: { context: string }) => c.context === "customers");
    expect(customers.value).toBe(15000);
    expect(customers.rawText).toBe("15,000+ customers");
    expect(customers.series.map((p: { value: number }) => p.value)).toEqual([8000, 15000]);
  });

  test("a competitor that has never made a quantified claim answers empty", async () => {
    const src = await seedCompetitor();
    const body = await (
      await competitorsApp.request(`/api/competitors/${src.competitorId}/claims`, asUser(org.userId))
    ).json();
    expect(body.claims).toEqual([]);
  });
});

describe("GET /:id/positioning-history — response shape is unchanged", () => {
  test("serves the materialised versions once there are two of them", async () => {
    const src = await seedCompetitor();
    await seedVersion(src.competitorId, T(1), {
      h1: "Track your collection",
      subheadline: "Know what you own",
      valueProps: ["Real-time pricing"],
    });
    await seedVersion(src.competitorId, T(20), { h1: "Buy, sell, trade", valueProps: ["Trading"] });

    const body = await (
      await competitorsApp.request(
        `/api/competitors/${src.competitorId}/positioning-history`,
        asUser(org.userId),
      )
    ).json();

    // Same keys the Positioning tab has always read.
    expect(body.versions[0]).toEqual({
      capturedAt: T(20).toISOString(),
      headline: "Buy, sell, trade",
      subheadline: null,
      valueProps: ["Trading"],
    });
    expect(body.versions[1].headline).toBe("Track your collection");
  });

  test("falls back to the snapshot walk until the backfill has run", async () => {
    // A single stored version is not a history — the tab needs a now AND a before,
    // and blanking a panel that used to work would be the regression.
    const src = await seedCompetitor();
    await seedVersion(src.competitorId, T(20), { h1: "Only one stored" });
    await testDb.insert(snapshots).values([
      {
        id: `snap-a-${src.competitorId}`,
        monitorId: src.monitorId,
        r2Key: "a",
        contentHash: "a",
        status: "success",
        scrapedAt: T(20),
        homepageStructure: { hero: { headline: "Newer from snapshots" }, sections: [] },
      },
      {
        id: `snap-b-${src.competitorId}`,
        monitorId: src.monitorId,
        r2Key: "b",
        contentHash: "b",
        status: "success",
        scrapedAt: T(2),
        homepageStructure: { hero: { headline: "Older from snapshots" }, sections: [] },
      },
    ]);

    const body = await (
      await competitorsApp.request(
        `/api/competitors/${src.competitorId}/positioning-history`,
        asUser(org.userId),
      )
    ).json();

    expect(body.versions.map((v: { headline: string }) => v.headline)).toEqual([
      "Newer from snapshots",
      "Older from snapshots",
    ]);
  });
});
