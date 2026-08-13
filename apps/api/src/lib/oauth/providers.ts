import type { OAuthProvider } from "@outrival/shared";

// Provider registry. Deliberately EMPTY in OUT-176: this ticket ships the token
// store, not an integration. Each provider registers its own adapter from its own
// follow-up ticket (Slack first), so until then every connect route answers
// `provider_not_configured` and no OAuth traffic can leave the API.

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  accountLabel: string | null;
}

export interface OAuthProviderAdapter {
  provider: OAuthProvider;
  /** Absolute URL the user is redirected to, carrying the signed CSRF state. */
  authorizeUrl(state: string, redirectUri: string): string;
  /** Exchange the callback code for a token set. */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenSet>;
  /** Trade a refresh token for a fresh access token. Absent = the provider issues
   *  non-expiring tokens, so getValidToken never needs to call out. */
  refresh?(refreshToken: string): Promise<OAuthTokenSet>;
  /** Best-effort revocation at the provider. Failure must not block local deletion. */
  revoke?(accessToken: string): Promise<void>;
}

const ADAPTERS = new Map<OAuthProvider, OAuthProviderAdapter>();

export function registerProvider(adapter: OAuthProviderAdapter): void {
  ADAPTERS.set(adapter.provider, adapter);
}

export function getProvider(provider: OAuthProvider): OAuthProviderAdapter | null {
  return ADAPTERS.get(provider) ?? null;
}
