import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { qualityFeedback, digests, users, organizations } from "@outrival/db";
import { escapeHtml, verifyDigestFeedbackToken, verifyUnsubscribeToken } from "@outrival/shared";
import { db } from "../lib/db";

// Public one-click digest feedback from the weekly email (patch-21, point d).
// No auth middleware: the signed token IS the credential. Anti-forgery via HMAC;
// the response is always a tiny HTML page (this opens in a browser tab).

export const digestFeedbackRouter = new Hono();

function page(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Outrival feedback</title></head>
<body style="margin:0;background:#0a0a0a;color:#fafafa;font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
<div style="text-align:center;padding:24px;">
<div style="font-family:Syne,sans-serif;font-size:24px;font-weight:bold;margin-bottom:12px;">Out<span style="color:#818cf8;">rival</span></div>
<p style="color:#a3a3a3;font-size:15px;">${message}</p>
</div></body></html>`;
}

// GET requests are fetched by machines all the time (mail scanners, link
// unfurlers, browser prefetch) with no user intent behind them, so a GET here
// must never mutate. This renders a confirmation page whose form POSTs back
// to the same URL (token kept in the query string) to actually perform the
// write — a real click, not a fetch.
function confirmPage(message: string, actionPath: string, token: string, button: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Outrival feedback</title></head>
<body style="margin:0;background:#0a0a0a;color:#fafafa;font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
<div style="text-align:center;padding:24px;">
<div style="font-family:Syne,sans-serif;font-size:24px;font-weight:bold;margin-bottom:12px;">Out<span style="color:#818cf8;">rival</span></div>
<p style="color:#a3a3a3;font-size:15px;">${message}</p>
<form method="post" action="${actionPath}?token=${escapeHtml(token)}" style="margin-top:16px;">
<button type="submit" style="padding:10px 20px;border-radius:8px;border:none;background:#818cf8;color:#0a0a0a;font-size:14px;font-weight:600;cursor:pointer;">${button}</button>
</form>
</div></body></html>`;
}

// One-click unsubscribe from the digest email footer. Same trust model as the
// feedback link: the signed token is the credential, and the only effect is
// flipping digestEnabled off (reversible from Settings > Notifications).
// GET only shows a confirmation page — it must not mutate (see confirmPage
// above). POST is the actual mutation: the RFC 8058 List-Unsubscribe-Post path
// mail clients call directly, and also where the confirmation form above submits.
digestFeedbackRouter.get("/unsubscribe", async (c) => {
  const token = c.req.query("token");
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const payload = token && secret ? verifyUnsubscribeToken(token, secret) : null;
  if (!token || !payload) {
    return c.html(page("This unsubscribe link is invalid."), 400);
  }

  return c.html(
    confirmPage(
      "Stop digest emails for your organization? You can re-enable them anytime in Settings → Notifications.",
      "/api/digest-feedback/unsubscribe",
      token,
      "Unsubscribe",
    ),
  );
});

digestFeedbackRouter.post("/unsubscribe", async (c) => {
  const token = c.req.query("token");
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const payload = token && secret ? verifyUnsubscribeToken(token, secret) : null;
  if (!payload) {
    return c.html(page("This unsubscribe link is invalid."), 400);
  }

  await db
    .update(organizations)
    .set({ digestEnabled: false, updatedAt: new Date() })
    .where(eq(organizations.id, payload.orgId));

  return c.html(
    page(
      "You're unsubscribed from digest emails. You can re-enable them anytime in Settings → Notifications.",
    ),
  );
});

digestFeedbackRouter.get("/", async (c) => {
  const token = c.req.query("token");
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const payload = token && secret ? verifyDigestFeedbackToken(token, secret) : null;
  if (!token || !payload) {
    return c.html(page("This feedback link is invalid or has expired."), 400);
  }

  return c.html(
    confirmPage(
      payload.verdict === "useful"
        ? "Record that this digest was useful?"
        : "Record that this digest wasn't useful?",
      "/api/digest-feedback",
      token,
      "Confirm",
    ),
  );
});

digestFeedbackRouter.post("/", async (c) => {
  const token = c.req.query("token");
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const payload = token && secret ? verifyDigestFeedbackToken(token, secret) : null;
  if (!payload) {
    return c.html(page("This feedback link is invalid or has expired."), 400);
  }

  // The digest must belong to the org named in the token.
  const digest = await db.query.digests.findFirst({
    where: eq(digests.id, payload.digestId),
  });
  if (!digest || digest.orgId !== payload.orgId) {
    return c.html(page("This feedback link is invalid."), 400);
  }

  // Email feedback isn't tied to a session — attribute it to a user of the org.
  const owner =
    (await db.query.users.findFirst({
      where: and(eq(users.orgId, payload.orgId), eq(users.role, "owner")),
    })) ?? (await db.query.users.findFirst({ where: eq(users.orgId, payload.orgId) }));
  if (!owner) {
    return c.html(page("Thanks for your feedback!"));
  }

  // Upsert, not read-then-branch. The link lives in an email, so the two clicks
  // that race are the normal case — a second tab, or a mail client prefetching
  // the URL — and both used to see "no row" and both insert (`code:COR-15`).
  await db
    .insert(qualityFeedback)
    .values({
      userId: owner.id,
      orgId: payload.orgId,
      targetType: "digest",
      targetId: payload.digestId,
      verdict: payload.verdict,
    })
    .onConflictDoUpdate({
      target: [
        qualityFeedback.userId,
        qualityFeedback.targetType,
        qualityFeedback.targetId,
      ],
      set: { verdict: payload.verdict, createdAt: new Date() },
    });

  return c.html(
    page(
      payload.verdict === "useful"
        ? "Thanks — glad the digest was useful!"
        : "Thanks — we'll work on making the digest more useful.",
    ),
  );
});
