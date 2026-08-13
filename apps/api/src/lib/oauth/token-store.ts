import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { oauthConnections } from "@outrival/db";
import { isOAuthProvider, type OAuthConnectionStatus, type OAuthProvider } from "@outrival/shared";
import { db } from "../db";
import { decryptToken, encryptToken } from "./crypto";
import { getProvider, type OAuthTokenSet } from "./providers";

// The org-scoped OAuth token store. Every read goes through getValidToken, so a
// caller never sees a ciphertext and never has to think about expiry.

/** The provider no longer honours our authorization: the user must reconnect. */
export class OAuthConnectionRevokedError extends Error {
  readonly provider: OAuthProvider;
  constructor(provider: OAuthProvider, message: string) {
    super(message);
    this.name = "OAuthConnectionRevokedError";
    this.provider = provider;
  }
}

// Refresh a minute early: a token that passes the check can still expire while the
// provider call it was fetched for is in flight.
const EXPIRY_SKEW_MS = 60_000;

// CSRF state TTL. Long enough for a consent screen, short enough that a leaked
// redirect URL is worthless by the time it is found in a log.
const STATE_TTL_MS = 10 * 60_000;

/**
 * A valid access token for (org, provider), refreshing and persisting first when
 * the stored one has expired.
 *
 * @throws OAuthConnectionRevokedError when there is no connection, no refresh
 * token, or the provider rejects the refresh.
 */
export async function getValidToken(orgId: string, provider: OAuthProvider): Promise<string> {
  const row = await db.query.oauthConnections.findFirst({
    where: and(eq(oauthConnections.orgId, orgId), eq(oauthConnections.provider, provider)),
  });
  if (!row) throw new OAuthConnectionRevokedError(provider, "not_connected");

  // Load-bearing fast path: a still-valid token makes ZERO network calls. Every
  // caller of an integration goes through here, so a refresh-on-every-read would
  // put a provider round-trip in front of every single request.
  if (!row.expiresAt || row.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return decryptToken(row.accessToken);
  }

  const adapter = getProvider(provider);
  if (!row.refreshToken || !adapter?.refresh) {
    throw new OAuthConnectionRevokedError(provider, "not_refreshable");
  }

  let refreshed: OAuthTokenSet;
  try {
    refreshed = await adapter.refresh(decryptToken(row.refreshToken));
  } catch (err) {
    // A provider rejecting our refresh token means the user revoked the app on
    // their side. Surfacing it as a generic failure would make callers retry
    // forever against an authorization that is never coming back.
    throw new OAuthConnectionRevokedError(provider, `refresh_failed: ${String(err)}`);
  }

  await db
    .update(oauthConnections)
    .set({
      accessToken: encryptToken(refreshed.accessToken),
      // Providers that rotate refresh tokens send a new one; the others send none,
      // and overwriting with null there would break every later refresh.
      ...(refreshed.refreshToken ? { refreshToken: encryptToken(refreshed.refreshToken) } : {}),
      expiresAt: refreshed.expiresAt,
      ...(refreshed.scopes.length > 0 ? { scopes: refreshed.scopes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(oauthConnections.id, row.id));

  return refreshed.accessToken;
}

/** Create or rotate the org's connection for a provider (one row per pair). */
export async function saveConnection(
  orgId: string,
  provider: OAuthProvider,
  tokens: OAuthTokenSet,
): Promise<void> {
  const accessToken = encryptToken(tokens.accessToken);
  const refreshToken = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;
  await db
    .insert(oauthConnections)
    .values({
      orgId,
      provider,
      accessToken,
      refreshToken,
      scopes: tokens.scopes,
      expiresAt: tokens.expiresAt,
      accountLabel: tokens.accountLabel,
    })
    // Reconnecting rotates the tokens in place instead of stacking rows, which is
    // what the (org_id, provider) unique index is there to guarantee.
    .onConflictDoUpdate({
      target: [oauthConnections.orgId, oauthConnections.provider],
      set: {
        accessToken,
        refreshToken,
        scopes: tokens.scopes,
        expiresAt: tokens.expiresAt,
        accountLabel: tokens.accountLabel,
        updatedAt: new Date(),
      },
    });
}

/** Disconnect. Returns whether a connection existed. */
export async function deleteConnection(orgId: string, provider: OAuthProvider): Promise<boolean> {
  const row = await db.query.oauthConnections.findFirst({
    where: and(eq(oauthConnections.orgId, orgId), eq(oauthConnections.provider, provider)),
  });
  if (!row) return false;

  const adapter = getProvider(provider);
  if (adapter?.revoke) {
    try {
      await adapter.revoke(decryptToken(row.accessToken));
    } catch {
      // Best effort. A provider that is down must never leave the user stuck with a
      // connection they asked us to remove: the local row goes either way.
    }
  }

  await db.delete(oauthConnections).where(eq(oauthConnections.id, row.id));
  return true;
}

/**
 * The client-facing view of a connection. Selects the safe columns explicitly, so a
 * token cannot reach a response even if this mapper is later edited carelessly.
 */
export async function getConnectionStatus(
  orgId: string,
  provider: OAuthProvider,
): Promise<OAuthConnectionStatus | null> {
  const [row] = await db
    .select({
      provider: oauthConnections.provider,
      accountLabel: oauthConnections.accountLabel,
      scopes: oauthConnections.scopes,
      expiresAt: oauthConnections.expiresAt,
      createdAt: oauthConnections.createdAt,
    })
    .from(oauthConnections)
    .where(and(eq(oauthConnections.orgId, orgId), eq(oauthConnections.provider, provider)))
    .limit(1);
  return row ? toStatus(row) : null;
}

/** Every provider this org has connected, same safe projection. */
export async function listConnectionStatuses(orgId: string): Promise<OAuthConnectionStatus[]> {
  const rows = await db
    .select({
      provider: oauthConnections.provider,
      accountLabel: oauthConnections.accountLabel,
      scopes: oauthConnections.scopes,
      expiresAt: oauthConnections.expiresAt,
      createdAt: oauthConnections.createdAt,
    })
    .from(oauthConnections)
    .where(eq(oauthConnections.orgId, orgId));
  return rows.filter((r) => isOAuthProvider(r.provider)).map(toStatus);
}

function toStatus(row: {
  provider: string;
  accountLabel: string | null;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
}): OAuthConnectionStatus {
  return {
    provider: row.provider as OAuthProvider,
    connected: true,
    accountLabel: row.accountLabel,
    scopes: row.scopes,
    connectedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

// CSRF state. The callback is a GET the provider triggers in the user's browser, so
// the only thing tying it back to the org that started the flow is this signature.

function stateSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set: cannot sign an OAuth state");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", stateSecret()).update(payload).digest("base64url");
}

export function signState(orgId: string, provider: OAuthProvider): string {
  const payload = `${orgId}.${provider}.${Date.now()}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

/** null on tampering, malformed input, expiry, or an unknown provider. */
export function verifyState(state: string): { orgId: string; provider: OAuthProvider } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = Buffer.from(sign(payload), "utf8");
  const got = Buffer.from(signature, "utf8");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  const fields = payload.split(".");
  if (fields.length !== 3) return null;
  const [orgId, provider, issuedAt] = fields as [string, string, string];
  const issued = Number(issuedAt);
  if (!orgId || !isOAuthProvider(provider)) return null;
  if (!Number.isFinite(issued) || Date.now() - issued > STATE_TTL_MS) return null;
  return { orgId, provider };
}
