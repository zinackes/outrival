import { z } from "zod";

// Tiny curated set of the most common disposable domains — kept here only for
// instant client-side feedback (this schema ships in the web bundle, so it must
// stay small). The AUTHORITATIVE, comprehensive block runs server-side against
// the full `disposable-email-domains` list — see apps/api/src/lib/disposable-email.ts.
const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "throwaway.email",
  "tempmail.com",
  "trashmail.com",
  "yopmail.com",
  "fakeinbox.com",
  "dispostable.com",
  "maildrop.cc",
  "sharklasers.com",
  "getnada.com",
  "tempail.com",
  "tmpmail.org",
  "mailnesia.com",
  "temp-mail.org",
  "moakt.com",
  "tempr.email",
]);

export function isDisposableEmailDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? DISPOSABLE_DOMAINS.has(domain) : false;
}

// Google (gmail.com / googlemail.com) treats dots as insignificant and ignores
// everything after a "+" in the local part, so j.o.h.n@gmail.com, john@gmail.com
// and john+anything@googlemail.com all deliver to ONE inbox.
const GOOGLE_DOMAINS = new Set<string>(["gmail.com", "googlemail.com"]);

/**
 * Reduce an address to the single inbox it actually reaches, for use ONLY as an
 * anti-abuse uniqueness key — mail is still sent to the address exactly as typed,
 * so a legitimate user's +tag keeps working. Two addresses with the same canonical
 * form belong to the same mailbox, which is how one Gmail account can otherwise
 * spin up unlimited "distinct" signups.
 *
 * Subaddressing (local+tag) is standard (RFC 5233) and widely honoured, so we drop
 * the +tag for EVERY domain. Dots are only provably insignificant on Google, so we
 * strip them there alone and fold googlemail.com into gmail.com.
 */
export function canonicalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at === -1) return normalized;

  let local = normalized.slice(0, at);
  let domain = normalized.slice(at + 1);

  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);

  if (GOOGLE_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }

  return `${local}@${domain}`;
}

// Strict email schema shared by the web client and the API so validation can
// never diverge. Trims + lowercases before validating.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Email is too short")
  .max(254, "Email is too long")
  .regex(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/, "Invalid email format")
  .refine((email) => !isDisposableEmailDomain(email), {
    message: "Temporary email addresses aren't accepted",
  });

// Input shape of the unified /auth page submit. Password is optional (magic link
// needs only the email); turnstileToken gates bot traffic.
export const authInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).optional(),
  turnstileToken: z.string().min(1, "Anti-bot verification required"),
});

export type AuthInput = z.infer<typeof authInputSchema>;
