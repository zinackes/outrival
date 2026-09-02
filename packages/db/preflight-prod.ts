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
import { resolve } from "node:path";
import { compareLedger, readCommittedMigrations } from "./src/ledger";
import { loadProdUrl } from "./src/prod-url";

const direct = loadProdUrl();

const { committed, missingFiles } = readCommittedMigrations(resolve(__dirname, "migrations"));

const client = postgres(direct, { max: 1, ssl: "require" });
const ledger = (await client`
  select hash, created_at from drizzle.__drizzle_migrations order by created_at asc
`) as Array<{ hash: string; created_at: string }>;
await client.end();

const { pending, drift, skew } = compareLedger(committed, ledger);

console.log(`ledger rows: ${ledger.length}   committed migrations: ${committed.length}`);
if (missingFiles.length > 0) {
  console.log(`\n✗ JOURNAL ENTRIES WITH NO .sql FILE: ${missingFiles.join(", ")}`);
}

console.log(`\nJOURNAL ORDER CHECK (a 'when' at or below one already ahead is silently skipped):`);
for (const s of skew) console.log(`  ✗ SKEW  ${s.tag}  when=${s.when} <= ${s.blockedBy}`);
console.log("  (nothing above = order is monotonic)");

console.log(`\nDRIFT (ledger hashes matching no committed file): ${drift.length}`);
for (const d of drift) console.log(`  ✗ ${d.hash.slice(0, 12)}… (created_at ${d.created_at})`);

console.log(`\nPENDING (will run): ${pending.length}`);
for (const p of pending) console.log(`  → ${p.tag}`);

console.log(
  `\nverdict: ${drift.length === 0 ? "no drift" : "DRIFT — DO NOT MIGRATE"}, ` +
    `${pending.length} pending`,
);
