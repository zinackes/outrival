import { createHmac, timingSafeEqual } from "node:crypto";

// Short signed tokens for one-click digest interactions from an email
// (patch-21). No session: the link itself is the credential. HMAC-SHA256 over
// the payload, signed with the app secret (BETTER_AUTH_SECRET), so it can't be
// forged or tampered with. Stateless — no server-side record to look up or
// revoke, though the unsubscribe token below carries its own expiry claim
// (see UNSUBSCRIBE_TOKEN_TTL_SECONDS) so the payload alone is enough to age it out.

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

// 30 days: generous relative to how long someone might reasonably act on an
// emailed weekly digest (read it late, archive it, forward it) before the
// unsubscribe link inside should stop working.
const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

// One-click digest unsubscribe from the email footer — same stateless HMAC
// scheme. Only ever flips organizations.digestEnabled to false, so a leaked
// link can't do worse than stopping emails the user can re-enable in settings.
// Carries an issued-at claim so the capability doesn't live forever (defaults
// to "now" so existing call sites don't need to pass it explicitly).
export function signUnsubscribeToken(
  orgId: string,
  secret: string,
  issuedAt: number = Math.floor(Date.now() / 1000),
): string {
  const body = b64url(Buffer.from(`unsub:digest:${orgId}:${issuedAt}`, "utf8"));
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
  // 4 parts = current format (orgId + issuedAt). 3 parts = a token minted
  // before the issued-at claim existed — legacy grace period, see below.
  if (
    (parts.length !== 3 && parts.length !== 4) ||
    parts[0] !== "unsub" ||
    parts[1] !== "digest" ||
    !parts[2]
  ) {
    return null;
  }

  if (parts.length === 4) {
    const issuedAt = Number(parts[3]);
    if (!Number.isFinite(issuedAt)) return null;
    const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
    if (ageSeconds > UNSUBSCRIBE_TOKEN_TTL_SECONDS) return null;
  }
  // else: legacy 3-part token (no issuedAt) — accepted with no expiry check.
  // A dead unsubscribe link in an inbox is a worse outcome (deliverability /
  // compliance) than this capability living slightly longer than the TTL
  // above. Every digest sent before this change shipped (2026-07-26) only
  // ever had a 3-part token, so remove this branch once those have aged out
  // of relevance — safe to delete by ~2026-10-24 (90 days out).

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
