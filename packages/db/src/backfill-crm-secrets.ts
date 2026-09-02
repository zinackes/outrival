/**
 * One-shot backfill: encrypt the plaintext `crm_destinations.secret` rows that
 * predate AES-256-GCM at rest (code:SEC-08).
 *
 * The HMAC secret authenticating every webhook this product sends shipped as
 * cleartext next to `oauth_connections`, whose tokens have always been encrypted.
 * New writes go through `encryptSecret`; this walks the rows written before that.
 *
 * Idempotent: a row already carrying the `v1.` scheme prefix is skipped, so a re-run
 * writes 0 and a half-finished run is safe to resume. NON-destructive: it only ever
 * replaces a value with its own ciphertext, and reads back what it wrote to prove the
 * round-trip before moving on.
 *
 * Needs OAUTH_TOKEN_ENCRYPTION_KEY — the same key the API and the workers use. Run
 * once per environment, AFTER deploying the code that reads both shapes:
 * `pnpm --filter @outrival/db db:backfill-crm-secrets`.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import postgres from "postgres";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@outrival/shared";

const rootEnv = resolve(__dirname, "../../../.env.local");
if (existsSync(rootEnv)) config({ path: rootEnv });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (!process.env.OAUTH_TOKEN_ENCRYPTION_KEY) {
  throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY is not set: nothing to encrypt these secrets with");
}

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  const rows = await sql<{ id: string; secret: string }[]>`
    SELECT id, secret FROM crm_destinations WHERE secret IS NOT NULL`;
  console.log(`Destinations with a secret: ${rows.length}`);

  let encrypted = 0;
  let skipped = 0;
  for (const row of rows) {
    if (isEncryptedSecret(row.secret)) {
      skipped += 1;
      continue;
    }
    const payload = encryptSecret(row.secret);
    // Prove the round-trip BEFORE writing: a key that encrypts but cannot decrypt
    // its own output would otherwise silently destroy every signing secret.
    if (decryptSecret(payload) !== row.secret) {
      throw new Error(`Round-trip check failed for destination ${row.id}: aborting, nothing lost`);
    }
    await sql`UPDATE crm_destinations SET secret = ${payload} WHERE id = ${row.id}`;
    encrypted += 1;
  }

  await sql.end();
  console.log(`Encrypted ${encrypted} row(s), ${skipped} already encrypted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
