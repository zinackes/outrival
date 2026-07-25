import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  signDigestFeedbackToken,
  signUnsubscribeToken,
  verifyDigestFeedbackToken,
  verifyUnsubscribeToken,
} from "./feedback-token";

// Locks the unsubscribe token's TTL claim (plan 013) and proves the
// timestamp-less legacy shape (tokens already sitting in sent digest emails)
// still verifies during the grace period, plus that the unrelated
// digest-feedback verdict token (same module, different shape) is unaffected.

const SECRET = "test-secret-for-feedback-token-tests";
const THIRTY_ONE_DAYS_SECONDS = 31 * 24 * 60 * 60;
const TWENTY_NINE_DAYS_SECONDS = 29 * 24 * 60 * 60;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

// Builds a token in the pre-TTL format (3 parts, no issuedAt claim) — what
// every unsubscribe link minted before this change looks like.
function legacyUnsubscribeToken(orgId: string, secret: string): string {
  const body = b64url(Buffer.from(`unsub:digest:${orgId}`, "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

describe("signUnsubscribeToken / verifyUnsubscribeToken", () => {
  test("a fresh token verifies and returns the orgId", () => {
    const token = signUnsubscribeToken("org-1", SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ orgId: "org-1" });
  });

  test("a token older than the TTL is rejected", () => {
    const issuedAt = Math.floor(Date.now() / 1000) - THIRTY_ONE_DAYS_SECONDS;
    const token = signUnsubscribeToken("org-1", SECRET, issuedAt);
    expect(verifyUnsubscribeToken(token, SECRET)).toBeNull();
  });

  test("a token just under the TTL still verifies", () => {
    const issuedAt = Math.floor(Date.now() / 1000) - TWENTY_NINE_DAYS_SECONDS;
    const token = signUnsubscribeToken("org-1", SECRET, issuedAt);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ orgId: "org-1" });
  });

  test("a legacy timestamp-less token still verifies (backwards-compat grace)", () => {
    const token = legacyUnsubscribeToken("org-1", SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ orgId: "org-1" });
  });

  test("a tampered signature is rejected", () => {
    const token = signUnsubscribeToken("org-1", SECRET);
    const [body] = token.split(".");
    expect(verifyUnsubscribeToken(`${body}.${"a".repeat(43)}`, SECRET)).toBeNull();
  });

  test("a forged payload (different org) is rejected", () => {
    const token = signUnsubscribeToken("org-1", SECRET);
    const sig = token.split(".")[1];
    const forgedBody = b64url(Buffer.from("unsub:digest:org-2:9999999999", "utf8"));
    expect(verifyUnsubscribeToken(`${forgedBody}.${sig}`, SECRET)).toBeNull();
  });

  test("wrong secret is rejected", () => {
    const token = signUnsubscribeToken("org-1", SECRET);
    expect(verifyUnsubscribeToken(token, "wrong-secret")).toBeNull();
  });

  test("malformed token is rejected", () => {
    expect(verifyUnsubscribeToken("not-a-token", SECRET)).toBeNull();
  });
});

describe("signDigestFeedbackToken / verifyDigestFeedbackToken (unaffected by the TTL change)", () => {
  test("round-trips a verdict payload", () => {
    const token = signDigestFeedbackToken(
      { orgId: "org-1", digestId: "digest-1", verdict: "useful" },
      SECRET,
    );
    expect(verifyDigestFeedbackToken(token, SECRET)).toEqual({
      orgId: "org-1",
      digestId: "digest-1",
      verdict: "useful",
    });
  });

  test("a tampered signature is rejected", () => {
    const token = signDigestFeedbackToken(
      { orgId: "org-1", digestId: "digest-1", verdict: "useful" },
      SECRET,
    );
    const [body] = token.split(".");
    expect(verifyDigestFeedbackToken(`${body}.${"a".repeat(43)}`, SECRET)).toBeNull();
  });
});
