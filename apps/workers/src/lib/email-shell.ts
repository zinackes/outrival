// Bulletproof dark shell for transactional emails. Many webmail clients (Gmail,
// temp-mail viewers, …) drop a `background` set on <body> and render the message on
// a white canvas — which turned our light text invisible (white-on-white). A
// full-width table with the `bgcolor` attribute (honored far more reliably than CSS
// background) carries the dark surface; the color-scheme meta keeps supporting
// clients from inverting colors in light mode. All worker emails share this shell.
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
