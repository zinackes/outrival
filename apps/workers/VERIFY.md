# Workers — verification runbook

How to prove every Trigger.dev job actually runs end-to-end. Order matters:
fix config first, then smoke-test the pipeline, then exercise the leaf jobs.

## 0. Prerequisites — fix the blocking secrets (config track)

The last 40 dev runs were ~100% failing. Root causes are **bad secrets in the
Trigger.dev dev environment**, not code:

| Symptom in run trace | Variable to fix (Trigger dashboard → Environment Variables → dev) |
|---|---|
| `SignatureDoesNotMatch` (R2) | `R2_SECRET_ACCESS_KEY` (must match `R2_ACCESS_KEY_ID`); re-check `R2_ACCOUNT_ID`, `R2_BUCKET_NAME` |
| `ScrapingBee fetch failed (401)` | `SCRAPINGBEE_API_KEY` |
| `TASK_EXECUTION_ABORTED` | OOM — fixed in code (machine bump), no action |

Required to boot (validated by the `init` hook in `trigger.config.ts`):
`DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`. A missing one now fails immediately with a readable error.

Set/sync them, then:

```bash
pnpm --filter @outrival/workers dev   # trigger dev
```

## 1. Smoke-test the pipeline (cascades from one trigger)

Triggering `scrape-monitor` with `force: true` exercises the core chain:
**scrape → R2 upload → snapshot → change → classify-change → generate-signal →
send-alert**.

Get a real `monitorId` (Drizzle Studio `pnpm db:studio`, or SQL):

```sql
select m.id, c.url, m.source_type
from monitors m join competitors c on c.id = m.competitor_id
where m.is_active = true limit 5;
```

Trigger it (Trigger MCP `trigger_task`, dashboard "Test", or CLI), payload:

```json
{ "monitorId": "<id>", "force": true }
```

Then follow the run (MCP `get_run_details`, or dashboard). Assert:
- run `COMPLETED`, returns `{ changed, snapshotId, changeId }`
- new row in `snapshots`; object exists in R2 at `snapshots/<competitorId>/<source>/<ts>.html`
- if content changed: a `changes` row + a child `classify-change` run
- if significant: `generate-signal` run → `signals` row (idempotent on `changeId`)
- if severity high/critical and `org.alertsEnabled`: `send-alert` run

## 2. Exercise each job individually

Use IDs produced in step 1. All payloads are validated by the job's Zod schema.

| Job | Payload | Assert |
|---|---|---|
| `scrape-monitor` | `{ "monitorId": "…", "force": true }` | snapshot + R2 object |
| `classify-change` | `{ "changeId": "…" }` | skips if signal exists; else classifies |
| `extract-pricing` | `{ "snapshotId": "…", "competitorId": "…" }` | ClickHouse `pricing_history` |
| `extract-jobs` | `{ "snapshotId": "…", "competitorId": "…" }` | `job_postings` + CH `job_counts` |
| `extract-reviews` | `{ "snapshotId": "…", "competitorId": "…", "source": "g2" }` | `reviews` + CH `review_scores` |
| `generate-battle-card` | `{ "competitorId": "…", "orgId": "…" }` | `battle_cards` row + R2 PDF (runs Chromium) |
| `refresh-competitor-summary` | `{ "competitorId": "…" }` | `competitors.ai_summary` updated |
| `send-alert` | `{ "signalId": "…" }` | notification/alerts rows; **re-run = no dup** (idempotency) |
| `hello-world` | `{}` | sanity check the runner |

Scheduled jobs (no manual payload — trigger via dashboard "Test" → schedule):
- `schedule-scraping` (`0 * * * *`) → returns `{ enqueued, total }`, fans out via `batchTrigger`
- `generate-weekly-digest` (`0 8 * * 1`) → `digests` row + email; idempotent per (org, weekStart)
- `detect-new-competitors` (`0 20 * * 0`) → `competitor_candidates` + `new_competitor` notification

## 3. Regression checks for this change

- **send-alert idempotency**: trigger `send-alert` twice for the same `signalId`
  → second run inserts no new `notifications` row and re-sends no Slack/email
  (only channels without a prior `sentAt` row fire).
- **machine/OOM**: a `scrape-monitor` on a heavy JS site no longer
  `TASK_EXECUTION_ABORTED` (now `medium-1x` / 2 GB).
- **env fail-fast**: temporarily unset `R2_BUCKET_NAME` in dev → any run fails at
  `init` with `Invalid worker environment: - R2_BUCKET_NAME: …`.
