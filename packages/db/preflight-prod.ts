/**
 * Read-only pre-flight before any shared-env `db:migrate`.
 *
 * A row COUNT looks healthy while a hash has drifted, and a drifted hash makes the
 * migrator either replay a migration or silently skip the one behind it. So this
 * compares the prod ledger against the committed journal entry by entry, hashing
 * each `.sql` exactly the way drizzle's migrator does, and prints:
 *
 *   - APPLIED   ledger row whose hash matches the committed file
 *   - DRIFT     ledger row whose hash matches NOTHING we hold  ← stop
 *   - PENDING   committed file with no ledger row              ← what will run
 *
 * Writes nothing. Reads DATABASE_URL_PROD through `src/prod-url.ts`.
 */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProdUrl } from "./src/prod-url";

const direct = loadProdUrl();

const journal = JSON.parse(
  readFileSync(resolve(__dirname, "migrations/meta/_journal.json"), "utf8"),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

// drizzle hashes the raw file content; the migrator splits on the breakpoint
// marker AFTER hashing, so the hash is of the whole file as committed.
const local = journal.entries.map((e) => {
  const sql = readFileSync(resolve(__dirname, `migrations/${e.tag}.sql`), "utf8");
  return { ...e, hash: createHash("sha256").update(sql).digest("hex") };
});

const client = postgres(direct, { max: 1, ssl: "require" });
const ledger = (await client`
  select hash, created_at from drizzle.__drizzle_migrations order by created_at asc
`) as Array<{ hash: string; created_at: string }>;
await client.end();

const byHash = new Map(local.map((l) => [l.hash, l]));
const applied = new Set<string>();
const drift: string[] = [];
for (const row of ledger) {
  const hit = byHash.get(row.hash);
  if (hit) applied.add(hit.tag);
  else drift.push(`${row.hash.slice(0, 12)}… (created_at ${row.created_at})`);
}

console.log(`ledger rows: ${ledger.length}   committed migrations: ${local.length}`);
console.log(`\nJOURNAL ORDER CHECK (a 'when' below its predecessor is silently skipped):`);
let prev = 0;
for (const l of local) {
  if (l.when < prev) console.log(`  ✗ SKEW  ${l.tag}  when=${l.when} < previous ${prev}`);
  prev = Math.max(prev, l.when);
}
console.log("  (nothing above = order is monotonic)");

console.log(`\nDRIFT (ledger hashes matching no committed file): ${drift.length}`);
for (const d of drift) console.log(`  ✗ ${d}`);

const pending = local.filter((l) => !applied.has(l.tag));
console.log(`\nPENDING (will run): ${pending.length}`);
for (const p of pending) console.log(`  → ${p.tag}`);

console.log(
  `\nverdict: ${drift.length === 0 ? "no drift" : "DRIFT — DO NOT MIGRATE"}, ` +
    `${pending.length} pending`,
);
