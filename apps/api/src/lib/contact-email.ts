import { Resend } from "resend";

// Demo / sales contact email — sent from the API when someone submits the public
// /demo form (Request a demo, or the Business plan "Talk to sales" CTA). Mirrors
// the sign-in email pattern: lazy Resend client, no-op + log in dev without a key.

let client: Resend | null = null;

function getResend(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client = new Resend(key);
  return client;
}

// From a verified sender (reuse the auth domain); TO our own inbox. Reply-To is the
// requester so hitting "reply" reaches them directly.
const FROM = process.env.RESEND_AUTH_FROM ?? "Outrival <auth@outrival.app>";
const TO = process.env.CONTACT_EMAIL ?? "hello@outrival.app";

export type DemoRequest = {
  name: string;
  email: string;
  company?: string;
  teamSize?: string;
  plan?: string;
  message?: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#71717a;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(label)}</td>
    <td style="padding:6px 0;color:#18181b;font-size:14px;vertical-align:top;">${esc(value)}</td>
  </tr>`;
}

function renderContactEmail(req: DemoRequest): string {
  const rows = [
    row("Name", req.name),
    row("Email", req.email),
    req.company ? row("Company", req.company) : "",
    req.teamSize ? row("Team size", req.teamSize) : "",
    req.plan ? row("Interested in", req.plan) : "",
    req.message ? row("Message", req.message) : "",
  ].join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
    <tr><td style="padding:24px;">
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#a1a1aa;margin-bottom:16px;">New demo request</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendDemoRequestEmail(req: DemoRequest): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log("📨 Demo request:", req);
  }
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping demo request email (dev only)");
    return;
  }
  const subject = `Demo request${req.plan ? ` · ${req.plan}` : ""} — ${req.name}`;
  const { error } = await resend.emails.send({
    from: FROM,
    to: TO,
    replyTo: req.email,
    subject,
    html: renderContactEmail(req),
  });
  if (error) {
    console.error("Resend demo request send failed", { error });
  }
}
