import { emailButton, emailShell } from "./shell";
import { e } from "./theme";
import { escapeHtml } from "./escape-html";

// Behavioral lifecycle emails (Lever 5, docs/post-onboarding-activation.md). Pure
// render functions (no DB, no Resend) so they stay in @outrival/shared and are easy
// to test; the worker sends the result. Same shell + palette as the digest.

// Brick 1 — D0 welcome digest: "here's your starting position; we'll email when it moves."
export function renderWelcomeEmail(input: {
  competitorNames: string[];
  dashboardUrl: string;
}): { subject: string; html: string } {
  const count = input.competitorNames.length;
  const list =
    count > 0
      ? `<ul ${e("muted", "margin:0 0 20px;padding-left:18px;font-size:14px;line-height:1.7;")}>${input.competitorNames
          .slice(0, 12)
          .map((n) => `<li>${escapeHtml(n)}</li>`)
          .join("")}</ul>`
      : "";
  const inner = `
<div ${e("text", "font-size:20px;font-weight:600;margin-bottom:12px;")}>You're all set.</div>
<div ${e("muted", "font-size:14px;line-height:1.6;margin-bottom:16px;")}>
  We're now tracking ${count} competitor${count === 1 ? "" : "s"} and have captured where they
  stand today — pricing, hiring, reviews and more. From here, we watch for changes and email
  you the moment something moves.
</div>
${list}
${emailButton(input.dashboardUrl, "Open your dashboard")}
<div ${e("faint", "font-size:12px;margin-top:28px;")}>You'll only hear from us when it matters.</div>`;
  return {
    subject: "You're all set — here's your competitive starting position",
    html: emailShell(inner),
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
<div ${e("text", "font-size:20px;font-weight:600;margin-bottom:6px;")}>Your monitoring just paid off.</div>
<div ${e("muted", "font-size:13px;margin-bottom:18px;")}>We caught the first change since we started watching.</div>
<div ${e("card", "border-radius:6px;padding:16px;margin-bottom:20px;")}>
  <div ${e("muted", "font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;")}>${escapeHtml(input.competitorName)} · ${escapeHtml(input.category)}</div>
  <div ${e("text", "font-size:14px;margin-bottom:8px;")}>${escapeHtml(input.insight)}</div>
  ${input.soWhat ? `<div ${e("watch", "font-size:13px;")}>→ ${escapeHtml(input.soWhat)}</div>` : ""}
</div>
${emailButton(input.signalUrl, "See what changed")}
<div ${e("faint", "font-size:12px;margin-top:28px;")}>This is the first of many. We'll keep watching.</div>`;
  return {
    subject: `Your monitoring just paid off — ${input.competitorName} moved`,
    html: emailShell(inner),
  };
}

// Lever 9 — monthly "Competitive Recap" TEASER. The email can't be the Wrapped (no JS);
// it's the hook that drives to the in-app animated recap. 2-3 headline numbers + a CTA.
export function renderMonthlyRecapEmail(input: {
  monthLabel: string;
  totalMoves: number;
  competitorsTracked: number;
  busiestName?: string | null;
  biggestInsight?: string | null;
  recapUrl: string;
}): { subject: string; html: string } {
  const stat = (n: number, label: string) =>
    `<td style="padding:0 8px;"><div ${e("text", "font-size:30px;font-weight:700;line-height:1;")}>${n}</div><div ${e("muted", "font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-top:6px;")}>${escapeHtml(label)}</div></td>`;
  const inner = `
<div ${e("muted", "font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;")}>${escapeHtml(input.monthLabel)}</div>
<div ${e("text", "font-size:20px;font-weight:600;margin-bottom:18px;")}>Your competitive recap is ready.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;text-align:center;">
  <tr>${stat(input.totalMoves, "moves caught")}${stat(input.competitorsTracked, "competitors")}</tr>
</table>
${
  input.busiestName
    ? `<div ${e("muted", "font-size:14px;line-height:1.6;margin-bottom:8px;")}>Your most active rival was <strong ${e("text")}>${escapeHtml(input.busiestName)}</strong>.</div>`
    : ""
}
${
  input.biggestInsight
    ? `<div ${e(["card", "text"], "border-radius:6px;padding:14px;margin-bottom:20px;font-size:13px;")}>Biggest move: ${escapeHtml(input.biggestInsight)}</div>`
    : ""
}
${emailButton(input.recapUrl, "See your full recap →")}
<div ${e("faint", "font-size:12px;margin-top:28px;")}>A quick look back — tap through your month.</div>`;
  return {
    subject: `Your ${input.monthLabel} competitive recap`,
    html: emailShell(inner),
  };
}
