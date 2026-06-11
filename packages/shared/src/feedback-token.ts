import { createHmac, timingSafeEqual } from "node:crypto";

// Short signed token for one-click digest feedback from an email (patch-21).
// No session: the link itself is the credential. HMAC-SHA256 over the payload,
// signed with the app secret (BETTER_AUTH_SECRET), so it can't be forged or
// tampered with. Stateless — nothing to store or expire server-side.

export interface DigestFeedbackPayload {
  orgId: string;
  digestId: string;
  verdict: "useful" | "not_useful";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signDigestFeedbackToken(
  payload: DigestFeedbackPayload,
  secret: string,
): string {
  const raw = `${payload.orgId}:${payload.digestId}:${payload.verdict}`;
  const body = b64url(Buffer.from(raw, "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

// One-click digest unsubscribe from the email footer — same stateless HMAC
// scheme. Only ever flips organizations.digestEnabled to false, so a leaked
// link can't do worse than stopping emails the user can re-enable in settings.
export function signUnsubscribeToken(orgId: string, secret: string): string {
  const body = b64url(Buffer.from(`unsub:digest:${orgId}`, "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): { orgId: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!sig) return null;

  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const parts = Buffer.from(body, "base64url").toString("utf8").split(":");
  if (parts.length !== 3 || parts[0] !== "unsub" || parts[1] !== "digest" || !parts[2]) {
    return null;
  }
  return { orgId: parts[2] };
}

export function verifyDigestFeedbackToken(
  token: string,
  secret: string,
): DigestFeedbackPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!sig) return null;

  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const raw = Buffer.from(body, "base64url").toString("utf8");
  const parts = raw.split(":");
  if (parts.length !== 3) return null;
  const [orgId, digestId, verdict] = parts;
  if (!orgId || !digestId || (verdict !== "useful" && verdict !== "not_useful")) {
    return null;
  }
  return { orgId, digestId, verdict };
}
