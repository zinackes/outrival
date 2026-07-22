import { describe, expect, test } from "bun:test";
import { jobData } from "@outrival/queue";

// pg-boss stores `null` as the payload of a job sent without data, and every cron
// fire is exactly that: syncSchedules() calls boss.schedule(name, cron) with no data
// argument. Handlers are typed `(data: P)`, so the null reached the body as a lie
// about its own type and threw on the first property access — generate-daily-digest
// failed on every hourly fire for a full day after the pg-boss cutover, and
// generate-weekly-digest carried the same signature toward its Monday 08:00 run.
//
// The second half of the fix — `payload?: {...}` on both digest bodies — is not
// asserted here on purpose. Under `strict`, an optional parameter makes the old
// `payload.timestamp` a compile error (TS18048, verified by reintroducing it), so
// `pnpm typecheck` already is that regression test. Invoking the bodies would be
// worse than useless:
// both read the database and send email through Resend, and Bun auto-loads
// .env.local, so a unit test would fire real digests at real addresses.

describe("jobData", () => {
  test("normalises a cron's null payload to an object", () => {
    expect(jobData<{ timestamp?: Date }>(null)).toEqual({});
  });

  test("normalises undefined the same way", () => {
    expect(jobData<{ timestamp?: Date }>(undefined)).toEqual({});
  });

  test("passes a real payload through untouched", () => {
    const payload = { monitorId: "m1", force: true };
    expect(jobData(payload)).toBe(payload);
  });

  test("does not swallow a falsy-but-valid payload", () => {
    const payload = { count: 0 };
    expect(jobData(payload)).toBe(payload);
  });
});

