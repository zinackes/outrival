import { Resend } from "resend";

// Sign-in email — sent from the API process (Better Auth's emailOTP
// sendVerificationOTP runs here, not in the workers). One email carries BOTH a
// 6-digit code (type it, works cross-device) and a one-click link (same token).
// Inline HTML to match the existing digest/alert pattern (no React Email dep).
// Dark + amber, English-only (language.md).

let client: Resend | null = null;

function getResend(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null; // dev without Resend → email send is a no-op
  client = new Resend(key);
  return client;
}

const AUTH_FROM = process.env.RESEND_AUTH_FROM ?? "Outrival <auth@outrival.io>";

function renderSignInEmail(
  code: string,
  linkUrl: string,
  expiresInMinutes: number,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;background:#0b0b0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:440px;margin:0 auto;padding:48px 24px;">
    <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin-bottom:40px;">
      <span style="color:#fafafa;">out</span><span style="color:#f59e0b;">rival</span>
    </div>

    <h1 style="color:#fafafa;font-size:20px;font-weight:600;margin:0 0 12px;">Sign in to Outrival</h1>

    <p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin:0 0 28px;">
      Enter this code to finish signing in. It expires in ${expiresInMinutes} minutes
      and can only be used once.
    </p>

    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;text-align:center;margin:0 0 28px;">
      <div style="color:#fafafa;font-size:34px;font-weight:700;letter-spacing:0.35em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        ${code}
      </div>
    </div>

    <p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin:0 0 16px;">
      Or just click the button to sign in on this device:
    </p>

    <a href="${linkUrl}" style="display:inline-block;background:#f59e0b;color:#0b0b0d;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:6px;">
      Sign in to Outrival →
    </a>

    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:28px 0 20px;" />

    <p style="color:rgba(255,255,255,0.4);font-size:12px;line-height:1.6;margin:0;">
      If you didn't request this, you can ignore this email — your account stays secure.
    </p>
  </div>
</body>
</html>`;
}

export async function sendSignInCodeEmail({
  to,
  code,
  linkUrl,
  expiresInMinutes = 10,
}: {
  to: string;
  code: string;
  linkUrl: string;
  expiresInMinutes?: number;
}): Promise<void> {
  // In dev the from-domain isn't verified in Resend (send 403s), so log the code
  // + link to let local sign-in work without a verified domain / inbox.
  if (process.env.NODE_ENV !== "production") {
    console.log(`🔑 Sign-in code for ${to}: ${code}  (link: ${linkUrl})`);
  }

  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping sign-in email (dev only)");
    return;
  }
  const { error } = await resend.emails.send({
    from: AUTH_FROM,
    to,
    subject: "Your Outrival sign-in code",
    html: renderSignInEmail(code, linkUrl, expiresInMinutes),
  });
  // Resend resolves with { error } instead of throwing — surface it instead of
  // swallowing (e.g. "domain not verified" 403). The caller still resolves so the
  // route keeps its identical anti-enumeration response.
  if (error) {
    console.error("Resend sign-in email send failed", { to, error });
  }
}
