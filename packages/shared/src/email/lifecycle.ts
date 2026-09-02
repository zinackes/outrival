import { emailButton, emailShell } from "./shell";
import { e, t } from "./theme";
import { escapeHtml } from "./escape-html";

// Behavioral lifecycle emails (Lever 5, docs/post-onboarding-activation.md). Pure
// render functions (no DB, no Resend) so they stay in @outrival/shared and are easy
// to test; the worker sends the result. Same shell + palette as the digest.

// Every lifecycle email goes to organizations.digestEmail and its send is gated on
// the same organizations.digestEnabled flag as the digests, so it carries the same
// one-click footer the digest does (ux:45) — one link that stops all of them.
// Absent URL → no footer, the same degradation contract as renderDigestEmail's.
function unsubscribeFooter(unsubscribeUrl?: string): string {
  if (!unsubscribeUrl) return "";
  return `<div ${e("faint", t("meta", "margin-top:32px;letter-spacing:normal;"))}>Outrival · Automated competitive intelligence · <a href="${escapeHtml(unsubscribeUrl)}" ${e("faint", "text-decoration:underline;")}>Unsubscribe</a></div>`;
}

// Brick 1 — D0 welcome digest: "here's your starting position; we'll email when it moves."
export function renderWelcomeEmail(input: {
  competitorNames: string[];
  dashboardUrl: string;
  unsubscribeUrl?: string;
}): { subject: string; html: string } {
  const count = input.competitorNames.length;
  const list =
    count > 0
      ? `<ul ${e("muted", t("body", "margin:0 0 24px;padding-left:18px;"))}>${input.competitorNames
          .slice(0, 12)
          .map((n) => `<li style="margin-bottom:6px;">${escapeHtml(n)}</li>`)
          .join("")}</ul>`
      : "";
  const inner = `
<h1 ${e("text", t("title", "margin:0 0 12px;"))}>You're all set.</h1>
<div ${e("muted", t("body", "margin-bottom:20px;"))}>
  We're now tracking ${count} competitor${count === 1 ? "" : "s"} and have captured where they
  stand today: pricing, hiring, reviews and more. From here, we watch for changes and email
  you the moment something moves.
</div>
${list}
${emailButton(input.dashboardUrl, "Open your dashboard")}
<div ${e("faint", t("dense", "margin-top:28px;"))}>You'll only hear from us when it matters.</div>
${unsubscribeFooter(input.unsubscribeUrl)}`;
  return {
    subject: "You're all set. Here's your competitive starting position",
    html: emailShell(inner, 520, "We're watching your competitors from today."),
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
  unsubscribeUrl?: string;
}): { subject: string; html: string } {
  // The one change IS the email, so it keeps a card: a single object to look at,
  // where the digest's boxless run of rows would have nothing to separate.
  const inner = `
<h1 ${e("text", t("title", "margin:0 0 6px;"))}>Your monitoring just paid off.</h1>
<div ${e("muted", t("body", "margin-bottom:20px;"))}>We caught the first change since we started watching.</div>
<div ${e("card", "border-radius:6px;padding:18px;margin-bottom:24px;")}>
  <div ${e("muted", t("dense", "margin-bottom:8px;"))}>${escapeHtml(input.competitorName)} · ${escapeHtml(input.category)}</div>
  <div ${e("text", t("lead", "margin-bottom:8px;"))}>${escapeHtml(input.insight)}</div>
  ${input.soWhat ? `<div ${e("muted", t("body"))}>→ ${escapeHtml(input.soWhat)}</div>` : ""}
</div>
${emailButton(input.signalUrl, "See what changed")}
<div ${e("faint", t("dense", "margin-top:28px;"))}>This is the first of many. We'll keep watching.</div>
${unsubscribeFooter(input.unsubscribeUrl)}`;
  return {
    subject: `Your monitoring just paid off. ${input.competitorName} moved`,
    html: emailShell(inner, 520, input.insight),
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
  unsubscribeUrl?: string;
}): { subject: string; html: string } {
  // Figures the product measured: sans + tabular-nums, never mono (DESIGN.md §3).
  const stat = (n: number, label: string) =>
    `<td width="50%" ${e("panel", "border-radius:6px;padding:16px 18px;")}><div ${e("text", t("stat"))}>${n}</div><div ${e("muted", t("meta", "margin-top:8px;"))}>${escapeHtml(label)}</div></td>`;
  const inner = `
<div ${e("muted", t("meta", "margin-bottom:8px;"))}>${escapeHtml(input.monthLabel)}</div>
<h1 ${e("text", t("title", "margin:0 0 20px;"))}>Your competitive recap is ready.</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 22px;border-collapse:separate;border-spacing:10px 0;">
  <tr>${stat(input.totalMoves, "moves caught")}${stat(input.competitorsTracked, "competitors")}</tr>
</table>
${
  input.busiestName
    ? `<div ${e("muted", t("body", "margin-bottom:10px;"))}>Your most active rival was <strong ${e("text")}>${escapeHtml(input.busiestName)}</strong>.</div>`
    : ""
}
${
  input.biggestInsight
    ? `<div ${e(["card", "text"], t("body", "border-radius:6px;padding:14px 16px;margin-bottom:24px;"))}>Biggest move: ${escapeHtml(input.biggestInsight)}</div>`
    : ""
}
${emailButton(input.recapUrl, "See your full recap →")}
<div ${e("faint", t("dense", "margin-top:28px;"))}>A quick look back. Tap through your month.</div>
${unsubscribeFooter(input.unsubscribeUrl)}`;
  return {
    subject: `Your ${input.monthLabel} competitive recap`,
    html: emailShell(inner, 520, `${input.totalMoves} moves across ${input.competitorsTracked} competitors.`),
  };
}
