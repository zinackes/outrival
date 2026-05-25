import { Resend } from "resend";

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
