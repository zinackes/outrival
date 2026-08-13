import { Hono } from "hono";
import { z } from "zod";
import { OAUTH_PROVIDERS, type OAuthProvider } from "@outrival/shared";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { errorBody } from "../lib/errors";
import { isTokenEncryptionConfigured } from "../lib/oauth/crypto";
import { getProvider } from "../lib/oauth/providers";
import {
  deleteConnection,
  getConnectionStatus,
  listConnectionStatuses,
  saveConnection,
  signState,
  verifyState,
} from "../lib/oauth/token-store";

// Generic OAuth connection surface for third-party integrations (OUT-176). No plan
// gating here: the gate lives on each provider's feature (allowedChannels for Slack,
// crmIntegrations for HubSpot), never on the store itself.
//
// A token NEVER leaves this API. Handlers may only serialize OAuthConnectionStatus.

type Variables = { user: { id: string } };

export const oauthRouter = new Hono<{ Variables: Variables }>();

oauthRouter.use("*", authMiddleware);

const ProviderParam = z.object({ provider: z.enum(OAUTH_PROVIDERS) });

const CallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

function parseProvider(raw: string | undefined): OAuthProvider | null {
  const parsed = ProviderParam.safeParse({ provider: raw });
  return parsed.success ? parsed.data.provider : null;
}

const invalidProvider = () =>
  errorBody("invalid_provider", "That integration doesn't exist.");

const notConfigured = () =>
  errorBody("provider_not_configured", "That integration isn't available yet.");

const exchangeFailed = () =>
  errorBody("oauth_exchange_failed", "We couldn't finish connecting that account. Try again.", {
    userAction: "retry",
  });

oauthRouter.get("/", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  return c.json({ data: { connections: await listConnectionStatuses(orgId) } });
});

oauthRouter.get("/:provider", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  if (!provider) return c.json(invalidProvider(), 400);
  const orgId = await ensureUserOrg(c.get("user").id);
  return c.json({ data: { connection: await getConnectionStatus(orgId, provider) } });
});

// Returns the URL instead of a 302: the web client opens the consent screen in a
// popup it owns, so a redirect here would navigate the app out of itself.
oauthRouter.post("/:provider/start", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  if (!provider) return c.json(invalidProvider(), 400);

  const adapter = getProvider(provider);
  if (!adapter) return c.json(notConfigured(), 501);
  if (!isTokenEncryptionConfigured()) {
    return c.json(
      errorBody(
        "oauth_encryption_unconfigured",
        "Integrations aren't configured on this environment yet.",
        { userAction: "contact" },
      ),
      500,
    );
  }

  const orgId = await ensureUserOrg(c.get("user").id);
  try {
    const authorizeUrl = adapter.authorizeUrl(signState(orgId, provider), redirectUri(provider));
    return c.json({ data: { authorizeUrl } });
  } catch {
    return c.json(exchangeFailed(), 502);
  }
});

oauthRouter.get("/:provider/callback", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  if (!provider) return c.json(invalidProvider(), 400);

  const query = CallbackQuery.safeParse(c.req.query());
  if (!query.success) return c.json(errorBody("invalid_callback", "That callback was malformed."), 400);
  const { code, state, error } = query.data;

  if (error) {
    return c.json(errorBody("oauth_denied", "You declined the connection request."), 400);
  }
  if (!code || !state) {
    return c.json(errorBody("invalid_callback", "That callback was malformed."), 400);
  }

  const verified = verifyState(state);
  if (!verified || verified.provider !== provider) {
    return c.json(errorBody("invalid_state", "That connection link expired. Start again."), 400);
  }

  const orgId = await ensureUserOrg(c.get("user").id);
  // A state minted for another org must never bind a connection here: without this
  // check, replaying someone else's callback would attach their account to this org.
  if (verified.orgId !== orgId) {
    return c.json(
      errorBody("state_org_mismatch", "That connection link belongs to another workspace."),
      403,
    );
  }

  const adapter = getProvider(provider);
  if (!adapter) return c.json(notConfigured(), 501);

  try {
    const tokens = await adapter.exchangeCode(code, redirectUri(provider));
    await saveConnection(orgId, provider, tokens);
  } catch {
    // Never surface the provider's error: it carries the code we just exchanged.
    return c.json(exchangeFailed(), 502);
  }

  return c.json({ data: { connection: await getConnectionStatus(orgId, provider) } });
});

oauthRouter.delete("/:provider", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  if (!provider) return c.json(invalidProvider(), 400);
  const orgId = await ensureUserOrg(c.get("user").id);
  try {
    return c.json({ data: { disconnected: await deleteConnection(orgId, provider) } });
  } catch {
    return c.json(exchangeFailed(), 502);
  }
});

// Must match the URL registered on the provider's app config, so it is derived from
// the API origin rather than from the request (a spoofed Host would move it).
function redirectUri(provider: OAuthProvider): string {
  return `${process.env.BETTER_AUTH_URL ?? ""}/api/oauth/${provider}/callback`;
}
