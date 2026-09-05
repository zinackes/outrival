import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { redriveDeadLetterSql } from "../src/lib/queue-admin";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema pgboss;
    create type pgboss.job_state as enum ('created', 'retry', 'active', 'completed', 'cancelled', 'failed');
    create table pgboss.queue (
      name text primary key,
      retry_limit int not null,
      retry_backoff boolean not null,
      retry_delay int not null,
      retry_delay_max int,
      expire_seconds int not null,
      retention_seconds int not null,
      deletion_seconds int not null,
      policy text
    );
    create table pgboss.job (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      data jsonb not null,
      priority int,
      retry_limit int not null default 0,
      retry_backoff boolean not null default false,
      retry_delay int not null default 0,
      retry_delay_max int,
      expire_seconds int not null default 120,
      keep_until timestamptz not null default now() + interval '7 days',
      deletion_seconds int not null default 604800,
      policy text,
      singleton_key text,
      heartbeat_seconds int,
      state pgboss.job_state not null default 'created',
      created_on timestamptz not null default now(),
      source_name text
    );
  `);
});

afterAll(() => db.close());

describe("redriveDeadLetterSql", () => {
  test("atomically restores native and manually parked jobs to valid source queues", async () => {
    await db.exec(`
      insert into pgboss.queue
        (name, retry_limit, retry_backoff, retry_delay, retry_delay_max, expire_seconds,
         retention_seconds, deletion_seconds, policy)
      values
        ('classify-change', 2, true, 1, 10, 120, 604800, 604800, 'standard'),
        ('generate-signal', 2, true, 1, 10, 120, 604800, 604800, 'standard');

      insert into pgboss.job (name, data, source_name, created_on) values
        ('outrival-dlq', '{"changeId":"native"}', 'classify-change', now() - interval '3 minutes'),
        ('outrival-dlq', '{"changeId":"manual","__dlq":{"queue":"generate-signal","reason":"truncated_reply","jobId":"old"}}', null, now() - interval '2 minutes'),
        ('outrival-dlq', '{"changeId":"orphan","__dlq":{"queue":"missing-queue","reason":"truncated_reply","jobId":"old"}}', null, now() - interval '1 minute');
    `);

    const result = await db.query<{ moved: number }>(redriveDeadLetterSql, [
      "outrival-dlq",
      100,
    ]);
    expect(result.rows[0]?.moved).toBe(2);

    const jobs = await db.query<{ name: string; data: { changeId: string; __dlq?: unknown } }>(
      `select name, data from pgboss.job order by data->>'changeId'`,
    );
    expect(jobs.rows.map((job) => [job.name, job.data.changeId])).toEqual([
      ["generate-signal", "manual"],
      ["classify-change", "native"],
      ["outrival-dlq", "orphan"],
    ]);
    expect(jobs.rows.find((job) => job.data.changeId === "manual")?.data.__dlq).toBeUndefined();
  });
});
