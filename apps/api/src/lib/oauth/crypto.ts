import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for the OAuth tokens at rest in `oauth_connections`. GCM (not CBC)
// because it authenticates: a row edited in the database fails to decrypt instead
// of yielding a silently wrong token.
//
// The key is read from process.env lazily rather than through src/env.ts so this
// module can be imported (and unit-tested) without the whole API env schema being
// satisfied. env.ts still validates the FORMAT at boot, which is where a typo
// should surface; the throw below is the runtime guard for "never configured".
const SCHEME = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY is not set: refusing to handle an OAuth token without encryption at rest",
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars)");
  }
  cachedKey = key;
  return key;
}

/** True when a key is configured, so a route can answer cleanly instead of throwing. */
export function isTokenEncryptionConfigured(): boolean {
  return Boolean(process.env.OAUTH_TOKEN_ENCRYPTION_KEY);
}

/**
 * Returns `v1.<iv>.<authTag>.<ciphertext>`, all base64. The scheme prefix makes a
 * key rotation or an algorithm change detectable on read instead of surfacing as
 * an undecryptable blob of unknown origin.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    SCHEME,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Throws `oauth_token_undecryptable` on any malformed payload or auth-tag failure.
 * The message never echoes the payload: it would land in logs next to the org id.
 */
export function decryptToken(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== SCHEME) throw new Error("oauth_token_undecryptable");
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  // Outside the try: a missing key is a misconfiguration, not a corrupt payload,
  // and must not be flattened into `oauth_token_undecryptable`.
  const key = getKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("oauth_token_undecryptable");
  }
}
