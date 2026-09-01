// AES-256-GCM at rest for third-party OAuth tokens. Single-sourced in
// @outrival/shared — apps/workers signs CRM webhook bodies with a secret from the
// same key, and can't import @outrival/api, so the primitive lives there and this
// file only re-exports it under the OAuth-flavoured names the token store uses.
// See packages/shared/src/secrets/at-rest.ts (code:SEC-08).

export {
  encryptSecret as encryptToken,
  decryptSecret as decryptToken,
  isSecretEncryptionConfigured as isTokenEncryptionConfigured,
} from "@outrival/shared";
