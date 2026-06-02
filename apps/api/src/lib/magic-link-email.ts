import { Resend } from "resend";

// Magic link email — sent from the API process (Better Auth's sendMagicLink runs
// here, not in the workers). Inline HTML to match the existing digest/alert email
// pattern (no React Email dependency). Dark + amber, English-only (language.md).

let client: Resend | null = null;

function getResend(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null; // dev without Resend → magic link send is a no-op
  client = new Resend(key);
  return client;
}

const AUTH_FROM = process.env.RESEND_AUTH_FROM ?? "Outrival <auth@outrival.io>";

function renderMagicLinkEmail(url: string, expiresInMinutes: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;background:#0b0b0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:440px;margin:0 auto;padding:48px 24px;">
    <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin-bottom:40px;">
      <span style="color:#fafafa;">out</span><span style="color:#f59e0b;">rival</span>
    </div>

    <h1 style="color:#fafafa;font-size:20px;font-weight:600;margin:0 0 12px;">Your sign-in link</h1>

    <p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin:0 0 28px;">
      Click the button below to sign in to Outrival. This link expires in
      ${expiresInMinutes} minutes and can only be used once.
    </p>

    <a href="${url}" style="display:inline-block;background:#f59e0b;color:#0b0b0d;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:6px;">
      Sign in to Outrival →
    </a>

    <p style="color:rgba(255,255,255,0.4);font-size:12px;line-height:1.6;margin:28px 0 8px;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="color:rgba(255,255,255,0.6);font-size:12px;word-break:break-all;margin:0 0 28px;">
      <a href="${url}" style="color:#f59e0b;">${url}</a>
    </p>

    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0 0 20px;" />

    <p style="color:rgba(255,255,255,0.4);font-size:12px;line-height:1.6;margin:0;">
      If you didn't request this link, you can ignore this email — your account stays secure.
    </p>
  </div>
</body>
</html>`;
}

export async function sendMagicLinkEmail({
  to,
  url,
  expiresInMinutes = 10,
}: {
  to: string;
  url: string;
  expiresInMinutes?: number;
}): Promise<void> {
  // In dev the from-domain isn't verified in Resend (send 403s), so log the link
  // to let local sign-in work without a verified domain / inbox.
  if (process.env.NODE_ENV !== "production") {
    console.log(`🔗 Magic link for ${to}: ${url}`);
  }

  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping magic link email (dev only)");
    return;
  }
  const { error } = await resend.emails.send({
    from: AUTH_FROM,
    to,
    subject: "Your Outrival sign-in link",
    html: renderMagicLinkEmail(url, expiresInMinutes),
  });
  // Resend resolves with { error } instead of throwing — surface it instead of
  // swallowing (e.g. "domain not verified" 403). The caller still resolves so the
  // route keeps its identical anti-enumeration response.
  if (error) {
    console.error("Resend magic link send failed", { to, error });
  }
}
