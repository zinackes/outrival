process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "a".repeat(64);

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { encryptSecret } from "@outrival/shared";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearSharedOverrides, setSharedOverrides } from "./shared-mock";

// code:SEC-08 — crm_destinations.secret is AES-256-GCM at rest now. send-alert signs
// the outbound push with it, so it has to decrypt the column instead of handing the
// ciphertext to the HMAC: doing the latter still produces a signature, just one no
// receiver can verify, and nothing in the pipeline would have reported it.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runSendAlert: typeof import("../src/core/send-alert").runSendAlert;

let seenSecrets: (string | null)[] = [];

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  ({ runSendAlert } = await import("../src/core/send-alert"));
});

beforeEach(() => {
  seenSecrets = [];
  setSharedOverrides({
    sendWebhook: (async (_url: string, secret: string | null) => {
      seenSecrets.push(secret);
      return true;
    }) as never,
  });
});

afterAll(async () => {
  clearSharedOverrides();
  if (closeDb) await closeDb();
});

/** A signal needs monitor + snapshot + change to exist. */
async function seedSignal(suffix: string, orgId: string): Promise<string> {
  const competitorId = `cmp-${suffix}`;
  const monitorId = `mon-${suffix}`;
  const snapshotId = `snp-${suffix}`;
  const changeId = `chg-${suffix}`;
  const signalId = `sig-${suffix}`;

  await testDb.insert(schema.competitors).values({ id: competitorId, orgId, name: "Acme Co" });
  await testDb
    .insert(schema.monitors)
    .values({ id: monitorId, competitorId, sourceType: "homepage" });
  await testDb
    .insert(schema.snapshots)
    .values({ id: snapshotId, monitorId, r2Key: `k-${suffix}`, contentHash: `h-${suffix}` });
  await testDb.insert(schema.changes).values({
    id: changeId,
    monitorId,
    snapshotAfterId: snapshotId,
    diffText: "something changed",
    diffType: "text",
  });
  await testDb.insert(schema.signals).values({
    id: signalId,
    changeId,
    orgId,
    competitorId,
    severity: "high",
    category: "product",
    insight: "Acme shipped a new feature",
  });
  return signalId;
}

describe("send-alert: CRM destination signing secret", () => {
  test("signs with the decrypted secret, never with the stored ciphertext", async () => {
    const orgId = "org-crm-1";
    const plaintext = "whsec_signing_key";
    const ciphertext = encryptSecret(plaintext);

    await testDb
      .insert(schema.organizations)
      .values({ id: orgId, name: "CRM Org", slug: "crm-org", plan: "business" });
    await testDb.insert(schema.crmDestinations).values({
      id: "crm-dest-1",
      orgId,
      name: "Zapier",
      url: "https://hooks.zapier.com/hooks/catch/1/abc",
      secret: ciphertext,
    });

    const signalId = await seedSignal("crm-1", orgId);
    await runSendAlert({ signalId });

    expect(seenSecrets).toEqual([plaintext]);
    expect(seenSecrets).not.toContain(ciphertext);
  });

  test("a row still holding pre-backfill plaintext keeps signing unchanged", async () => {
    const orgId = "org-crm-2";
    await testDb
      .insert(schema.organizations)
      .values({ id: orgId, name: "Legacy Org", slug: "legacy-org", plan: "business" });
    await testDb.insert(schema.crmDestinations).values({
      id: "crm-dest-2",
      orgId,
      name: "Legacy",
      url: "https://hooks.zapier.com/hooks/catch/2/abc",
      secret: "whsec_legacy_plaintext",
    });

    const signalId = await seedSignal("crm-2", orgId);
    await runSendAlert({ signalId });

    expect(seenSecrets).toEqual(["whsec_legacy_plaintext"]);
  });

  test("an undecryptable row drops that destination and leaves the others pushing", async () => {
    const orgId = "org-crm-3";
    await testDb
      .insert(schema.organizations)
      .values({ id: orgId, name: "Mixed Org", slug: "mixed-org", plan: "business" });
    await testDb.insert(schema.crmDestinations).values([
      {
        id: "crm-dest-3-bad",
        orgId,
        name: "Corrupt",
        url: "https://hooks.zapier.com/hooks/catch/3/bad",
        secret: "v1.aaaa.bbbb.cccc",
      },
      {
        id: "crm-dest-3-ok",
        orgId,
        name: "Healthy",
        url: "https://hooks.zapier.com/hooks/catch/3/ok",
        secret: encryptSecret("whsec_ok"),
      },
    ]);

    const signalId = await seedSignal("crm-3", orgId);
    const result = (await runSendAlert({ signalId })) as { crmPushed: number };

    expect(seenSecrets).toEqual(["whsec_ok"]);
    expect(result.crmPushed).toBe(1);
  });
});
