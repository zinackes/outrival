import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql, type InferSelectModel, type InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";

// Org-scoped OAuth authorizations for third-party integrations (OUT-176). This is
// an app authorization granted on behalf of an org, NOT a user login: Better Auth
// owns user login (Google), this table owns "the org connected its Slack workspace".
//
// Both token columns hold AES-256-GCM ciphertext produced by
// apps/api/src/lib/oauth/crypto.ts. Nothing writes plaintext here, and no route
// selects these columns: only OAuthConnectionStatus ever reaches a client.
//
// `provider` is plain text rather than a pg enum so shipping a new provider is a
// change to OAUTH_PROVIDERS in @outrival/shared, not a migration on a shared env.
export const oauthConnections = pgTable(
  "oauth_connections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    accessToken: text("access_token").notNull(),
    // Nullable: some providers issue a non-expiring access token and no refresh token.
    refreshToken: text("refresh_token"),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // null = the provider gave no expiry, so the token is treated as always valid.
    expiresAt: timestamp("expires_at"),
    // Human-readable external account, e.g. a Slack workspace name. Shown in the UI
    // so a user can tell which account is connected without us exposing a token.
    accountLabel: text("account_label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // v1: one connection per provider per org. The upsert in token-store.ts targets
    // this index, so reconnecting rotates the tokens instead of stacking rows.
    uniqueIndex("oauth_connections_org_provider_idx").on(t.orgId, t.provider),
    index("oauth_connections_org_idx").on(t.orgId),
  ],
);

export type OAuthConnection = InferSelectModel<typeof oauthConnections>;
export type NewOAuthConnection = InferInsertModel<typeof oauthConnections>;
