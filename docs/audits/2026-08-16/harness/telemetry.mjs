/**
 * Audit harness, telemetry: dump what ACTUALLY failed in prod, so the phase-4
 * critics ground their probes in evidence instead of guessing.
 *
 * Three read-only collectors, each skippable on its own:
 *   1. scrape_runs (Neon prod, DATABASE_URL_PROD): failure/refusal aggregates, 30d
 *   2. Sentry (API, SENTRY_AUTH_TOKEN + SENTRY_ORG): top unresolved issues, 30d
 *   3. pg-boss DLQ (ssh outrival -> outrival-pg): dead-lettered jobs + failure counts
 *
 * Run it YOURSELF from the repo root before session 3 (the DLQ needs your ssh key):
 *   node docs/audits/2026-08-16/harness/telemetry.mjs
 *
 * Writes ~/.outrival-audit/2026-08-16/telemetry/{scrape-runs,sentry,dlq}.json
 * Logs never print an env value, a connection string or a token.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const OUT_DIR = join(homedir(), ".outrival-audit", "2026-08-16", "telemetry");
const DAYS = 30;

/** First file that defines a var wins; values are never logged. */
function loadEnv(files) {
  const out = {};
  for (const f of files) {
    let txt;
    try {
      txt = readFileSync(join(cwd(), f), "utf8");
    } catch {
      continue;
    }
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const env = loadEnv([
  ".env.local",
  "apps/workers/.env",
  "apps/workers/.env.local",
  "apps/api/.env.local",
]);

const skips = [];
const written = [];

async function save(name, payload) {
  await writeFile(join(OUT_DIR, name), JSON.stringify(payload, null, 2));
  written.push(name);
}

/* ------------------------------------------------------------------ */
/* 1. scrape_runs aggregates (Neon prod, read-only)                    */
/* ------------------------------------------------------------------ */
async function collectScrapeRuns() {
  const url = env.DATABASE_URL_PROD;
  if (!url) return skips.push("scrape-runs: DATABASE_URL_PROD not found in env files");
  const require = createRequire(join(cwd(), "packages/db/package.json"));
  const postgres = require("postgres");
  const sql = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    const byStatus = await sql`
      select status, count(*)::int as runs
      from scrape_runs where recorded_at > now() - ${DAYS + " days"}::interval
      group by status order by runs desc`;
    const failures = await sql`
      select source_type, failure_reason, count(*)::int as runs,
             count(distinct competitor_id)::int as competitors,
             max(recorded_at) as last_seen
      from scrape_runs
      where recorded_at > now() - ${DAYS + " days"}::interval
        and status = 'failed' and refused = false
      group by source_type, failure_reason order by runs desc limit 100`;
    const refusals = await sql`
      select source_type, refusal_reason, count(*)::int as runs,
             count(distinct competitor_id)::int as competitors,
             max(recorded_at) as last_seen
      from scrape_runs
      where recorded_at > now() - ${DAYS + " days"}::interval and refused = true
      group by source_type, refusal_reason order by runs desc limit 100`;
    const worstMonitors = await sql`
      select monitor_id, competitor_id, source_type,
             count(*)::int as failed_runs, max(recorded_at) as last_seen
      from scrape_runs
      where recorded_at > now() - ${DAYS + " days"}::interval and status = 'failed'
      group by monitor_id, competitor_id, source_type
      having count(*) >= 5 order by failed_runs desc limit 50`;
    await save("scrape-runs.json", {
      windowDays: DAYS,
      generatedAt: new Date().toISOString(),
      byStatus,
      failures,
      refusals,
      worstMonitors,
    });
    const failed = byStatus.find((r) => r.status === "failed")?.runs ?? 0;
    console.log(`scrape-runs: ok (${failed} failed runs in ${DAYS}d, ${refusals.length} refusal groups)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/* ------------------------------------------------------------------ */
/* 2. Sentry top issues (org-wide, read-only)                          */
/* ------------------------------------------------------------------ */
async function collectSentry() {
  // SENTRY_AUDIT_TOKEN: read-scoped token for this audit, so the CI token
  // (sourcemap upload scopes only) never needs touching.
  const token = env.SENTRY_AUDIT_TOKEN ?? env.SENTRY_AUTH_TOKEN;
  const org = env.SENTRY_ORG;
  if (!token || !org) return skips.push("sentry: SENTRY_AUDIT_TOKEN/SENTRY_AUTH_TOKEN or SENTRY_ORG not found");
  const fetchIssues = async (statsPeriod) => {
    const params = new URLSearchParams({
      query: "is:unresolved",
      statsPeriod,
      sort: "freq",
      limit: "100",
    });
    return fetch(`https://sentry.io/api/0/organizations/${org}/issues/?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  };
  let period = `${DAYS}d`;
  let res = await fetchIssues(period);
  if (res.status === 400) {
    period = "14d";
    res = await fetchIssues(period);
  }
  if (res.status === 403 && env.SENTRY_PROJECT_WEB) {
    // Org-wide listing needs org:read; a narrower token may still read one project.
    const params = new URLSearchParams({ query: "is:unresolved", statsPeriod: period, sort: "freq", limit: "100" });
    res = await fetch(
      `https://sentry.io/api/0/projects/${org}/${env.SENTRY_PROJECT_WEB}/issues/?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }
  if (res.status === 403)
    return skips.push(
      "sentry: 403 — the token lacks read scopes. Create a user auth token with org:read + event:read + project:read and put it in SENTRY_AUDIT_TOKEN in the root .env.local",
    );
  if (!res.ok) return skips.push(`sentry: API answered ${res.status}`);
  const issues = (await res.json()).map((i) => ({
    shortId: i.shortId,
    project: i.project?.slug,
    level: i.level,
    title: i.title,
    culprit: i.culprit,
    count: Number(i.count),
    userCount: i.userCount,
    firstSeen: i.firstSeen,
    lastSeen: i.lastSeen,
    permalink: i.permalink,
  }));
  await save("sentry.json", {
    statsPeriod: period,
    generatedAt: new Date().toISOString(),
    issues,
  });
  console.log(`sentry: ok (${issues.length} unresolved issues over ${period}, sorted by frequency)`);
}

/* ------------------------------------------------------------------ */
/* 3. pg-boss dead-letter queue (ssh -> Netcup box, read-only)         */
/* ------------------------------------------------------------------ */
function collectDlq() {
  // One JSON row out of psql. The queue Postgres runs as the `outrival-pg`
  // container on the box behind the `outrival` ssh alias; QUEUE_DATABASE_URL is
  // not available locally, on purpose.
  const dlqSelect = `(select coalesce(json_agg(t), '[]'::json) from (
      select id, name, state, retry_count, data, output, created_on, completed_on
      from pgboss.job where name = 'outrival-dlq'
      order by created_on desc limit 200) t)`;
  const failedSelect = `(select coalesce(json_agg(t), '[]'::json) from (
      select name, count(*) as runs, max(completed_on) as last_seen
      from pgboss.job
      where state = 'failed' and created_on > now() - interval '${DAYS} days'
      group by name order by runs desc) t)`;
  // pgboss.archive does not exist on this install (checked 2026-08-16) — the
  // live job table alone carries the failure history we need.
  const query = () =>
    `select json_build_object('dlq', ${dlqSelect}, 'failedByQueue', ${failedSelect})`;
  // The SQL travels on STDIN (ssh -> docker exec -i -> psql), never on the
  // command line: its single quotes would terminate the remote sh -c wrapper.
  const run = (sqlText) =>
    execFileSync(
      "ssh",
      [
        "outrival",
        `docker exec -i outrival-pg sh -c 'psql -U "\${POSTGRES_USER:-postgres}" -d "\${POSTGRES_DB:-postgres}" -t -A -v ON_ERROR_STOP=1'`,
      ],
      { encoding: "utf8", timeout: 30_000, input: sqlText },
    ).trim();
  let raw;
  try {
    raw = run(query());
  } catch (err) {
    return skips.push(`dlq: ssh/psql failed (${err.message.split("\n")[0]}) — rerun from a machine with the 'outrival' ssh alias`);
  }
  const payload = JSON.parse(raw);
  payload.windowDays = DAYS;
  payload.generatedAt = new Date().toISOString();
  const p = save("dlq.json", payload).then(() =>
    console.log(`dlq: ok (${payload.dlq.length} dead-lettered jobs, ${payload.failedByQueue.length} queues with failures in ${DAYS}d)`),
  );
  return p;
}

/* ------------------------------------------------------------------ */

await mkdir(OUT_DIR, { recursive: true });
for (const collector of [collectScrapeRuns, collectSentry, collectDlq]) {
  try {
    await collector();
  } catch (err) {
    skips.push(`${collector.name}: ${err.message.split("\n")[0]}`);
  }
}

console.log(`\nwritten to ${OUT_DIR}: ${written.join(", ") || "(nothing)"}`);
for (const s of skips) console.log(`SKIP ${s}`);
// A missing collector is a coverage gap the report must own, not a crash.
exit(written.length === 0 ? 1 : 0);
