import { Resend, type CreateEmailOptions } from "resend";

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

/**
 * Send through Resend and THROW when it refuses. `emails.send()` returns
 * `{ data: null, error }` instead of throwing on an unverified domain, a bad key or
 * a rate limit, so the caller's try/catch was reading a refusal as a delivery and
 * stamping `digests.sent_at`. Mirrors the worker helper.
 */
export async function sendEmail(payload: CreateEmailOptions): Promise<void> {
  const { error } = await getResend().emails.send(payload);
  if (error) throw new Error(`resend_send_failed: ${error.name}: ${error.message}`);
}

export const ALERT_FROM = process.env.RESEND_FROM ?? "Outrival <alerts@outrival.io>";
