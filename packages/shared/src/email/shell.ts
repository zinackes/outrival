// Bulletproof dark shell for transactional emails. Many webmail clients (Gmail,
// temp-mail viewers, …) drop a `background` set on <body> and render the message on
// a white canvas — which turned our light text invisible (white-on-white). A
// full-width table with the `bgcolor` attribute (honored far more reliably than CSS
// background) carries the dark surface; the color-scheme meta keeps supporting
// clients from inverting colors in light mode. All worker + API emails share this shell.
export function darkEmailShell(inner: string, maxWidthPx = 520): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a" style="background-color:#0a0a0a;">
    <tr>
      <td align="center" style="padding:24px;">
        <table role="presentation" width="${maxWidthPx}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${maxWidthPx}px;">
          <tr>
            <td style="color:#fafafa;font-family:Inter,sans-serif;text-align:left;">
              <div style="margin-bottom:28px;">
                <a href="https://outrival.app" style="text-decoration:none;">
                  <img src="https://outrival.app/logo-light.png" width="24" height="24" alt="" style="vertical-align:middle;border:0;outline:none;" />
                  <span style="font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#fafafa;vertical-align:middle;padding-left:8px;">Outrival</span>
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
