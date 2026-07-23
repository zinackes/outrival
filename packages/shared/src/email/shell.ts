import { darkRules, e, EMAIL_LIGHT } from "./theme";

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
export function emailShell(inner: string, maxWidthPx = 520): string {
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
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_LIGHT.canvas}" ${e("bg")}>
    <tr>
      <td align="center" style="padding:32px 24px;">
        <table role="presentation" width="${maxWidthPx}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${maxWidthPx}px;">
          <tr>
            <td ${e("text", "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;text-align:left;")}>
              <div style="margin-bottom:28px;">
                <a href="https://outrival.app" style="text-decoration:none;">
                  <img class="e-logo-l" src="https://outrival.app/logo-dark.png" width="24" height="24" alt="" style="vertical-align:middle;border:0;outline:none;" />
                  <span class="e-logo-d" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
                    <img src="https://outrival.app/logo-light.png" width="24" height="24" alt="" style="vertical-align:middle;border:0;outline:none;" />
                  </span>
                  <span ${e("text", "font-size:18px;font-weight:600;letter-spacing:-0.01em;vertical-align:middle;padding-left:8px;")}>Outrival</span>
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
