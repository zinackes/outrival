import { darkRules, e, t, EMAIL_LIGHT, type EmailRole } from "./theme";
import { escapeHtml } from "./escape-html";

// The single shell for every user-facing email (workers + API auth). Light is
// authored inline, dark is an override — see theme.ts for why that direction.
//
// Two client quirks are structural here and must not be "cleaned up":
//   1. Many webmail clients drop a `background` set on <body> and render the
//      message on their own canvas, so a full-width table with the `bgcolor`
//      ATTRIBUTE carries the surface (honored far more reliably than CSS).
//      A CSS rule still overrides it in dark mode — presentational attributes
//      lose to any stylesheet declaration.
//   2. `color-scheme: light dark` tells Apple Mail / Outlook.com that this email
//      handles both itself, which is what stops THEIR auto-inversion. Declaring
//      only "dark" (what we shipped before) forfeited the light rendering AND
//      still got inverted by the Gmail apps, which read no meta tag at all.

// Geist is the product's face but a webfont is unreachable in most clients, so
// the stack names it first (Apple Mail and the desktop Outlooks will use it when
// installed) and degrades to the same neutral grotesques.
const FONT_STACK =
  "font-family:'Geist Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";

// The inbox preview line. Without one, every client previews whatever text comes
// first — for the digest that was the date range, not the week's verdict. Hidden
// in the body, then padded with zero-width joiners so the client cannot pull the
// following content in after it.
function preheaderHtml(text: string): string {
  const pad = "&#847;&zwnj;&nbsp;".repeat(60);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(text)}${pad}</div>`;
}

export function emailShell(inner: string, maxWidthPx = 520, preheader?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media (prefers-color-scheme: dark) { ${darkRules()} }
    ${darkRules("[data-ogsc] ")}
    ${darkRules("[data-ogsb] ")}
  </style>
</head>
<body class="e-bg" style="margin:0;padding:0;background-color:${EMAIL_LIGHT.canvas};">
  ${preheader ? preheaderHtml(preheader) : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_LIGHT.canvas}" ${e("bg")}>
    <tr>
      <td align="center" style="padding:32px 24px;">
        <table role="presentation" width="${maxWidthPx}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${maxWidthPx}px;">
          <tr>
            <td ${e("text", `${FONT_STACK}text-align:left;`)}>
              <div ${e("rule", "margin-bottom:24px;padding-bottom:16px;border-bottom-width:1px;border-bottom-style:solid;")}>
                <a href="https://outrival.app" style="text-decoration:none;">
                  <img class="e-logo-l" src="https://outrival.app/logo-dark.png" width="24" height="24" alt="" style="vertical-align:middle;border:0;outline:none;" />
                  <span class="e-logo-d" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
                    <img src="https://outrival.app/logo-light.png" width="24" height="24" alt="" style="vertical-align:middle;border:0;outline:none;" />
                  </span>
                  <span ${e("text", "font-size:17px;font-weight:600;letter-spacing:-0.015em;vertical-align:middle;padding-left:8px;")}>Outrival</span>
                </a>
              </div>
              ${inner}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// The CTA is an accent fill in both modes. It used to be a white pill (readable
// only because the canvas was always dark) — on a light canvas that is a white
// button on white.
//
// Rendered as a padded table cell rather than a padded anchor: Outlook's Word
// engine ignores padding on an inline <a> (the button collapses to a bare link)
// but honors cell padding. No VML roundrect — `v:roundrect` needs a fixed width
// and these labels are variable-length, so a wrong guess clips the label.
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
  <tr>
    <td align="center" ${e("btn", "border-radius:6px;padding:11px 20px;")}>
      <a href="${escapeHtml(href)}" ${e("btn", "background-color:transparent;text-decoration:none;font-weight:600;font-size:14px;line-height:1.2;display:inline-block;")}>${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

// Severity as a mark, not only a hue: an 8px swatch beside its label so the band
// survives a client that strips color, and so the three groups read apart at a
// glance instead of by parsing the heading (DESIGN.md §2, the Three-Systems Rule).
export type EmailSeverity = "critical" | "high" | "medium" | "low" | "positive";

const DOT_ROLE: Record<EmailSeverity, EmailRole> = {
  critical: "dotCritical",
  high: "dotHigh",
  medium: "dotMedium",
  low: "dotLow",
  positive: "dotPositive",
};

export function severityDot(severity: EmailSeverity): string {
  // A bordered empty span, not a glyph: no emoji-as-UI (DESIGN.md §1) and no
  // font dependency. `line-height:0` keeps it optically centered on the label.
  return `<span ${e(DOT_ROLE[severity], "display:inline-block;width:8px;height:8px;border-radius:2px;vertical-align:middle;margin-right:8px;")}></span>`;
}

// A section head: dot + label, over a hairline. The boxless alternative to
// wrapping every group in its own card (DESIGN.md §5 — depth from rhythm).
export function emailSectionHead(
  label: string,
  role: EmailRole,
  severity?: EmailSeverity,
): string {
  return `<div ${e("rule", "padding-bottom:8px;margin-bottom:14px;border-bottom-width:1px;border-bottom-style:solid;")}>
    ${severity ? severityDot(severity) : ""}<span ${e(role, t("heading", "vertical-align:middle;"))}>${escapeHtml(label)}</span>
  </div>`;
}
