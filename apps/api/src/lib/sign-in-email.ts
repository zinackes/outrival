import { Resend } from "resend";
import { emailShell, emailButton, e, t, escapeHtml } from "@outrival/shared";

// Sign-in email — sent from the API process (Better Auth's emailOTP
// sendVerificationOTP runs here, not in the workers). One email carries BOTH a
// 6-digit code (type it, works cross-device) and a one-click link (same token).
// Inline HTML to match the existing digest/alert pattern (no React Email dep).
// English-only (language.md). Renders through the shared light/dark shell —
// these used to carry a second, hand-maintained copy of it that only did dark.

let client: Resend | null = null;

function getResend(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null; // dev without Resend → email send is a no-op
  client = new Resend(key);
  return client;
}

// outrival.app is the only domain verified in Resend. This fallback carries the
// sign-in code, so a wrong domain here does not degrade — it locks people out.
const AUTH_FROM = process.env.RESEND_AUTH_FROM ?? "Outrival <auth@outrival.app>";

// Auth emails are narrower than a digest — a code and one sentence.
const renderShell = (inner: string): string => emailShell(inner, 440);

// Solid surface/border colors (not rgba-on-transparent) so the code box reads even
// if a client ignores the wrapper background.
// Exported for the escaping regression test (code:SEC-05); nothing else calls it.
export function renderCodeBox(code: string): string {
  // The one place mono is correct: a string read glyph by glyph, where a mistaken
  // character changes the meaning (DESIGN.md §3, the Machine-Truth Rule). Radius
  // drops to the 6px card step so it matches every other surface we send.
  // `code` is a Better Auth OTP, digits today, so the escape below is a runtime
  // no-op. It is here so "every value interpolated into email HTML is escaped"
  // holds without a reader having to re-derive this code's alphabet.
  return `<div ${e(["panel", "rule"], "border-radius:6px;border-width:1px;border-style:solid;padding:22px 20px;text-align:center;margin:0 0 28px;")}>
        <div ${e("text", "font-size:32px;font-weight:600;letter-spacing:0.3em;line-height:1.1;font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;")}>${escapeHtml(code)}</div>
      </div>`;
}

function renderSignInEmail(
  code: string,
  linkUrl: string,
  expiresInMinutes: number,
): string {
  return renderShell(`<h1 ${e("text", t("title", "margin:0 0 12px;"))}>Sign in to Outrival</h1>

      <p ${e("muted", t("body", "margin:0 0 28px;"))}>
        Enter this code to finish signing in. It expires in ${expiresInMinutes} minutes
        and can only be used once.
      </p>

      ${renderCodeBox(code)}

      <p ${e("muted", t("body", "margin:0 0 16px;"))}>
        Or just click the button to sign in on this device:
      </p>

      ${emailButton(linkUrl, "Sign in to Outrival →")}

      <hr ${e("rule", "border-width:0;border-top-width:1px;border-top-style:solid;margin:28px 0 20px;")} />

      <p ${e("faint", t("dense", "margin:0;"))}>
        If you didn't request this, you can ignore this email. Your account stays secure.
      </p>`);
}

function renderEmailChangeEmail(code: string, expiresInMinutes: number): string {
  return renderShell(`<h1 ${e("text", t("title", "margin:0 0 12px;"))}>Confirm your new email</h1>

      <p ${e("muted", t("body", "margin:0 0 28px;"))}>
        Enter this code in Outrival to set this address as your new sign-in email.
        It expires in ${expiresInMinutes} minutes and can only be used once.
      </p>

      ${renderCodeBox(code)}

      <p ${e("faint", t("dense", "margin:0;"))}>
        If you didn't request this change, you can ignore this email. Your account
        email stays the same.
      </p>`);
}

function renderReauthEmail(code: string, expiresInMinutes: number): string {
  return renderShell(`<h1 ${e("text", t("title", "margin:0 0 12px;"))}>Confirm a sensitive action</h1>

      <p ${e("muted", t("body", "margin:0 0 28px;"))}>
        Enter this code to confirm a destructive action on your account (such as
        deleting your workspace). It expires in ${expiresInMinutes} minutes.
      </p>

      ${renderCodeBox(code)}

      <p ${e("faint", t("dense", "margin:0;"))}>
        If you didn't start this, ignore this email and consider changing how you sign in.
        Nothing has been deleted.
      </p>`);
}

// Sent when a user starts a destructive action (delete workspace / account) to
// re-verify control of the account email before it goes through.
export async function sendReauthCodeEmail({
  to,
  code,
  expiresInMinutes = 10,
}: {
  to: string;
  code: string;
  expiresInMinutes?: number;
}): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log(`🔒 Re-auth code for ${to}: ${code}`);
  }
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping re-auth email (dev only)");
    return;
  }
  const { error } = await resend.emails.send({
    from: AUTH_FROM,
    to,
    subject: "Confirm a sensitive action on Outrival",
    html: renderReauthEmail(code, expiresInMinutes),
  });
  if (error) {
    console.error("Resend re-auth email send failed", { to, error });
  }
}

function renderSetPasswordEmail(code: string, expiresInMinutes: number): string {
  return renderShell(`<h1 ${e("text", t("title", "margin:0 0 12px;"))}>Confirm your new password</h1>

      <p ${e("muted", t("body", "margin:0 0 28px;"))}>
        Enter this code in Outrival to save your new account password. It expires in
        ${expiresInMinutes} minutes and can only be used once.
      </p>

      ${renderCodeBox(code)}

      <p ${e("faint", t("dense", "margin:0;"))}>
        If you didn't request this, ignore this email. Your password stays unchanged.
      </p>`);
}

// Sent when a signed-in user sets or changes their account password from
// Settings → Security. Same emailed step-up code as the re-auth flow, but its own
// template so the copy matches the action ("your new password", not "destructive").
export async function sendSetPasswordCodeEmail({
  to,
  code,
  expiresInMinutes = 10,
}: {
  to: string;
  code: string;
  expiresInMinutes?: number;
}): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log(`🔑 Set-password code for ${to}: ${code}`);
  }
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping set-password email (dev only)");
    return;
  }
  const { error } = await resend.emails.send({
    from: AUTH_FROM,
    to,
    subject: "Confirm your new Outrival password",
    html: renderSetPasswordEmail(code, expiresInMinutes),
  });
  if (error) {
    console.error("Resend set-password email send failed", { to, error });
  }
}

// Sent to the NEW address when a signed-in user changes their email (Better Auth
// emailOTP changeEmail, type "change-email"). Mirrors the sign-in email pattern.
export async function sendEmailChangeCodeEmail({
  to,
  code,
  expiresInMinutes = 10,
}: {
  to: string;
  code: string;
  expiresInMinutes?: number;
}): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log(`✉️  Email-change code for ${to}: ${code}`);
  }
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping email-change email (dev only)");
    return;
  }
  const { error } = await resend.emails.send({
    from: AUTH_FROM,
    to,
    subject: "Confirm your new Outrival email",
    html: renderEmailChangeEmail(code, expiresInMinutes),
  });
  if (error) {
    console.error("Resend email-change email send failed", { to, error });
  }
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
