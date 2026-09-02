import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  compareLedger,
  hashMigration,
  journalSkew,
  readCommittedMigrations,
  type CommittedMigration,
  type JournalEntry,
} from "../src/ledger";

/**
 * The comparison behind `db:preflight`, `db:baseline` and `db:realign-journal`.
 *
 * All three are run by hand against a shared database and judged by reading their
 * output, so a wrong verdict here is a bad prod migration: "no drift, 0 pending" on a
 * database that is actually a migration behind, or a realign that rewrites a row it
 * does not own. None of that shows up until the deploy.
 */

const MIGRATIONS = resolve(import.meta.dir, "../migrations");

const migration = (over: Partial<CommittedMigration> & { tag: string }): CommittedMigration => ({
  idx: 0,
  when: 1_000,
  hash: `hash-${over.tag}`,
  ...over,
});

describe("hashMigration", () => {
  // Pinned to a literal, not recomputed: the point is that the ALGORITHM cannot move.
  // drizzle's migrator hashes the raw file with sha256, and every ledger row ever
  // written carries that digest — change it and every environment reads as full drift.
  test("is sha256 of the raw file content", () => {
    expect(hashMigration('CREATE TABLE "x" ("id" text);\n')).toBe(
      "31884be13767645e745dea8c9f40da56d7f8aca89d6cbfe12772f4e60ef0bc59",
    );
  });

  test("nothing is trimmed or normalised away", () => {
    const sql = 'CREATE TABLE "x" ("id" text);\n';
    expect(hashMigration(sql)).not.toBe(hashMigration(sql.trim()));
    expect(hashMigration(sql)).not.toBe(hashMigration(sql.replace(/"/g, "")));
  });
});

describe("readCommittedMigrations", () => {
  test("every committed migration in this repo hashes", () => {
    const { committed, missingFiles } = readCommittedMigrations(MIGRATIONS);
    expect(missingFiles).toEqual([]);
    expect(committed.length).toBeGreaterThan(60);
    for (const m of committed) {
      expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(m.tag).toBeTruthy();
    }
  });

  test("tags are unique — two entries hashing to one tag would hide a pending migration", () => {
    const { committed } = readCommittedMigrations(MIGRATIONS);
    expect(new Set(committed.map((m) => m.tag)).size).toBe(committed.length);
  });

  // The path `src/migrate.ts` hands the runtime migrator on every Coolify pre-deploy.
  // Nothing else in the repo would fail if it stopped resolving: the deploy would just
  // migrate nothing and report success.
  test("the folder src/migrate.ts resolves is the one holding the journal", () => {
    const fromMigrateTs = resolve(import.meta.dir, "../src", "../migrations");
    expect(fromMigrateTs).toBe(MIGRATIONS);
    expect(existsSync(resolve(fromMigrateTs, "meta/_journal.json"))).toBe(true);
  });
});

describe("journalSkew", () => {
  const entries = (...whens: number[]): JournalEntry[] =>
    whens.map((when, idx) => ({ idx, tag: `00${idx}${idx}_m`, when }));

  test("a monotonic journal reports nothing", () => {
    expect(journalSkew(entries(1, 2, 3))).toEqual([]);
  });

  // 0062 was generated on a machine whose clock trailed 0060/0061 by a day. The
  // migrator compares against the HIGHEST created_at, so it skipped 0062 and printed
  // "Migrations applied".
  test("an entry generated behind its predecessor is unreachable", () => {
    const skew = journalSkew(entries(100, 300, 200));
    expect(skew).toEqual([{ tag: "0022_m", when: 200, blockedBy: 300 }]);
  });

  // The `<=`, not `<`: the migrator's test is strict, so an exact tie is skipped too.
  // Two `drizzle-kit generate` runs in the same millisecond produce exactly this.
  test("an exact tie is skipped as surely as a dip", () => {
    expect(journalSkew(entries(100, 200, 200)).map((s) => s.tag)).toEqual(["0022_m"]);
  });

  test("every entry behind the running maximum is reported, not just the first", () => {
    const skew = journalSkew(entries(100, 500, 200, 300));
    expect(skew.map((s) => s.tag)).toEqual(["0022_m", "0033_m"]);
    expect(skew.every((s) => s.blockedBy === 500)).toBe(true);
  });

  test("the committed journal is reachable end to end", () => {
    const { committed } = readCommittedMigrations(MIGRATIONS);
    expect(journalSkew(committed)).toEqual([]);
  });
});

describe("compareLedger", () => {
  const a = migration({ tag: "0000_a", when: 100, hash: "aaa" });
  const b = migration({ tag: "0001_b", when: 200, hash: "bbb" });

  test("a ledger holding both files leaves nothing pending", () => {
    const out = compareLedger(
      [a, b],
      [
        { hash: "aaa", created_at: "100" },
        { hash: "bbb", created_at: "200" },
      ],
    );
    expect(out.pending).toEqual([]);
    expect(out.drift).toEqual([]);
    expect(out.misdated).toEqual([]);
    expect(out.applied.map((m) => m.tag)).toEqual(["0000_a", "0001_b"]);
  });

  // The number `db:preflight` prints as "PENDING (will run)" — the one figure read
  // before a shared-env migrate.
  test("a committed file with no ledger row is pending", () => {
    const out = compareLedger([a, b], [{ hash: "aaa", created_at: "100" }]);
    expect(out.pending.map((m) => m.tag)).toEqual(["0001_b"]);
  });

  test("a ledger row we no longer hold is drift, and never counts as applied", () => {
    const out = compareLedger([a], [{ hash: "ghost", created_at: "50" }]);
    expect(out.drift.map((r) => r.hash)).toEqual(["ghost"]);
    expect(out.applied).toEqual([]);
    expect(out.pending.map((m) => m.tag)).toEqual(["0000_a"]);
  });

  // created_at is a bigint, so postgres-js hands it back as a string. Comparing it to
  // the journal's number without the coercion would mark every single row misdated and
  // send `realign-journal --apply` rewriting the whole ledger.
  test("a string created_at equal to the journal is not drift", () => {
    expect(compareLedger([a], [{ hash: "aaa", created_at: "100" }]).misdated).toEqual([]);
    expect(compareLedger([a], [{ hash: "aaa", created_at: 100 }]).misdated).toEqual([]);
  });

  test("a misdated row is reported with the id realign needs to repair it", () => {
    const out = compareLedger([a], [{ id: 7, hash: "aaa", created_at: "99" }]);
    expect(out.misdated).toEqual([
      { tag: "0000_a", was: 99, now: 100, row: { id: 7, hash: "aaa", created_at: "99" } },
    ]);
  });

  // It RAN — only its bookkeeping is wrong. Counting it pending would send db:migrate
  // replaying a migration against a database that already has it.
  test("a misdated row is still applied, never pending", () => {
    const out = compareLedger([a], [{ hash: "aaa", created_at: "99" }]);
    expect(out.applied.map((m) => m.tag)).toEqual(["0000_a"]);
    expect(out.pending).toEqual([]);
  });

  // realign-journal only ever writes `misdated`. A row matching nothing we hold has to
  // stay out of it: rewriting another tool's bookkeeping row is not repair.
  test("drift is never offered to realign as something to repair", () => {
    const out = compareLedger([a], [{ id: 1, hash: "someone-elses", created_at: "1" }]);
    expect(out.misdated).toEqual([]);
    expect(out.drift).toHaveLength(1);
  });

  // What `db:baseline` writes on an environment built with `db:push`: one row per
  // committed migration, hash and `when` straight from the journal. The next
  // `db:migrate:deploy` must then find nothing to do.
  test("the ledger db:baseline writes leaves 0 pending, 0 drift, 0 misdated", () => {
    const { committed } = readCommittedMigrations(MIGRATIONS);
    const baselined = committed.map((m) => ({ hash: m.hash, created_at: String(m.when) }));
    const out = compareLedger(committed, baselined);
    expect(out.pending).toEqual([]);
    expect(out.drift).toEqual([]);
    expect(out.misdated).toEqual([]);
    expect(out.applied).toHaveLength(committed.length);
  });
});
