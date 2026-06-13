import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

// The schema moved from `db:push` (which drifted + dropped columns in prod) to
// versioned migrations. These guard that pipeline: the journal stays consistent
// with the files on disk, the whole set applies cleanly from 0000, and the
// audit-critical tables/columns the rest of the system depends on are actually
// produced by the migrations (not just by a stray local `db:push`).

const MIGRATIONS = resolve(import.meta.dir, "../migrations");

interface JournalEntry {
  idx: number;
  tag: string;
}

const journal: { entries: JournalEntry[] } = JSON.parse(
  readFileSync(resolve(MIGRATIONS, "meta/_journal.json"), "utf8"),
);

describe("migration journal integrity", () => {
  const sqlFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));

  test("indices are contiguous and ordered from 0", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  test("every journal entry has its .sql file and snapshot", () => {
    for (const e of journal.entries) {
      expect(sqlFiles).toContain(`${e.tag}.sql`);
      const snap = String(e.idx).padStart(4, "0");
      expect(() => readFileSync(resolve(MIGRATIONS, `meta/${snap}_snapshot.json`))).not.toThrow();
    }
  });

  test("no orphan .sql files outside the journal", () => {
    expect(sqlFiles.length).toBe(journal.entries.length);
  });
});

describe("migrations apply to a fresh database", () => {
  let client: PGlite;

  beforeAll(async () => {
    client = new PGlite();
    const db = drizzle(client);
    // Throws if any migration fails to apply — the core regression this catches.
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  // PGlite (WASM) left open makes bun exit non-zero even when tests pass.
  afterAll(async () => {
    await client.close();
  });

  async function publicTables(): Promise<Set<string>> {
    const r = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    return new Set(r.rows.map((x) => x.table_name));
  }

  async function columnsOf(table: string): Promise<Set<string>> {
    const r = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
      [table],
    );
    return new Set(r.rows.map((x) => x.column_name));
  }

  test("foundational relational + analytics tables exist", async () => {
    const tables = await publicTables();
    for (const t of [
      // core domain
      "organizations", "users", "competitors", "monitors", "snapshots",
      "changes", "signals", "digests", "alerts", "notifications",
      "battle_cards", "competitor_candidates", "job_postings", "reviews",
      // patch-26 moderation
      "org_notification_preferences", "org_relevance_threshold", "signal_batches",
      // patch-28 multi-product
      "products", "product_competitors",
      // patch-30 staged extraction
      "parser_extractors",
      // patch-27 forced rescans
      "forced_rescan_log",
      // analytics (ex-ClickHouse → Postgres)
      "scrape_runs", "ai_runs", "extraction_runs", "platform_detection_runs",
      "review_scores", "pricing_history", "job_counts",
    ]) {
      expect(tables.has(t)).toBe(true);
    }
  });

  test("audit-critical columns are present (drift sentinels)", async () => {
    const signals = await columnsOf("signals");
    for (const c of ["product_ids", "dispatched_channel", "relevance_score", "filtered_reason"]) {
      expect(signals.has(c)).toBe(true);
    }
    expect((await columnsOf("competitors")).has("platform_profile")).toBe(true);
    expect((await columnsOf("monitors")).has("requires_level")).toBe(true);
    expect((await columnsOf("job_postings")).has("salary_currency")).toBe(true);
  });
});
