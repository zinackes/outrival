import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { buildDeltaProof, formatExcerpts } from "@outrival/shared";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearSharedOverrides, setSharedOverrides } from "./shared-mock";

// The two-pass double capture (Véracité Intelligence v2 P2), end to end against a
// real in-process Postgres, with the page itself stubbed.
//
// The load-bearing assertion is the one that looks like nothing happened: a
// verification that could not run must EMIT. The gate exists to stop a signal the
// page does not back up, never to stop a signal our own scraper could not re-fetch.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let runVerify: (payload: {
  changeId: string;
  pass: "quick" | "independent";
  classification?: unknown;
}) => Promise<Record<string, unknown>>;

interface Enqueued {
  changeId: string;
  pass?: string;
  classification?: unknown;
  skipVerification?: boolean;
}
let signalEnqueued: Enqueued[] = [];
let verifyEnqueued: Enqueued[] = [];

/** What the stubbed re-capture serves, and how. */
let captureText = "";
let captureLevel: 0 | 1 = 1;
let captureThrows: Error | null = null;
let captureCalls = 0;

const DIFF = ["- Starter plan is $79 per month", "+ Starter plan is $99 per month"].join("\n");
const PROOF = buildDeltaProof({ diffText: DIFF });
const AFTER_PAGE = "Plans and pricing. Starter plan is $99 per month. Contact sales for more.";
const BEFORE_PAGE = "Plans and pricing. Starter plan is $79 per month. Contact sales for more.";

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const realScrapers = await import("@outrival/scrapers");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;

  mock.module("@outrival/queue", () => ({
    ...realQueue,
    NonRetriable: realQueue.NonRetriable,
    generateSignal: {
      queue: "generate-signal",
      enqueue: async (payload: Enqueued) => {
        signalEnqueued.push(payload);
        return "job-id";
      },
    },
    verifySignalDelta: {
      queue: "verify-signal-delta",
      enqueue: async (payload: Enqueued) => {
        verifyEnqueued.push(payload);
        return "job-id";
      },
    },
  }));

  mock.module("@outrival/scrapers", () => ({
    ...realScrapers,
    closeScraperBrowsers: async () => {},
    scrapePage: async () => {
      captureCalls += 1;
      if (captureThrows) throw captureThrows;
      return {
        html: `<html><body><p>${captureText}</p></body></html>`,
        text: captureText,
        screenshotBuffer: Buffer.alloc(0),
        metadata: { url: "https://acme.test/pricing", scrapedWith: "browser" },
        statusCode: 200,
        level: captureLevel,
        attempts: 1,
      };
    },
  }));

  ({ runVerifySignalDelta: runVerify } = await import("../src/core/verify-signal-delta"));
});

afterAll(() => {
  clearSharedOverrides();
  return closeDb();
});

beforeEach(() => {
  signalEnqueued = [];
  verifyEnqueued = [];
  captureText = AFTER_PAGE;
  captureLevel = 1;
  captureThrows = null;
  captureCalls = 0;
  setSharedOverrides({ uploadToR2: async () => {} });
});

let seq = 0;

async function seedPending(
  opts: { captureMethod?: string; sourceType?: string; url?: string } = {},
) {
  const n = ++seq;
  const orgId = `org-v${n}`;
  const competitorId = `cmp-v${n}`;
  await testDb.insert(schema.organizations).values({ id: orgId, name: `Org ${n}`, slug: `org-v${n}` });
  await testDb
    .insert(schema.competitors)
    .values({ id: competitorId, orgId, name: `Competitor ${n}`, url: "https://acme.test" });
  const [monitor] = await testDb
    .insert(schema.monitors)
    .values({
      competitorId,
      sourceType: (opts.sourceType ?? "pricing") as "pricing",
      frequency: "daily",
      config: { url: opts.url ?? "https://acme.test/pricing" },
    })
    .returning();
  const [snapshot] = await testDb
    .insert(schema.snapshots)
    .values({
      monitorId: monitor!.id,
      r2Key: `snapshots/${competitorId}/pricing/${n}`,
      contentHash: `hash-v${n}`,
      status: "success",
      captureMethod: opts.captureMethod ?? "rendered",
      contentSize: AFTER_PAGE.length,
    })
    .returning();
  const [change] = await testDb
    .insert(schema.changes)
    .values({
      monitorId: monitor!.id,
      snapshotAfterId: snapshot!.id,
      diffText: DIFF,
      diffType: "text",
    })
    .returning();
  const [verification] = await testDb
    .insert(schema.signalVerifications)
    .values({
      changeId: change!.id,
      competitorId,
      monitorId: monitor!.id,
      deltaFingerprint: PROOF.fingerprint,
      firstExcerpt: formatExcerpts(PROOF),
      outcome: "pending",
    })
    .returning();
  return { orgId, competitorId, monitor: monitor!, change: change!, verification: verification! };
}

const outcomeOf = async (changeId: string) => {
  const [row] = await testDb
    .select()
    .from(schema.signalVerifications)
    .where(eq(schema.signalVerifications.changeId, changeId));
  return row!;
};

describe("quick pass", () => {
  test("a reproduced delta schedules the independent capture and emits nothing yet", async () => {
    const seed = await seedPending();
    const result = await runVerify({ changeId: seed.change.id, pass: "quick" });

    expect(result.outcome).toBe("pending");
    expect(signalEnqueued).toHaveLength(0);
    expect(verifyEnqueued).toHaveLength(1);
    expect(verifyEnqueued[0]!.pass).toBe("independent");

    const row = await outcomeOf(seed.change.id);
    expect(row.outcome).toBe("pending");
    expect(row.quickCheckAt).not.toBeNull();
    expect(row.independentCheckAt).toBeNull();
  });

  test("a transient that is already gone retains the signal, silently", async () => {
    const seed = await seedPending();
    captureText = BEFORE_PAGE; // the "new" price was never really published

    const result = await runVerify({ changeId: seed.change.id, pass: "quick" });

    expect(result.outcome).toBe("not_reproduced");
    expect(signalEnqueued).toHaveLength(0);
    expect(verifyEnqueued).toHaveLength(0);
    expect((await outcomeOf(seed.change.id)).outcome).toBe("not_reproduced");
  });
});

describe("independent pass", () => {
  test("a reproduced delta confirms and hands the emission back", async () => {
    const seed = await seedPending();
    await runVerify({ changeId: seed.change.id, pass: "quick" });
    signalEnqueued = [];
    verifyEnqueued = [];

    const result = await runVerify({
      changeId: seed.change.id,
      pass: "independent",
      classification: { category: "pricing", severity: "critical" },
    });

    expect(result.outcome).toBe("confirmed");
    expect(signalEnqueued).toHaveLength(1);
    expect(signalEnqueued[0]!.changeId).toBe(seed.change.id);
    expect(signalEnqueued[0]!.classification).toEqual({ category: "pricing", severity: "critical" });

    const row = await outcomeOf(seed.change.id);
    expect(row.outcome).toBe("confirmed");
    expect(row.quickCheckAt).not.toBeNull();
    expect(row.independentCheckAt).not.toBeNull();
    expect(row.secondExcerpt).toContain("starter plan is $99 per month");
  });

  test("a page that flipped back is retained and never alerts", async () => {
    const seed = await seedPending();
    await runVerify({ changeId: seed.change.id, pass: "quick" });
    signalEnqueued = [];
    captureText = BEFORE_PAGE;

    const result = await runVerify({ changeId: seed.change.id, pass: "independent" });

    expect(result.outcome).toBe("not_reproduced");
    expect(signalEnqueued).toHaveLength(0);
    const row = await outcomeOf(seed.change.id);
    expect(row.outcome).toBe("not_reproduced");
    expect(row.secondExcerpt).toContain("missing:");
  });
});

describe("skipped never withholds a signal", () => {
  test("a refused re-capture (403) emits the signal unverified", async () => {
    const seed = await seedPending();
    captureThrows = new Error("blocked_403");

    const result = await runVerify({ changeId: seed.change.id, pass: "quick" });

    expect(result.outcome).toBe("skipped");
    expect(signalEnqueued).toHaveLength(1);
    expect((await outcomeOf(seed.change.id)).outcome).toBe("skipped");
  });

  test("a capture that came back through different glass emits rather than compares", async () => {
    const seed = await seedPending({ captureMethod: "static" });
    captureLevel = 1; // the re-capture had to render; the original did not

    const result = await runVerify({ changeId: seed.change.id, pass: "quick" });

    expect(result.reason).toBe("method_mismatch");
    expect(signalEnqueued).toHaveLength(1);
  });

  test("a degraded re-capture emits rather than judging the delta on a shell", async () => {
    const seed = await seedPending();
    captureText = "Loading";

    const result = await runVerify({ changeId: seed.change.id, pass: "quick" });

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("partial_capture");
    expect(signalEnqueued).toHaveLength(1);
  });

  test("a monitor with nowhere to go back to emits without fetching", async () => {
    const seed = await seedPending();
    await testDb
      .update(schema.snapshots)
      .set({ captureMethod: "feed" })
      .where(eq(schema.snapshots.id, seed.change.snapshotAfterId));

    const result = await runVerify({ changeId: seed.change.id, pass: "quick" });

    expect(result.reason).toBe("not_replayable");
    expect(captureCalls).toBe(0);
    expect(signalEnqueued).toHaveLength(1);
  });

  // code:SEC-15 — the re-capture is a second path that fetches a monitor URL, and
  // it trusted save-time validation. A monitor pointed at an internal address (an
  // edited competitor URL, a URL stored by an older validator) had its re-capture
  // issued from here. Treat it as not replayable: no fetch, and the signal still
  // emits — the gate exists to stop an unbacked signal, never one we declined to
  // re-fetch.
  test("an internal monitor URL is never re-fetched", async () => {
    const seed = await seedPending({ url: "http://169.254.169.254/latest/meta-data/" });

    const result = await runVerify({ changeId: seed.change.id, pass: "quick" });

    expect(result.reason).toBe("not_replayable");
    expect(captureCalls).toBe(0);
    expect(signalEnqueued).toHaveLength(1);
  });
});

describe("idempotence", () => {
  test("a settled verification never re-fetches and never emits twice", async () => {
    const seed = await seedPending();
    await runVerify({ changeId: seed.change.id, pass: "quick" });
    await runVerify({ changeId: seed.change.id, pass: "independent" });
    expect(signalEnqueued).toHaveLength(1);
    const fetchesSoFar = captureCalls;

    const replay = await runVerify({ changeId: seed.change.id, pass: "independent" });

    expect(replay.skipped).toBe(true);
    expect(captureCalls).toBe(fetchesSoFar);
    expect(signalEnqueued).toHaveLength(1);
  });

  test("one change costs at most two fetches", async () => {
    const seed = await seedPending();
    await runVerify({ changeId: seed.change.id, pass: "quick" });
    await runVerify({ changeId: seed.change.id, pass: "independent" });
    expect(captureCalls).toBe(2);
  });

  test("aborts terminally when no verification was ever opened", async () => {
    expect(runVerify({ changeId: "no-such-change", pass: "quick" })).rejects.toThrow();
  });
});
