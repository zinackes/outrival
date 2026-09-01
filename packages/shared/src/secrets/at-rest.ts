import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for the secrets this product stores in Postgres: third-party OAuth
// tokens in `oauth_connections`, and the HMAC signing secret of a CRM destination
// in `crm_destinations` (code:SEC-08). GCM (not CBC) because it authenticates: a
// row edited in the database fails to decrypt instead of yielding a silently wrong
// value.
//
// It lives in @outrival/shared and not in apps/api because apps/workers signs the
// outbound CRM webhook too, and can't import the API. A second copy of this file
// diverging from the first is exactly how the CRM secret ended up in plaintext next
// to an encrypted sibling.
//
// The key is read from process.env lazily rather than through an app's env.ts so
// this module can be imported (and unit-tested) without a whole env schema being
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
      "OAUTH_TOKEN_ENCRYPTION_KEY is not set: refusing to handle a stored secret without encryption at rest",
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
export function isSecretEncryptionConfigured(): boolean {
  return Boolean(process.env.OAUTH_TOKEN_ENCRYPTION_KEY);
}

/**
 * Returns `v1.<iv>.<authTag>.<ciphertext>`, all base64. The scheme prefix makes a
 * key rotation or an algorithm change detectable on read instead of surfacing as
 * an undecryptable blob of unknown origin.
 */
export function encryptSecret(plaintext: string): string {
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
 * Throws `secret_undecryptable` on any malformed payload or auth-tag failure.
 * The message never echoes the payload: it would land in logs next to the org id.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== SCHEME) throw new Error("secret_undecryptable");
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  // Outside the try: a missing key is a misconfiguration, not a corrupt payload,
  // and must not be flattened into `secret_undecryptable`.
  const key = getKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("secret_undecryptable");
  }
}

/** A stored value carries the scheme prefix, i.e. it was written encrypted. */
export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(`${SCHEME}.`);
}

/**
 * Read a column that may still hold a pre-encryption plaintext row. `crm_destinations`
 * shipped with a plaintext `secret`, so between deploying this change and running
 * `db:backfill-crm-secrets` both shapes coexist and outbound pushes must keep signing.
 *
 * A value WITHOUT the `v1.` prefix is legacy plaintext and returned as-is. A value
 * WITH it must decrypt — a failure there is corruption or a rotated key, never
 * something to silently treat as plaintext. The one ambiguous input is a legacy
 * secret a user literally chose to start with `v1.` and to contain three dots; it
 * throws instead of signing with a wrong key, which is the safe direction.
 */
export function readStoredSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return isEncryptedSecret(stored) ? decryptSecret(stored) : stored;
}
