import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { backfillRuns, extractionRuns } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { installAppMocks, mountApp } from "./app-harness";

// GET /api/admin/capabilities (plan 021) — behavioural liveness readout: for every
// optional capability, has it written a row recently (or, for the two env/flag-based
// entries, what does the switch itself say)? The route caches its payload for at
// least 60s the way /dependencies does, so a second call inside that window would
// otherwise see stale data. Each scenario below re-imports the router through a
// cache-busted specifier to get a fresh module instance (a fresh, empty module-level
// cache) instead of racing the TTL — the mocked db underneath is unaffected, since
// mock.module resolves "@outrival/db" independently of the query string on this
// module's own specifier.

let testDb: TestDb;
let closeDb: () => Promise<void>;

const HOOK_TIMEOUT_MS = 30_000;
const ALL_KEYS = [
  "archive_backfill",
  "staged_extraction",
  "platform_detection",
  "ai_visibility",
  "faithfulness_gate",
  "standing_queries",
  "share_links",
  "crm_webhook",
  "ask",
  "signal_comments",
  "saved_views",
  "passkeys",
  "visual_diff",
  "multi_user",
];

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
}, HOOK_TIMEOUT_MS);

let bust = 0;
async function freshApp(): Promise<Hono> {
  const mod = (await import(`../src/routes/admin/system?bust=${++bust}`)) as typeof import(
    "../src/routes/admin/system"
  );
  return mountApp("/api/admin", mod.systemRouter);
}

type Capability = { key: string; label: string; observable: boolean; live: boolean; count: number; note: string | null };

let seq = 0;

describe("GET /api/admin/capabilities", () => {
  test("empty database: every capability is present and none of the data-driven ones are live", async () => {
    const app = await freshApp();
    const res = await app.request("/api/admin/capabilities");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities.length).toBe(ALL_KEYS.length);

    const byKey = Object.fromEntries(
      body.capabilities.map((c: Capability) => [c.key, c]),
    ) as Record<string, Capability>;
    expect(Object.keys(byKey).sort()).toEqual([...ALL_KEYS].sort());

    for (const key of ALL_KEYS) {
      expect(typeof byKey[key]?.observable).toBe("boolean");
    }

    // Data-driven probes: an empty database has no trace of any of these.
    for (const key of [
      "archive_backfill",
      "staged_extraction",
      "platform_detection",
      "ai_visibility",
      "faithfulness_gate",
      "standing_queries",
      "share_links",
      "crm_webhook",
      "ask",
      "signal_comments",
      "saved_views",
      "passkeys",
    ]) {
      expect(byKey[key]?.live).toBe(false);
      expect(byKey[key]?.count).toBe(0);
    }
    // Static flag, deliberately off — not a database probe.
    expect(byKey.multi_user?.live).toBe(false);
  });

  test("a backfill_runs row inside the window makes archive_backfill live", async () => {
    await testDb.insert(backfillRuns).values({
      monitorId: `mon-${++seq}`,
      competitorId: `cmp-${seq}`,
      sourceType: "homepage",
      outcome: "change_triggered",
    });

    const app = await freshApp();
    const res = await app.request("/api/admin/capabilities");
    const body = await res.json();
    const backfill = body.capabilities.find((c: Capability) => c.key === "archive_backfill");
    expect(backfill.live).toBe(true);
    expect(backfill.count).toBe(1);
  });

  test("extraction_runs seeded with only ai_fallback rows reads as not live, with a note", async () => {
    await testDb.insert(extractionRuns).values({
      competitorId: `cmp-${++seq}`,
      sourceType: "pricing",
      domain: "example.com",
      resolution: "ai_fallback",
    });

    const app = await freshApp();
    const res = await app.request("/api/admin/capabilities");
    const body = await res.json();
    const staged = body.capabilities.find((c: Capability) => c.key === "staged_extraction");
    expect(staged.live).toBe(false);
    expect(staged.count).toBe(0);
    expect(staged.note).not.toBeNull();
    expect(staged.note).toContain("AI fallback");
  });

  test("the response never leaks an env value, only the boolean it decided", async () => {
    const marker = "totally-not-a-boolean-marker-9f31";
    process.env.VISUAL_DIFF_ENABLED = marker;
    try {
      const app = await freshApp();
      const res = await app.request("/api/admin/capabilities");
      const text = await res.text();
      expect(text).not.toContain(marker);

      const body = JSON.parse(text);
      const visualDiff = body.capabilities.find((c: Capability) => c.key === "visual_diff");
      expect(typeof visualDiff.live).toBe("boolean");
      expect(visualDiff.live).toBe(true); // the marker is not the literal string "false"
    } finally {
      delete process.env.VISUAL_DIFF_ENABLED;
    }
  });
});
