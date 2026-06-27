import postgres from "postgres";
import { readFileSync } from "fs";
const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL_PROD=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!url) { console.error("no prod url"); process.exit(1); }
const sql = postgres(url, { ssl: "require" });
const migs = await sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 6`.catch(
  () => sql`select id, hash, created_at from "__drizzle_migrations" order by id desc limit 6`.catch((e) => [{ err: String(e) }]),
);
console.log("MIGRATIONS (recent):", JSON.stringify(migs, null, 1));
const cols = await sql`select column_name, data_type, column_default from information_schema.columns where table_name='two_factor' order by ordinal_position`;
console.log("two_factor COLUMNS:", JSON.stringify(cols, null, 1));
const pk = await sql`select count(*)::int as n from information_schema.tables where table_name='passkey'`;
console.log("passkey table exists:", pk[0].n === 1);
await sql.end();
