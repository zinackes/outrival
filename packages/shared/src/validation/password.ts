import { createHash } from "node:crypto";
import { z } from "zod";

// Minimal password rules — length over arbitrary complexity (a long passphrase
// beats "P@ss1"). Enforced only when a password is SET, never on sign-in, so
// pre-patch-19 accounts with shorter passwords keep working.
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters");

/**
 * Checks whether a password appears in known breaches via HaveIBeenPwned's
 * k-anonymity range API: only the first 5 chars of the SHA-1 hash leave the
 * machine, never the password. Fails open (returns false) on any error or
 * timeout so HIBP being down never blocks a legitimate user.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { "Add-Padding": "true" },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return false; // fail open

    const text = await response.text();
    for (const line of text.split("\n")) {
      const hashSuffix = line.split(":")[0]?.trim();
      if (hashSuffix === suffix) return true;
    }
    return false;
  } catch {
    return false; // fail open on network error/timeout
  }
}

export type PasswordValidation =
  | { valid: true }
  | { valid: false; reason: string };

/** Validates length rules then the HIBP breach check (fail open). */
export async function validatePasswordWithHibp(
  password: string,
): Promise<PasswordValidation> {
  const basic = passwordSchema.safeParse(password);
  if (!basic.success) {
    return {
      valid: false,
      reason: basic.error.issues[0]?.message ?? "Invalid password",
    };
  }
  if (await isPasswordPwned(password)) {
    return {
      valid: false,
      reason:
        "This password appeared in a known data breach. Choose a different one.",
    };
  }
  return { valid: true };
}
