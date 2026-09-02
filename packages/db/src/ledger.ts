import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The one definition of "which migrations has this database actually run", shared by
 * every script that reads drizzle's ledger: `baseline.ts` writes it, `preflight-prod.ts`
 * audits it before a shared-env migrate, and `realign-journal.ts` repairs it.
 *
 * The three used to hash and compare on their own. They agreed by luck — and the whole
 * failure mode here is a script reporting "no drift" under one convention while the
 * migrator applies (or silently skips) under another. One definition, three callers.
 */

export interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

export interface CommittedMigration extends JournalEntry {
  hash: string;
}

/** One row of `drizzle.__drizzle_migrations`. `created_at` is a bigint, so postgres-js hands back a string. */
export interface LedgerRow {
  hash: string;
  created_at: string | number;
}

/** A ledger row that IS one of ours but carries a timestamp the journal no longer agrees with. */
export interface Misdated<R extends LedgerRow> {
  tag: string;
  was: number;
  now: number;
  row: R;
}

/** A journal entry the runtime migrator can never reach. See `journalSkew`. */
export interface Skew {
  tag: string;
  when: number;
  /** the highest `when` already ahead of it */
  blockedBy: number;
}

export interface LedgerComparison<R extends LedgerRow> {
  applied: CommittedMigration[];
  /** committed but never run — exactly what the next `db:migrate` will execute */
  pending: CommittedMigration[];
  /** ledger rows matching no committed file: the database ran something we no longer hold */
  drift: R[];
  misdated: Misdated<R>[];
  skew: Skew[];
}

/**
 * drizzle hashes the RAW file content. The migrator splits on the `--> statement-breakpoint`
 * marker only after hashing, so the hash covers the file exactly as committed — reformat a
 * migration and every environment that ran it reads as drift.
 */
export function hashMigration(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/**
 * The journal plus each entry's file hash. `missingFiles` is returned rather than thrown
 * because the three callers disagree on what to do about it (realign skips, preflight
 * reports) — but none of them may pretend the entry is a normal committed migration.
 */
export function readCommittedMigrations(migrationsDir: string): {
  committed: CommittedMigration[];
  missingFiles: string[];
} {
  const journal = JSON.parse(
    readFileSync(resolve(migrationsDir, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  const committed: CommittedMigration[] = [];
  const missingFiles: string[] = [];
  for (const entry of journal.entries) {
    const file = resolve(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(file)) {
      missingFiles.push(entry.tag);
      continue;
    }
    committed.push({ ...entry, hash: hashMigration(readFileSync(file, "utf8")) });
  }
  return { committed, missingFiles };
}

/**
 * Journal entries the runtime migrator will never apply.
 *
 * It decides with one comparison — `Number(lastDbMigration.created_at) < migration.folderMillis`,
 * where `lastDbMigration` is the row with the HIGHEST created_at. So an entry whose `when`
 * is at or below a timestamp already ahead of it is unreachable, and the run still prints
 * "Migrations applied". Note the `<=`: an exact tie is skipped too, which is what a
 * same-millisecond pair of `drizzle-kit generate` runs produces.
 */
export function journalSkew(entries: readonly JournalEntry[]): Skew[] {
  const skew: Skew[] = [];
  let highest = -Infinity;
  for (const e of entries) {
    if (highest !== -Infinity && e.when <= highest) {
      skew.push({ tag: e.tag, when: e.when, blockedBy: highest });
    }
    highest = Math.max(highest, e.when);
  }
  return skew;
}

/** Match the committed migrations against what the database says it ran. Reads nothing, writes nothing. */
export function compareLedger<R extends LedgerRow>(
  committed: readonly CommittedMigration[],
  ledger: readonly R[],
): LedgerComparison<R> {
  const byHash = new Map(committed.map((m) => [m.hash, m]));
  const appliedTags = new Set<string>();
  const drift: R[] = [];
  const misdated: Misdated<R>[] = [];
  for (const row of ledger) {
    const hit = byHash.get(row.hash);
    if (!hit) {
      drift.push(row);
      continue;
    }
    appliedTags.add(hit.tag);
    const was = Number(row.created_at);
    if (was !== hit.when) misdated.push({ tag: hit.tag, was, now: hit.when, row });
  }
  return {
    applied: committed.filter((m) => appliedTags.has(m.tag)),
    pending: committed.filter((m) => !appliedTags.has(m.tag)),
    drift,
    misdated,
    skew: journalSkew(committed),
  };
}
