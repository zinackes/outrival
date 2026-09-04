import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { verification } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { installAppMocks, mountApp } from "./app-harness";

// Audit 2026-09-02, S-02. The sign-in email's one-click link used to be
// `GET /otp-link?email=&code=<otp>`: a live credential in a URL, redeemed by
// whoever fetched it first. Mail security scanners (Safe Links, Proofpoint) and
// browser prefetch follow every link in an email before the human does, so they
// burned the attempt budget and walked away with the session cookie.
//
// Two properties are locked here: a GET never signs anyone in, and the handle in
// the URL means nothing on its own and works exactly once.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let createOtpLinkToken: typeof import("../src/lib/otp-link-token").createOtpLinkToken;

const signInEmailOTPMock = mock(async () => {
  const headers = new Headers();
  headers.append("set-cookie", "better-auth.session_token=granted; Path=/");
  return { headers, response: {} };
});

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  // Better Auth's own OTP verification is not under test — what is under test is
  // whether our route calls it at all, and on which verb. The whole surface the
  // auth router uses is stubbed here, not just signInEmailOTP: mock.module is
  // process-global, so a partial stub would break whichever file runs next
  // (see the note in app-harness.ts).
  mock.module(resolve(import.meta.dir, "../src/lib/auth"), () => ({
    auth: {
      api: {
        signInEmailOTP: signInEmailOTPMock,
        disableTwoFactor: async () => ({ status: true }),
        enableTwoFactor: async () => ({ totpURI: "otpauth://totp/test", backupCodes: ["a"] }),
        verifyPasskeyRegistration: async () => ({ id: "passkey-1" }),
      },
    },
  }));
  ({ createOtpLinkToken } = await import("../src/lib/otp-link-token"));
  const { authRouter } = await import("../src/routes/auth");
  app = mountApp("/api/auth", authRouter);
});

const TTL = 600;

async function issueToken(email = "user@example.com"): Promise<string> {
  return createOtpLinkToken({ email, otp: "123456" }, TTL);
}

async function tokenRowCount(token: string): Promise<number> {
  const rows = await testDb
    .select({ id: verification.id })
    .from(verification)
    .where(eq(verification.identifier, `otp-link:${token}`));
  return rows.length;
}

describe("GET /api/auth/otp-link never signs anyone in", () => {
  test("1. regression: a valid handle renders a page, sets no cookie, calls no auth", async () => {
    const token = await issueToken();
    signInEmailOTPMock.mockClear();

    const res = await app.request(`/api/auth/otp-link?t=${token}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(signInEmailOTPMock).not.toHaveBeenCalled();
  });

  test("2. the handle survives the GET, so the human's click still works", async () => {
    const token = await issueToken();
    await app.request(`/api/auth/otp-link?t=${token}`);
    expect(await tokenRowCount(token)).toBe(1);
  });

  test("3. the OTP is nowhere in the page", async () => {
    const token = await issueToken();
    const body = await (await app.request(`/api/auth/otp-link?t=${token}`)).text();
    expect(body).not.toContain("123456");
  });

  test("4. a missing handle bounces to /auth", async () => {
    const res = await app.request("/api/auth/otp-link");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/auth?error=link_invalid");
  });
});

describe("POST /api/auth/otp-link redeems the handle", () => {
  test("5. a valid handle signs in and forwards the session cookie", async () => {
    const token = await issueToken("clicker@example.com");
    signInEmailOTPMock.mockClear();

    const res = await app.request(`/api/auth/otp-link?t=${token}`, { method: "POST" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(res.headers.getSetCookie().join(";")).toContain("better-auth.session_token=granted");
    expect(signInEmailOTPMock).toHaveBeenCalledTimes(1);
  });

  test("6. the handle is single-use: the second POST is refused", async () => {
    const token = await issueToken();
    await app.request(`/api/auth/otp-link?t=${token}`, { method: "POST" });

    signInEmailOTPMock.mockClear();
    const res = await app.request(`/api/auth/otp-link?t=${token}`, { method: "POST" });

    expect(res.headers.get("location")).toContain("/auth?error=link_invalid");
    expect(signInEmailOTPMock).not.toHaveBeenCalled();
    expect(await tokenRowCount(token)).toBe(0);
  });

  test("7. an expired handle is refused and never reaches Better Auth", async () => {
    const token = await createOtpLinkToken({ email: "late@example.com", otp: "654321" }, -1);
    signInEmailOTPMock.mockClear();

    const res = await app.request(`/api/auth/otp-link?t=${token}`, { method: "POST" });

    expect(res.headers.get("location")).toContain("/auth?error=link_invalid");
    expect(signInEmailOTPMock).not.toHaveBeenCalled();
  });

  test("8. an unknown handle is refused", async () => {
    signInEmailOTPMock.mockClear();
    const res = await app.request("/api/auth/otp-link?t=nope", { method: "POST" });
    expect(res.headers.get("location")).toContain("/auth?error=link_invalid");
    expect(signInEmailOTPMock).not.toHaveBeenCalled();
  });
});
