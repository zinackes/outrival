import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { user, verification } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp } from "./app-harness";

// Plan 014: disabling/enabling 2FA and enrolling a passkey used to reach
// Better Auth's plugin endpoints straight off an open session — no step-up,
// unlike /set-password and /regenerate-backup-codes. These lock the new
// shadow routes' gate in apps/api/src/routes/auth.ts: the emailed reauth code
// (lib/reauth.ts) must be checked and burned BEFORE Better Auth's own handler
// ever runs. Better Auth's own plugin logic (auth.api.*) is mocked here —
// that's Better Auth's surface to test, not this plan's; what's under test is
// whether OUR gate lets a call through or stops it.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

const disableTwoFactorMock = mock(async () => ({ status: true }));
const enableTwoFactorMock = mock(async () => ({
  totpURI: "otpauth://totp/test",
  backupCodes: ["a"],
}));
const verifyPasskeyRegistrationMock = mock(async () => ({ id: "passkey-1" }));

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  // Better Auth's own handlers are not under test here — swap them for mocks so
  // the gate can be exercised without wiring a real Better Auth session/cookie.
  mock.module(resolve(import.meta.dir, "../src/lib/auth"), () => ({
    auth: {
      api: {
        disableTwoFactor: disableTwoFactorMock,
        enableTwoFactor: enableTwoFactorMock,
        verifyPasskeyRegistration: verifyPasskeyRegistrationMock,
      },
    },
  }));
  const { authRouter } = await import("../src/routes/auth");
  app = mountApp("/api/auth", authRouter);
});

let seq = 0;
/** Insert a valid, unburned reauth code directly — bypasses the email send,
 * mirroring the exact row shape lib/reauth.ts's sendReauthCode writes. */
async function seedCode(userId: string, code: string): Promise<void> {
  await testDb.insert(verification).values({
    id: `verif-${++seq}`,
    identifier: `reauth-${userId}`,
    value: `${code}:0`,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
}

/** Seed a Better Auth `user` row with 2FA already on, for the "stays enabled" check. */
async function seedTwoFactorUser(userId: string, email: string): Promise<void> {
  await testDb.insert(user).values({
    id: userId,
    name: "Test User",
    email,
    twoFactorEnabled: true,
  });
}

describe("step-up gate — 2FA disable", () => {
  test("without a valid code: refused, Better Auth is never called, stays enabled", async () => {
    disableTwoFactorMock.mockClear();
    await seedTwoFactorUser("u-disable-1", "u1@example.com");

    const res = await app.request(
      "/api/auth/two-factor/disable",
      asUser("u-disable-1", "u1@example.com", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("reauth_failed");
    expect(disableTwoFactorMock).not.toHaveBeenCalled();

    const [row] = await testDb.select().from(user).where(eq(user.id, "u-disable-1"));
    expect(row?.twoFactorEnabled).toBe(true);
  });

  test("with a valid code: succeeds and calls through to Better Auth", async () => {
    disableTwoFactorMock.mockClear();
    await seedCode("u-disable-2", "111111");

    const res = await app.request(
      "/api/auth/two-factor/disable",
      asUser("u-disable-2", "u2@example.com", {
        method: "POST",
        body: JSON.stringify({ code: "111111" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(disableTwoFactorMock).toHaveBeenCalledTimes(1);
  });
});

describe("step-up gate — passkey enrolment", () => {
  test("without a valid code: refused, Better Auth is never called", async () => {
    verifyPasskeyRegistrationMock.mockClear();

    const res = await app.request(
      "/api/auth/passkey/verify-registration",
      asUser("u-passkey-1", "u3@example.com", {
        method: "POST",
        body: JSON.stringify({ response: {} }),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("reauth_failed");
    expect(verifyPasskeyRegistrationMock).not.toHaveBeenCalled();
  });

  test("with a valid code (sent as x-reauth-code header): succeeds", async () => {
    verifyPasskeyRegistrationMock.mockClear();
    await seedCode("u-passkey-2", "333333");

    const res = await app.request(
      "/api/auth/passkey/verify-registration",
      asUser("u-passkey-2", "u4@example.com", {
        method: "POST",
        headers: { "x-reauth-code": "333333" },
        body: JSON.stringify({ response: {} }),
      }),
    );

    expect(res.status).toBe(200);
    expect(verifyPasskeyRegistrationMock).toHaveBeenCalledTimes(1);
  });
});

describe("step-up gate — single-use code", () => {
  test("a code already used once is refused on the second attempt", async () => {
    disableTwoFactorMock.mockClear();
    await seedCode("u-single-use", "222222");

    const first = await app.request(
      "/api/auth/two-factor/disable",
      asUser("u-single-use", "u5@example.com", {
        method: "POST",
        body: JSON.stringify({ code: "222222" }),
      }),
    );
    expect(first.status).toBe(200);
    expect(disableTwoFactorMock).toHaveBeenCalledTimes(1);

    const second = await app.request(
      "/api/auth/two-factor/disable",
      asUser("u-single-use", "u5@example.com", {
        method: "POST",
        body: JSON.stringify({ code: "222222" }),
      }),
    );
    expect(second.status).toBe(400);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("reauth_failed");
    // Still only the one call from the first, successful attempt.
    expect(disableTwoFactorMock).toHaveBeenCalledTimes(1);
  });
});
