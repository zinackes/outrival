import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { competitors, organizations, products } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// Which product a profile edit lands on, in a workspace that has several.
//
// Two profiles exist: `organizations.product_profile` (workspace-wide, predates
// multi-SKU, still what the weekly digest and the sectoral trends speak from) and
// `competitors.self_profile` (one per product, on its monitoring anchor). Settings no
// longer edits the first inline — profiles are edited on the product — so the two
// rules below are what keep them from describing different products:
//
//   1. a workspace-wide write targets the PRIMARY product's anchor, never whichever
//      self-competitor the database happens to return first;
//   2. a per-product edit only travels back up to the org profile when it is the
//      primary's, because a secondary SKU's positioning is a different product's.
let myProductApp: Hono;
let onboardingApp: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

const HOOK_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  installQueueMock();
  const { myProductRouter } = await import("../src/routes/my-product");
  const { onboardingRouter } = await import("../src/routes/onboarding");
  myProductApp = mountApp("/api/my-product", myProductRouter);
  onboardingApp = mountApp("/api/onboarding", onboardingRouter);
}, HOOK_TIMEOUT_MS);

// Per test, not per file: every test here PATCHes one of the two anchors, and the
// next one asserts on the profile that edit would already have rewritten.
beforeEach(async () => {
  await resetDb();
  A = await seedOrg(testDb, { plan: "pro" });

  // The OLDEST anchor belongs to the SECONDARY product: an unordered "find a self"
  // lookup lands here, so every assertion below would pass by accident if the
  // primary were also the oldest row.
  await seedProduct({
    id: "prod-secondary",
    name: "Scheduling",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    isPrimary: false,
    position: 1,
  });
  await seedProduct({
    id: "prod-primary",
    name: "Hosting",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    isPrimary: true,
    position: 0,
  });
}, HOOK_TIMEOUT_MS);

async function seedProduct(opts: {
  id: string;
  name: string;
  createdAt: Date;
  isPrimary: boolean;
  position: number;
}) {
  await testDb.insert(competitors).values({
    id: `self-${opts.id}`,
    orgId: A.orgId,
    name: opts.name,
    url: `https://${opts.id}.example.com`,
    type: "self",
    isUserProduct: true,
    createdAt: opts.createdAt,
  });
  await testDb.insert(products).values({
    id: opts.id,
    orgId: A.orgId,
    name: opts.name,
    selfCompetitorId: `self-${opts.id}`,
    isPrimary: opts.isPrimary,
    position: opts.position,
    createdAt: opts.createdAt,
  });
}

const setOrgProfile = (profile: Record<string, string>) =>
  testDb
    .update(organizations)
    .set({ productProfile: profile as never })
    .where(eq(organizations.id, A.orgId));

const orgProfile = async () =>
  (
    await testDb.query.organizations.findFirst({
      where: eq(organizations.id, A.orgId),
      columns: { productProfile: true },
    })
  )?.productProfile ?? null;

const selfProfileOf = async (productId: string) =>
  (
    await testDb.query.competitors.findFirst({
      where: eq(competitors.id, `self-${productId}`),
    })
  )?.selfProfile ?? null;

const patchProduct = (productId: string, body: Record<string, unknown>) =>
  myProductApp.request(
    `/api/my-product?productId=${productId}`,
    asUser(A.userId, A.email, { method: "PATCH", body: JSON.stringify(body) }),
  );

describe("PATCH /my-product — the org profile mirrors the primary only", () => {
  test("a primary edit reaches the workspace profile, keeping what it alone carries", async () => {
    await setOrgProfile({
      category: "Old category",
      audience: "Old audience",
      valueProp: "Old value",
      pricingModel: "Subscription, per seat",
    });

    const res = await patchProduct("prod-primary", {
      category: "Managed hosting",
      audience: "Agencies running client sites",
    });
    expect(res.status).toBe(200);

    const org = await orgProfile();
    expect(org?.category).toBe("Managed hosting");
    expect(org?.audience).toBe("Agencies running client sites");
    // Untouched by this edit, and the self profile has no counterpart for either:
    // the mirror can only preserve them, so it must not blank them.
    expect(org?.valueProp).toBe("Old value");
    expect(org?.pricingModel).toBe("Subscription, per seat");
  });

  test("a secondary edit stays on its own product", async () => {
    await setOrgProfile({
      category: "Managed hosting",
      audience: "Agencies running client sites",
      valueProp: "Old value",
      pricingModel: "Subscription, per seat",
    });

    const res = await patchProduct("prod-secondary", {
      category: "Appointment scheduling",
      audience: "Independent clinics",
    });
    expect(res.status).toBe(200);

    // The edit landed on the product it was made on…
    const self = await selfProfileOf("prod-secondary");
    expect(self?.category?.value).toBe("Appointment scheduling");
    expect(self?.audience?.value).toBe("Independent clinics");

    // …and the workspace profile still describes the primary. Without this the
    // weekly digest would speak as whichever SKU was edited last.
    const org = await orgProfile();
    expect(org?.category).toBe("Managed hosting");
    expect(org?.audience).toBe("Agencies running client sites");
  });
});

describe("PATCH /my-product with no product scope", () => {
  test("resolves the primary product, not the oldest anchor", async () => {
    const res = await myProductApp.request(
      "/api/my-product",
      asUser(A.userId, A.email, {
        method: "PATCH",
        body: JSON.stringify({ features: ["Zero-downtime deploys"] }),
      }),
    );
    expect(res.status).toBe(200);

    const primary = await selfProfileOf("prod-primary");
    expect(primary?.features?.value).toEqual(["Zero-downtime deploys"]);
    // Settings' unscoped controls (Change URL, stage, re-analysis) all land here, so
    // an org that promoted a newer product must not have them edit the older one.
    const secondary = await selfProfileOf("prod-secondary");
    expect(secondary?.features).toBeUndefined();
  });
});

describe("PATCH /onboarding/profile — the workspace-wide edit targets the primary", () => {
  test("it writes the primary's anchor, not the oldest self-competitor", async () => {
    // Give the secondary its own positioning first — the point of the last two
    // assertions is that this workspace-wide write leaves it alone.
    await patchProduct("prod-secondary", {
      category: "Appointment scheduling",
      audience: "Independent clinics",
    });

    const res = await onboardingApp.request(
      "/api/onboarding/profile",
      asUser(A.userId, A.email, {
        method: "PATCH",
        body: JSON.stringify({
          profile: {
            category: "Managed hosting",
            audience: "Agencies running client sites",
            valueProp: "Ship a client site without an ops team",
            pricingModel: "Subscription, per seat",
          },
          manualFields: ["valueProp"],
        }),
      }),
    );
    expect(res.status).toBe(200);

    const primary = await selfProfileOf("prod-primary");
    expect(primary?.valueProp?.value).toBe("Ship a client site without an ops team");
    // Hand-typed → sticky against the next auto-extraction.
    expect(primary?.valueProp?.isFromAutoDetect).toBe(false);

    // The older secondary anchor keeps the positioning of the product it describes.
    const secondary = await selfProfileOf("prod-secondary");
    expect(secondary?.category?.value).toBe("Appointment scheduling");
    expect(secondary?.valueProp).toBeUndefined();
  });
});
