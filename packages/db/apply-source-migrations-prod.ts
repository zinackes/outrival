import postgres from "postgres";
import { resolve4 } from "node:dns/promises";
import { connect } from "node:net";
import { loadProdUrl } from "./src/prod-url";

// Idempotent, position-agnostic enum additions for migrations 0041 + 0042. No
// BEFORE clause: enum order is cosmetic and prod may lack 'custom' (0039). Safe to
// re-run; a no-op when the deploy later replays the versioned migrations.
const STATEMENTS = [
  `ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'hackernews'`,
  `ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'wellknown'`,
  `ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'comparison_page'`,
  `ALTER TYPE "public"."category" ADD VALUE IF NOT EXISTS 'api_developer'`,
];

const raw = loadProdUrl();
const u = new URL(raw);
const host = u.hostname;
const port = Number(u.port || 5432);

function probe(ip: string, ms = 4000): Promise<boolean> {
  return new Promise((res) => {
    const s = connect({ host: ip, port, family: 4 });
    const done = (ok: boolean) => {
      s.destroy();
      res(ok);
    };
    s.setTimeout(ms);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

async function tryConnect(): Promise<ReturnType<typeof postgres> | null> {
  // 1) plain hostname (works when the network path is healthy).
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sql = postgres(raw, { ssl: "require", max: 1, connect_timeout: 20, prepare: false });
    try {
      await sql`select 1`;
      console.log(`connected via hostname (attempt ${attempt})`);
      return sql;
    } catch (e) {
      console.log(`hostname attempt ${attempt} failed: ${(e as Error).message?.slice(0, 80)}`);
      await sql.end().catch(() => {});
    }
  }
  // 2) IP-pin fallback: pick a TCP-reachable IPv4, keep the hostname as SNI.
  const ips = await resolve4(host).catch(() => [] as string[]);
  console.log(`resolved ${ips.length} IPv4; probing…`);
  for (const ip of ips) {
    const ok = await probe(ip);
    console.log(`  ${ip} → ${ok ? "OPEN" : "timeout"}`);
    if (!ok) continue;
    const sql = postgres({
      host: ip,
      port,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      ssl: { servername: host, rejectUnauthorized: false },
      max: 1,
      connect_timeout: 20,
      prepare: false,
    });
    try {
      await sql`select 1`;
      console.log(`connected via pinned IP ${ip}`);
      return sql;
    } catch (e) {
      console.log(`  ${ip} handshake failed: ${(e as Error).message?.slice(0, 80)}`);
      await sql.end().catch(() => {});
    }
  }
  return null;
}

const sql = await tryConnect();
if (!sql) {
  console.error("UNREACHABLE: could not open a Postgres connection to prod from here");
  process.exit(2);
}

try {
  const before = (await sql`
    select e.enumlabel, t.typname from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname in ('source_type','category')
      and e.enumlabel in ('hackernews','wellknown','comparison_page','api_developer')
  `) as { enumlabel: string; typname: string }[];
  console.log("PRE existing (of the 4):", JSON.stringify(before.map((r) => r.enumlabel)));

  for (const stmt of STATEMENTS) {
    await sql.unsafe(stmt);
    console.log("APPLIED:", stmt.replace(/"public"\."/g, "").replace(/"/g, ""));
  }

  const st = (await sql`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='source_type' and enumlabel in ('hackernews','wellknown','comparison_page')`) as { enumlabel: string }[];
  const cat = (await sql`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='category' and enumlabel='api_developer'`) as { enumlabel: string }[];
  const sourceOk = ["hackernews", "wellknown", "comparison_page"].every((v) => st.some((r) => r.enumlabel === v));
  const catOk = cat.length === 1;
  console.log("POST source_type has all 3:", sourceOk, "| category has api_developer:", catOk);
  if (!sourceOk || !catOk) process.exit(3);
  console.log("✅ all 4 enum values present in prod");
} finally {
  await sql.end();
}
