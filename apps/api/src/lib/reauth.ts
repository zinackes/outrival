import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { verification, users } from "@outrival/db";
import { db } from "./db";
import { sendReauthCodeEmail, sendSetPasswordCodeEmail } from "./sign-in-email";

// Step-up re-authentication for destructive actions (delete workspace / account).
// A short code is emailed to the account address and must be entered alongside
// the type-to-confirm — so a hijacked session alone can't erase a workspace, the
// attacker would also need access to the inbox. Codes live in the Better Auth
// `verification` table under a per-user identifier, single-use, attempt-capped.

const REAUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const identifierFor = (userId: string) => `reauth-${userId}`;

export async function sendReauthCode(
  userId: string,
  purpose: "destructive" | "password" = "destructive",
): Promise<void> {
  const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!dbUser?.email) return;

  const identifier = identifierFor(userId);
  const code = String(randomInt(100000, 1000000)); // 6 digits
  await db.delete(verification).where(eq(verification.identifier, identifier));
  await db.insert(verification).values({
    id: randomUUID(),
    identifier,
    value: `${code}:0`, // code:attempts
    expiresAt: new Date(Date.now() + REAUTH_TTL_MS),
  });

  if (purpose === "password") {
    await sendSetPasswordCodeEmail({ to: dbUser.email, code, expiresInMinutes: 10 });
  } else {
    await sendReauthCodeEmail({ to: dbUser.email, code, expiresInMinutes: 10 });
  }
}

export async function verifyReauthCode(userId: string, code: string): Promise<boolean> {
  const identifier = identifierFor(userId);
  const [row] = await db
    .select()
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);
  if (!row) return false;

  const expired = row.expiresAt.getTime() <= Date.now();
  const [stored, attemptsRaw] = row.value.split(":");
  const attempts = Number(attemptsRaw ?? "0");

  if (expired || attempts >= MAX_ATTEMPTS) {
    await db.delete(verification).where(eq(verification.identifier, identifier));
    return false;
  }

  if (stored === code.trim()) {
    await db.delete(verification).where(eq(verification.identifier, identifier)); // single-use
    return true;
  }

  // Wrong guess — burn an attempt; drop the row once the cap is hit.
  if (attempts + 1 >= MAX_ATTEMPTS) {
    await db.delete(verification).where(eq(verification.identifier, identifier));
  } else {
    await db
      .update(verification)
      .set({ value: `${stored}:${attempts + 1}` })
      .where(eq(verification.identifier, identifier));
  }
  return false;
}
