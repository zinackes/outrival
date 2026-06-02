import { z } from "zod";

// Hardcoded set of the most common disposable email domains. Enriched by
// observation over time (see findings.md). For an exhaustive list, the
// `disposable-email-domains` npm package could back this later.
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
