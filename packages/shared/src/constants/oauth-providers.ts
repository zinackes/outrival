// Third-party OAuth providers the token store can hold a connection for. No
// provider is wired yet (OUT-176 ships the store only); each one lands with its
// own adapter in a follow-up ticket. Adding a provider here is a constant change,
// not a migration: `oauth_connections.provider` is plain text on purpose.
export const OAUTH_PROVIDERS = ["slack", "hubspot", "salesforce"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The ONLY shape an OAuth route may serialize. Never add an access token, a
 * refresh token, or any derived secret to this interface: it is what makes
 * "a token never leaves the API" checkable by reading one type instead of
 * auditing every handler.
 */
export interface OAuthConnectionStatus {
  provider: OAuthProvider;
  connected: boolean;
  accountLabel: string | null;
  scopes: string[];
  connectedAt: string;
  expiresAt: string | null;
}
