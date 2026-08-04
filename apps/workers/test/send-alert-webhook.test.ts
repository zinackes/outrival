import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearSharedOverrides, setSharedOverrides } from "./shared-mock";

// send-alert's webhook channel used to call a second, unguarded sender
// (apps/workers/src/lib/webhook.ts, deleted) that threw on a non-ok response.
// It now calls the shared, SSRF-guarded sendWebhook, which returns a boolean
// and never throws. That is a real signature/contract change to the call
// site: this locks in that a `false` return is recorded as a failed alert
// (alerts.error set, sentAt left null) instead of being silently treated as
// delivered, which is what a plain import swap without adapting the branch
// would have done.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runSendAlert: typeof import("../src/core/send-alert").runSendAlert;

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;


  ({ runSendAlert } = await import("../src/core/send-alert"));
});

// Set per test, so this file owns sendWebhook while it runs whatever ran before it.
beforeEach(() => setSharedOverrides({ sendWebhook: async () => false }));

afterAll(async () => {
  clearSharedOverrides();
  if (closeDb) await closeDb();
});

test("a false return from sendWebhook records the alert as failed, not delivered", async () => {
  const orgId = "org-webhook-1";
  const competitorId = "cmp-webhook-1";
  const monitorId = "mon-webhook-1";
  const snapshotId = "snp-webhook-1";
  const changeId = "chg-webhook-1";
  const signalId = "sig-webhook-1";

  await testDb.insert(schema.organizations).values({
    id: orgId,
    name: "Webhook Org",
    slug: "webhook-org",
    plan: "pro", // pro+ has the webhook channel and realtimeAlerts
    webhookUrl: "https://hooks.example.com/outrival",
  });
  await testDb
    .insert(schema.competitors)
    .values({ id: competitorId, orgId, name: "Acme Co" });
  await testDb
    .insert(schema.monitors)
    .values({ id: monitorId, competitorId, sourceType: "homepage" });
  await testDb.insert(schema.snapshots).values({
    id: snapshotId,
    monitorId,
    r2Key: "k-webhook-1",
    contentHash: "h-webhook-1",
  });
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

  const result = (await runSendAlert({ signalId })) as { webhookSent: boolean };
  expect(result.webhookSent).toBe(false);

  const alertRows = await testDb.query.alerts.findMany({
    where: eq(schema.alerts.signalId, signalId),
  });
  const webhookAlert = alertRows.find((a) => a.channel === "webhook");
  expect(webhookAlert).toBeDefined();
  expect(webhookAlert?.sentAt).toBeNull();
  expect(webhookAlert?.error).toBeTruthy();
});
