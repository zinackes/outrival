/**
 * The prod connection string, for the local operator scripts that talk to prod:
 * `db:preflight`, `checkprod.ts`, `apply-source-migrations-prod.ts`.
 *
 * It used to be written once per script, three times, and had drifted three ways
 * (`code:DEB-11`): only one walked up for the `.env.local` that a worktree may not
 * carry, only one anchored the match — an unanchored one happily reads a commented
 * out line — and only one swapped Neon's `-pooler` host for the direct endpoint.
 * So the script that runs `ALTER TYPE` was the one still talking to the pooler,
 * which is the endpoint that hangs on DDL.
 *
 * Always hands back the DIRECT endpoint: every caller either runs DDL or reads the
 * migration ledger, and neither wants a pooled session. Reads only, and the value
 * is never logged.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadProdUrl(): string {
  let dir: string = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, ".env.local");
    if (existsSync(candidate)) {
      const url = readFileSync(candidate, "utf8")
        .match(/^DATABASE_URL_PROD=(.+)$/m)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "");
      if (!url) throw new Error(`DATABASE_URL_PROD not found in ${candidate}`);
      // Neon's `-pooler` endpoint holds a session open across a DDL transaction and
      // the migrator hangs on it. Schema work talks to the direct endpoint.
      return url.replace("-pooler.", ".");
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no .env.local found above ${__dirname}`);
}
