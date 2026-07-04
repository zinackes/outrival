/**
 * One-shot backfill: populate `user.email_canonical` on EXISTING accounts, then
 * report any canonical collisions.
 *
 * The anti-abuse uniqueness key (Gmail dots/+tag folded to one inbox) is filled
 * server-side by the Better Auth create hook for NEW sign-ups only. Existing rows
 * have it null, so the hook's duplicate-mailbox check can't see them and the
 * follow-up UNIQUE index can't be added. This walks every user, computes the
 * canonical form with the shared helper (identical logic to the hook), and writes
 * it back.
 *
 * Idempotent: only rows whose stored value differs are updated, so a re-run writes
 * 0. NON-destructive: it never merges or deletes — collisions are printed for a
 * human to resolve BEFORE the unique index is promoted, never auto-fixed.
 *
 * Run once per environment: `pnpm --filter @outrival/db db:backfill-email-canonical`.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import postgres from "postgres";
import { canonicalizeEmail } from "@outrival/shared";

const rootEnv = resolve(__dirname, "../../../.env.local");
if (existsSync(rootEnv)) config({ path: rootEnv });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  const rows = await sql<{ id: string; email: string; email_canonical: string | null }[]>`
    SELECT id, email, email_canonical FROM "user"`;
  console.log(`Users: ${rows.length}`);

  let updated = 0;
  for (const row of rows) {
    const canonical = canonicalizeEmail(row.email);
    if (canonical === row.email_canonical) continue;
    await sql`UPDATE "user" SET email_canonical = ${canonical} WHERE id = ${row.id}`;
    updated += 1;
  }
  console.log(`Backfilled email_canonical on ${updated} row(s).`);

  const collisions = await sql<
    { email_canonical: string; n: number; emails: string[] }[]
  >`
    SELECT email_canonical, count(*)::int AS n, array_agg(email ORDER BY created_at) AS emails
    FROM "user"
    WHERE email_canonical IS NOT NULL
    GROUP BY email_canonical
    HAVING count(*) > 1
    ORDER BY count(*) DESC`;

  await sql.end();

  if (collisions.length === 0) {
    console.log("No canonical collisions — safe to promote the index to UNIQUE.");
    return;
  }
  console.log(
    `\n⚠️  ${collisions.length} canonical collision(s) — resolve these before adding the UNIQUE index:`,
  );
  for (const c of collisions) {
    console.log(`  ${c.email_canonical} ×${c.n}: ${c.emails.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
