import { Resend, type CreateEmailOptions } from "resend";

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
 * Send through Resend and THROW when it refuses.
 *
 * `emails.send()` never throws: an unverified sender domain, a revoked key, a rate
 * limit and a dead network all come back as `{ data: null, error }`. Every caller
 * here sits in a try/catch that reads "did not throw" as "delivered", so a refused
 * send was being recorded as sent — `digests.sent_at` stamped, a "sent" alerts row
 * written, `signals.daily_digest_sent_at` marked so the digest never retries — and
 * the reader then told the user "Emailed on <date>" for mail that never left.
 * Throwing puts the failure back on the error path each caller already has.
 */
export async function sendEmail(payload: CreateEmailOptions): Promise<void> {
  const { error } = await getResend().emails.send(payload);
  if (error) throw new Error(`resend_send_failed: ${error.name}: ${error.message}`);
}

export const ALERT_FROM = process.env.RESEND_FROM ?? "Outrival <alerts@outrival.io>";
