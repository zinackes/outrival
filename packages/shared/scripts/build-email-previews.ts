// Design artefacts for the transactional emails: one standalone HTML page per
// template, light and dark side by side, openable straight from the filesystem.
//
// Generated, never hand-written — the pages call the SAME renderers the workers
// and the API call, so an artefact cannot drift from what lands in an inbox. The
// live equivalent is /dev/preview-emails; these exist because a design review
// happens in a browser tab and a PR, not against a running Next.js server.
//
//   pnpm --filter @outrival/shared email:preview
//
// Everything is inlined (no external CSS, no fonts, no images beyond the logo the
// emails themselves reference), so a file:// open renders exactly what ships.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderAllQuietDigest, renderDigestEmail } from "../src/email/digest";
import {
  renderCelebrationEmail,
  renderMonthlyRecapEmail,
  renderWelcomeEmail,
} from "../src/email/lifecycle";
import { e, t, EMAIL_DARK, EMAIL_LIGHT } from "../src/email/theme";
import { emailButton, emailSectionHead, severityDot } from "../src/email/shell";

const OUT_DIR = fileURLToPath(new URL("../../../docs/design/emails/", import.meta.url));

// An iframe inherits the OS color scheme, so the dark column can't be produced by
// CSS alone. Promoting the shell's dark block to an unconditional one renders
// exactly what a dark client applies — same rules, same !important, same order.
function forceDark(html: string): string {
  return html.replace("@media (prefers-color-scheme: dark) {", "@media all {");
}

function attr(html: string): string {
  return html
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- WCAG contrast, so the palette table states measured ratios, not intent ----
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const u = c / 255;
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function ratio(a: string, b: string): string {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return ((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

// --- the page frame the artefacts share ---------------------------------------
const PAGE_CSS = `
  :root { color-scheme: light dark; --ink:#181b1f; --sub:#535861; --line:#dcdee1; --bg:#f9fafb; --card:#fefeff; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#f2f5f8; --sub:#9aa2ad; --line:#2d2d2d; --bg:#0a0a0a; --card:#161616; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 24px 72px; background:var(--bg); color:var(--ink);
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
         font-size:14px; line-height:1.6; }
  .wrap { max-width:1180px; margin:0 auto; }
  h1 { font-size:26px; font-weight:600; letter-spacing:-0.02em; margin:0 0 8px; }
  h2 { font-size:15px; font-weight:600; letter-spacing:-0.01em; margin:40px 0 14px;
       padding-bottom:8px; border-bottom:1px solid var(--line); }
  p.lede { color:var(--sub); margin:0 0 8px; max-width:70ch; }
  nav a { color:inherit; }
  .cols { display:grid; gap:16px; grid-template-columns:1fr; }
  @media (min-width: 900px) { .cols { grid-template-columns:1fr 1fr; } }
  .mode { font-size:11px; font-weight:500; letter-spacing:0.06em; text-transform:uppercase;
          color:var(--sub); margin:0 0 8px; }
  iframe { width:100%; height:760px; border:1px solid var(--line); border-radius:8px; background:var(--card); display:block; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { font-weight:600; color:var(--sub); font-size:11px; letter-spacing:0.04em; text-transform:uppercase; }
  .demo table { width:auto; border-collapse:separate; }
  .demo table td { border-bottom:0; padding:0; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .sw { display:inline-block; width:22px; height:22px; border-radius:4px; border:1px solid var(--line);
        vertical-align:middle; margin-right:8px; }
  .pass { color:#047857; font-weight:600; }
  .warn { color:#a16207; font-weight:600; }
  .demo { border:1px solid var(--line); border-radius:8px; padding:22px; background:#f9fafb; color:#181b1f; }
  ul.files { list-style:none; padding:0; margin:0; }
  ul.files li { padding:10px 0; border-bottom:1px solid var(--line); }
`;

function page(title: string, body: string, subtitle: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title} — Outrival email design</title>
<style>${PAGE_CSS}</style>
</head>
<body>
  <div class="wrap">
    <nav style="margin-bottom:24px;font-size:13px;"><a href="./index.html">← All email artefacts</a></nav>
    <h1>${title}</h1>
    <p class="lede">${subtitle}</p>
    ${body}
  </div>
  <script>
    // srcdoc frames are same-origin, so the page can size each one to its email
    // and the reviewer sees the whole message instead of a scrollable window.
    // A pair renders at the taller of the two, so light and dark stay comparable.
    function fit() {
      for (const row of document.querySelectorAll(".cols")) {
        const frames = [...row.querySelectorAll("iframe")];
        for (const f of frames) f.style.height = "0px";
        const h = Math.max(...frames.map((f) => f.contentDocument.body.scrollHeight));
        for (const f of frames) f.style.height = h + 24 + "px";
      }
    }
    addEventListener("load", fit);
    addEventListener("resize", fit);
  </script>
</body>
</html>`;
}

function sideBySide(html: string): string {
  return `<div class="cols">
    <div><div class="mode">Light — what every client renders by default</div>
      <iframe title="light" srcdoc="${attr(html)}"></iframe></div>
    <div><div class="mode">Dark — prefers-color-scheme override, forced on</div>
      <iframe title="dark" srcdoc="${attr(forceDark(html))}"></iframe></div>
  </div>`;
}

// --- sample data ---------------------------------------------------------------
// Realistic, not lorem: a plausible week for a Postgres-adjacent SaaS, with one
// signal in each urgency band, a trend and a watched question.
const WEEKLY = renderDigestEmail(
  {
    temperature: "high",
    tldr: [
      "Linear moved its Business tier to usage-based pricing and bundled AI credits.",
      "Notion opened six enterprise AE roles across London and Berlin.",
      "Height shipped a comparison page naming you first.",
    ],
    sections: [
      {
        urgency: "action_required",
        competitor: "Linear",
        category: "pricing",
        insight:
          "Business tier moved from $16 to $20 per seat, with 500 AI credits bundled at no extra cost.",
        so_what:
          "Your $18 tier is no longer the mid-market anchor. Decide before the Q3 renewal cohort opens.",
      },
      {
        urgency: "action_required",
        competitor: "Supabase",
        category: "funding",
        insight: "Announced a $500M Series F led by Accel, at a $6.5B valuation.",
        so_what:
          "The raise funds an AI backend push aimed at the same developers you sell to.",
      },
      {
        urgency: "watch",
        competitor: "Notion",
        category: "hiring",
        insight: "Six enterprise AE openings across London and Berlin, all posted this week.",
        so_what: "An EMEA enterprise push is starting, one to two quarters out.",
      },
      {
        urgency: "watch",
        competitor: "Citus Data",
        category: "security_compliance",
        insight: "Published SOC 2 Type II and a data-residency page for the EU region.",
        so_what: "Removes the compliance objection you have been winning on in regulated deals.",
      },
      {
        urgency: "fyi",
        competitor: "Height",
        category: "content",
        insight: "Published a comparison page targeting three competitors, naming you first.",
        so_what: "",
      },
    ],
    sectoralTrends: [
      {
        title: "AI credits are becoming a pricing axis",
        insight:
          "Three tracked competitors now meter AI usage separately from seats, rather than folding it into the tier.",
      },
      {
        title: "Data residency moved from enterprise to mid-market",
        insight: "Two vendors now advertise EU-only storage on their self-serve plans.",
      },
    ],
    watchedQuestions: [
      {
        question: "Who undercuts us on the entry tier?",
        changeSummary:
          "Linear left the bracket when it repriced. Height is now the only tracked vendor below you.",
      },
    ],
  },
  "2026-07-13",
  "2026-07-20",
  { useful: "#useful", notUseful: "#not-useful" },
  "#unsubscribe",
  undefined,
  "#open-the-briefing",
);

const ALL_QUIET = renderAllQuietDigest({
  pages: 42,
  checks: 310,
  weekStart: "2026-07-13",
  weekEnd: "2026-07-20",
  unsubscribeUrl: "#unsubscribe",
  readUrl: "#what-we-checked",
});

const WELCOME = renderWelcomeEmail({
  competitorNames: ["Linear", "Notion", "Height", "Shortcut", "Supabase", "Citus Data"],
  dashboardUrl: "#dashboard",
  unsubscribeUrl: "#unsubscribe",
}).html;

const CELEBRATION = renderCelebrationEmail({
  competitorName: "Linear",
  category: "pricing",
  insight: "Business tier moved from $16 to $20 per seat, with AI credits bundled.",
  soWhat: "Your $18 tier is no longer the mid-market anchor.",
  signalUrl: "#signal",
  unsubscribeUrl: "#unsubscribe",
}).html;

const RECAP = renderMonthlyRecapEmail({
  monthLabel: "June 2026",
  totalMoves: 37,
  competitorsTracked: 9,
  busiestName: "Linear",
  biggestInsight: "Linear bundled AI credits into its Business tier.",
  recapUrl: "#recap",
  unsubscribeUrl: "#unsubscribe",
}).html;

// --- the design-system artefact -------------------------------------------------
// The worker-side templates (alert, daily briefing, silent monitor, watched
// question, structural change) are assembled from these primitives against a live
// database, so they cannot be rendered here without duplicating their markup.
// Reviewing the primitives is what covers them.
function paletteRows(): string {
  const rows: Array<[string, keyof typeof EMAIL_LIGHT, string]> = [
    ["Canvas", "canvas", "--background"],
    ["Surface", "surface", "--surface"],
    ["Surface alt", "surfaceAlt", "--surface-2"],
    ["Border", "border", "--border"],
    ["Text", "text", "--foreground"],
    ["Muted", "muted", "--muted"],
    ["Faint", "faint", "--muted-3"],
    ["Accent", "accent", "--accent"],
    ["Critical", "sevCritical", "--critical"],
    ["High", "sevHigh", "--high"],
    ["Medium", "sevMedium", "--medium"],
    ["Low", "sevLow", "--low"],
    ["Positive", "sevPositive", "--positive"],
  ];
  return rows
    .map(([label, key, token]) => {
      const l = EMAIL_LIGHT[key];
      const d = EMAIL_DARK[key];
      const isFill = key === "accent"; // measured as the label ON it, not as text
      const isInk = !["canvas", "surface", "surfaceAlt", "border"].includes(key);
      const lr = isFill
        ? ratio(EMAIL_LIGHT.onAccent, l)
        : isInk
          ? ratio(l, EMAIL_LIGHT.canvas)
          : "";
      const dr = isFill
        ? ratio(EMAIL_DARK.onAccent, d)
        : isInk
          ? ratio(d, EMAIL_DARK.canvas)
          : "";
      const cell = (r: string) =>
        r === ""
          ? "—"
          : `<span class="${Number(r) >= 4.5 ? "pass" : "warn"}">${r}:1</span>`;
      return `<tr>
        <td>${label}</td>
        <td><span class="sw" style="background:${l}"></span><code>${l}</code></td>
        <td>${cell(lr)}</td>
        <td><span class="sw" style="background:${d}"></span><code>${d}</code></td>
        <td>${cell(dr)}</td>
        <td><code>${token}</code></td>
      </tr>`;
    })
    .join("");
}

const TYPE_ROWS: Array<[Parameters<typeof t>[0], string]> = [
  ["display", "The week's verdict — the one line that has to land in the preview pane"],
  ["title", "Single-subject email heading"],
  ["heading", "Section head"],
  ["lead", "The primary read: insight, so-what, AI prose"],
  ["body", "Prose floor — descriptions, supporting points"],
  ["dense", "Secondary meta line"],
  ["meta", "Label floor — eyebrows, footer"],
  ["stat", "A figure the product measured (sans, tabular)"],
];

const SYSTEM_BODY = `
<h2>Palette</h2>
<p class="lede">Taken from <code>apps/web/src/app/globals.css</code> and gamut-mapped to sRGB, because
email has no <code>oklch()</code>. Ratios are text on that mode's canvas, except the accent, which is the white label on the fill.</p>
<table>
  <tr><th>Role</th><th>Light</th><th>Contrast</th><th>Dark</th><th>Contrast</th><th>Web token</th></tr>
  ${paletteRows()}
</table>

<h2>Type scale</h2>
<p class="lede">Rendered by <code>t()</code>, so this table is the real output. Prose floors at 14px and
the primary read sits at 15px, per DESIGN.md §3.</p>
<div class="demo">
  ${TYPE_ROWS.map(
    ([role, use]) => `<div style="padding:12px 0;border-bottom:1px solid ${EMAIL_LIGHT.border};">
      <div ${e("text", t(role))}>${role === "stat" ? "37" : "Linear repriced its Business tier"}</div>
      <div ${e("faint", t("meta", "letter-spacing:normal;margin-top:6px;"))}><code>t("${role}")</code> — ${use}</div>
    </div>`,
  ).join("")}
</div>

<h2>Severity marks</h2>
<p class="lede">A band is never hue alone: the swatch carries it too, so a client that strips colour
still separates the groups (DESIGN.md §2).</p>
<div class="demo">
  ${(["critical", "high", "medium", "low", "positive"] as const)
    .map(
      (s) =>
        `<div style="padding:7px 0;">${severityDot(s)}<span ${e(s === "positive" ? "positive" : s, t("body", "vertical-align:middle;"))}>${s}</span></div>`,
    )
    .join("")}
</div>

<h2>Section head</h2>
<div class="demo">
  ${emailSectionHead("Needs an answer (2)", "critical", "critical")}
  ${emailSectionHead("Sector trends", "text")}
</div>

<h2>Button</h2>
<p class="lede">A padded table cell, not a padded anchor: Outlook's Word engine drops padding on an
inline <code>&lt;a&gt;</code> and the button collapses to a bare link.</p>
<div class="demo">${emailButton("#", "Open the full briefing")}</div>
`;

// --- write ----------------------------------------------------------------------
const FILES: Array<{ file: string; title: string; subtitle: string; body: string }> = [
  {
    file: "00-design-system.html",
    title: "Design system",
    subtitle:
      "The primitives every email is assembled from. The worker-side templates (alert, daily briefing, silent monitor, watched question, structural change) are built from these against a live database, so reviewing them here is what covers those.",
    body: SYSTEM_BODY,
  },
  {
    file: "01-weekly-digest.html",
    title: "Weekly digest",
    subtitle:
      "The flagship. Verdict first, then the week's shape as one line, then urgency groups as boxless hairline-separated rows — not three identical stacks of cards.",
    body: sideBySide(WEEKLY),
  },
  {
    file: "02-all-quiet-digest.html",
    title: "All-quiet digest",
    subtitle:
      "A calm week still gets a briefing. One statement, so it keeps a card where the weekly digest goes boxless.",
    body: sideBySide(ALL_QUIET),
  },
  {
    file: "03-welcome.html",
    title: "Welcome (D0)",
    subtitle: "Sent once, the day monitoring starts.",
    body: sideBySide(WELCOME),
  },
  {
    file: "04-first-change.html",
    title: "First-change celebration",
    subtitle: "The first live change we catch. One object, so it keeps its card.",
    body: sideBySide(CELEBRATION),
  },
  {
    file: "05-monthly-recap.html",
    title: "Monthly recap teaser",
    subtitle:
      "The hook into the in-app recap. Figures are sans with tabular-nums, never mono (DESIGN.md §3).",
    body: sideBySide(RECAP),
  },
];

const INDEX = page(
  "Outrival email design",
  `<h2>Artefacts</h2>
   <ul class="files">
     ${FILES.map(
       (f) =>
         `<li><a href="./${f.file}"><strong>${f.title}</strong></a><br /><span style="color:var(--sub)">${f.subtitle}</span></li>`,
     ).join("")}
   </ul>
   <h2>How these are made</h2>
   <p class="lede">Generated by <code>pnpm --filter @outrival/shared email:preview</code> from the same
   renderers the workers and the API call, so an artefact cannot drift from what lands in an inbox.
   The rationale is in <code>docs/email-design.md</code>; the live version is <code>/dev/preview-emails</code>.</p>`,
  "Design artefacts for the transactional emails. Each page shows one template in light and dark, side by side, with realistic sample data.",
).replace('<nav style="margin-bottom:24px;font-size:13px;"><a href="./index.html">← All email artefacts</a></nav>', "");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}index.html`, INDEX);
for (const f of FILES) {
  writeFileSync(`${OUT_DIR}${f.file}`, page(f.title, f.body, f.subtitle));
}
console.log(`Wrote ${FILES.length + 1} artefacts to docs/design/emails/`);
