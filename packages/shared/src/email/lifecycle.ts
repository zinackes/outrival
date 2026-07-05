import { darkEmailShell } from "./shell";
import { escapeHtml } from "./escape-html";

// Behavioral lifecycle emails (Lever 5, docs/post-onboarding-activation.md). Pure
// render functions (no DB, no Resend) so they stay in @outrival/shared and are easy
// to test; the worker sends the result. Same dark shell + palette as the digest.

const WORDMARK = `<div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:#fafafa;margin-bottom:20px;">Outrival</div>`;

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#fafafa;color:#0a0a0a;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>`;
}

// Brick 1 — D0 welcome digest: "here's your starting position; we'll email when it moves."
export function renderWelcomeEmail(input: {
  competitorNames: string[];
  dashboardUrl: string;
}): { subject: string; html: string } {
  const count = input.competitorNames.length;
  const list =
    count > 0
      ? `<ul style="margin:0 0 20px;padding-left:18px;color:#d4d4d4;font-size:14px;line-height:1.7;">${input.competitorNames
          .slice(0, 12)
          .map((n) => `<li>${escapeHtml(n)}</li>`)
          .join("")}</ul>`
      : "";
  const inner = `
${WORDMARK}
<div style="font-size:20px;font-weight:600;color:#fafafa;margin-bottom:12px;">You're all set.</div>
<div style="color:#d4d4d4;font-size:14px;line-height:1.6;margin-bottom:16px;">
  We're now tracking ${count} competitor${count === 1 ? "" : "s"} and have captured where they
  stand today — pricing, hiring, reviews and more. From here, we watch for changes and email
  you the moment something moves.
</div>
${list}
${button(input.dashboardUrl, "Open your dashboard")}
<div style="color:#737373;font-size:12px;margin-top:28px;">You'll only hear from us when it matters.</div>`;
  return {
    subject: "You're all set — here's your competitive starting position",
    html: darkEmailShell(inner),
  };
}

// Brick 3 — first-change celebration: the single most important email. ONLY sent for
// the first LIVE change (never a backfill/archive one — see the worker gate).
export function renderCelebrationEmail(input: {
  competitorName: string;
  category: string;
  insight: string;
  soWhat?: string | null;
  signalUrl: string;
}): { subject: string; html: string } {
  const inner = `
${WORDMARK}
<div style="font-size:20px;font-weight:600;color:#fafafa;margin-bottom:6px;">Your monitoring just paid off.</div>
<div style="color:#a3a3a3;font-size:13px;margin-bottom:18px;">We caught the first change since we started watching.</div>
<div style="background:#171717;border:1px solid #262626;border-radius:6px;padding:16px;margin-bottom:20px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#a3a3a3;margin-bottom:6px;">${escapeHtml(input.competitorName)} · ${escapeHtml(input.category)}</div>
  <div style="color:#fafafa;font-size:14px;margin-bottom:8px;">${escapeHtml(input.insight)}</div>
  ${input.soWhat ? `<div style="color:#f59e0b;font-size:13px;">→ ${escapeHtml(input.soWhat)}</div>` : ""}
</div>
${button(input.signalUrl, "See what changed")}
<div style="color:#737373;font-size:12px;margin-top:28px;">This is the first of many. We'll keep watching.</div>`;
  return {
    subject: `Your monitoring just paid off — ${input.competitorName} moved`,
    html: darkEmailShell(inner),
  };
}
