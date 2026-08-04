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
 * Writes nothing. Reads DATABASE_URL_PROD out of the repo .env.local.
 */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// A worktree carries no .env.local — secrets live in the main checkout. Walk up
// until one is found so this runs from either.
function loadEnv(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, ".env.local");
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("no .env.local found above " + __dirname);
}
const env = loadEnv();
const url = env
  .match(/^DATABASE_URL_PROD=(.+)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL_PROD not found in .env.local");
// Neon's `-pooler` endpoint holds a session open across a DDL transaction and the
// migrator hangs on it. Always talk to the direct endpoint for schema work.
const direct = url.replace("-pooler.", ".");

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
