import crypto from "node:crypto";

// Outbound webhook push (Phase C). Mirror of apps/api/src/lib/crm-webhook.ts —
// apps/workers can't import @outrival/api, so the signer + sender live in both.
// See docs/distribution-team.md.

export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function pushWebhook(
  url: string,
  secret: string | null,
  payload: unknown,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Outrival-Webhook/1",
  };
  if (secret) headers["X-Outrival-Signature"] = signBody(secret, body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
