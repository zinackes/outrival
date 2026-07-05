import { Resend } from "resend";

// Shared Resend client for API-originated transactional mail (on-demand digest
// send/resend). Mirrors the worker `lib/resend.ts` so both sides use the same
// sender identity. Auth emails keep their own client in `sign-in-email.ts`.
let client: Resend | null = null;

export function getResend(): Resend {
  if (!client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is required");
    client = new Resend(key);
  }
  return client;
}

export const ALERT_FROM = process.env.RESEND_FROM ?? "Outrival <alerts@outrival.io>";
