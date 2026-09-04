import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { verification } from "@outrival/db";
import { db } from "./db";

// Opaque, single-use handle standing in for the sign-in OTP inside the one-click
// link (audit 2026-09-02, S-02). The email used to carry `?email=&code=<otp>`,
// which put a live credential in a URL: mail security scanners (Safe Links,
// Proofpoint) and browser prefetch follow that link before the human does, so
// they burned attempts and — on a GET that signed in — walked away with the
// session cookie. The OTP also landed in proxy logs, browser history and any
// Referer the destination page emitted.
//
// The handle carries no secret of its own: it is 32 random bytes that only mean
// something to this database, and redeeming it DELETES the row, so the second
// fetch of the same link finds nothing. The OTP itself never leaves the mail
// body, where the user can still type it by hand.
//
// Storage is Better Auth's `verification` table rather than Redis: the OTP is
// already stored there by the emailOTP plugin, so this adds no new class of
// secret at rest, and it works identically in dev (where Upstash is absent).

const IDENTIFIER_PREFIX = "otp-link:";

export interface OtpLinkPayload {
  email: string;
  otp: string;
}

function isPayload(value: unknown): value is OtpLinkPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.email === "string" && typeof v.otp === "string";
}

/** Store `payload` behind a fresh handle valid for `ttlSeconds`. */
export async function createOtpLinkToken(
  payload: OtpLinkPayload,
  ttlSeconds: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(verification).values({
    id: randomUUID(),
    identifier: `${IDENTIFIER_PREFIX}${token}`,
    value: JSON.stringify(payload),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
  return token;
}

/**
 * Redeem a handle exactly once. The DELETE ... RETURNING is what makes it
 * single-use: two concurrent redemptions race in the database and only one gets
 * a row back. Returns null for an unknown, already-used or expired handle —
 * the caller must not tell those apart.
 */
export async function consumeOtpLinkToken(token: string): Promise<OtpLinkPayload | null> {
  if (!token) return null;

  const [row] = await db
    .delete(verification)
    .where(eq(verification.identifier, `${IDENTIFIER_PREFIX}${token}`))
    .returning({ value: verification.value, expiresAt: verification.expiresAt });

  if (!row || row.expiresAt.getTime() < Date.now()) return null;

  try {
    const parsed: unknown = JSON.parse(row.value);
    return isPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
