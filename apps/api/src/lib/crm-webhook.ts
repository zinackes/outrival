import crypto from "node:crypto";

// Outbound webhook helper (Phase C). Used by the destinations test endpoint; the
// worker has its own copy (apps/workers can't import @outrival/api). See
// docs/distribution-team.md.

export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Basic SSRF guard for a user-supplied webhook URL: https only, no loopback /
 * private-range literals. DNS-rebinding is out of scope for the MVP (noted).
 */
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host.startsWith("fc") || host.startsWith("fd")) return false;
  return true;
}

export async function sendWebhook(
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
