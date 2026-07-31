/**
 * Local calculator pages the probe is driven against for real (Playwright, a live
 * browser, a live HTTP server). Fixtures rather than a recorded DOM because the
 * thing under test IS the interaction: setting a React-style controlled input,
 * waiting for a debounce, reading a number that a script wrote.
 *
 * Each page is a shape the probe has to survive, not a specific vendor:
 *   slider        the common case — a range input and a JS-computed total
 *   endpoint      the total arrives from an XHR (strategy A)
 *   descending    the total FALLS as the volume rises (an impossible price list)
 *   unknownUnit   a control we cannot name a meter for
 *   consent       a banner over the page, dismissed by its own visible button
 *   flaky         answers differently the second time the same volume is asked
 */

const SHELL = (body: string, script: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pricing</title></head>
<body style="font-family:sans-serif">
${body}
<script>${script}</script>
</body></html>`;

const CALC_BODY = (label: string) => `
<section class="calc">
  <h1>Pricing</h1>
  <p>Plans start at <span class="from">$25</span>.</p>
  <label for="qty">${label}</label>
  <input id="qty" type="range" min="1000" max="1000000" step="1000" value="1000" />
  <p class="line">Estimated monthly cost <span id="total">$25.00</span></p>
</section>`;

const usd = (n: number) => `$${n.toFixed(2)}`;

/** rate card: $25 monthly minimum, then $0.002 per request. */
export const SLIDER_PAGE = SHELL(
  CALC_BODY("API requests per month"),
  `
  const qty = document.getElementById('qty');
  const total = document.getElementById('total');
  const price = (n) => Math.max(25, n * 0.002);
  const render = () => {
    // A debounce, like every real calculator: the probe has to wait it out.
    setTimeout(() => {
      total.textContent = '$' + price(Number(qty.value)).toFixed(2);
    }, 120);
  };
  qty.addEventListener('input', render);
  render();
`,
);

/** Same rate card, computed server-side and painted from the JSON response. */
export const ENDPOINT_PAGE = SHELL(
  CALC_BODY("API requests per month"),
  `
  const qty = document.getElementById('qty');
  const total = document.getElementById('total');
  const render = async () => {
    const res = await fetch('/api/estimate?qty=' + qty.value);
    const body = await res.json();
    total.textContent = '$' + body.data.estimate.monthlyTotal.toFixed(2);
  };
  qty.addEventListener('input', render);
  render();
`,
);

/** A price that falls as the volume rises — impossible, so the run is dropped. */
export const DESCENDING_PAGE = SHELL(
  CALC_BODY("API requests per month"),
  `
  const qty = document.getElementById('qty');
  const total = document.getElementById('total');
  const render = () => {
    const n = Number(qty.value);
    total.textContent = '$' + Math.max(5, 1000 - n / 1000).toFixed(2);
  };
  qty.addEventListener('input', render);
  render();
`,
);

/** A quantity control whose unit no catalog entry claims. */
export const UNKNOWN_UNIT_PAGE = SHELL(
  CALC_BODY("Widgets of doom per month"),
  `
  const qty = document.getElementById('qty');
  const total = document.getElementById('total');
  qty.addEventListener('input', () => {
    total.textContent = '$' + Math.max(25, Number(qty.value) * 0.002).toFixed(2);
  });
`,
);

/** The calculator behind a consent overlay that swallows every click. */
export const CONSENT_PAGE = SHELL(
  `
<div id="consent" style="position:fixed;inset:0;background:#111;color:#fff;z-index:9;padding:2rem">
  <p>We use cookies.</p>
  <button id="accept" type="button">Accept all</button>
  <button id="reject" type="button">Manage preferences</button>
</div>
${CALC_BODY("API requests per month")}`,
  `
  const qty = document.getElementById('qty');
  const total = document.getElementById('total');
  document.getElementById('accept').addEventListener('click', () => {
    document.getElementById('consent').remove();
  });
  qty.addEventListener('input', () => {
    // The overlay is a real barrier: nothing recomputes while it is up.
    if (document.getElementById('consent')) return;
    total.textContent = '$' + Math.max(25, Number(qty.value) * 0.002).toFixed(2);
  });
`,
);

/** Answers one price the first time a volume is asked, another on the way back. */
export const FLAKY_PAGE = SHELL(
  CALC_BODY("API requests per month"),
  `
  const qty = document.getElementById('qty');
  const total = document.getElementById('total');
  const seen = {};
  qty.addEventListener('input', () => {
    const n = Number(qty.value);
    seen[n] = (seen[n] || 0) + 1;
    const base = Math.max(25, n * 0.002);
    total.textContent = '$' + (seen[n] > 1 ? base * 1.9 : base).toFixed(2);
  });
`,
);

/**
 * Same server-computed calculator, but the endpoint only answers requests that
 * carry a Referer — the referer/CSRF check a real pricing API often has. The page
 * itself works; a replay taken outside the page does not, which is precisely the
 * case the confirmation step exists to catch.
 */
export const GUARDED_ENDPOINT_PAGE = SHELL(
  CALC_BODY("API requests per month"),
  `
  const qty = document.getElementById('qty');
  const total = document.getElementById('total');
  const render = async () => {
    const res = await fetch('/api/estimate-guarded?qty=' + qty.value);
    if (!res.ok) return;
    const body = await res.json();
    total.textContent = '$' + body.data.estimate.monthlyTotal.toFixed(2);
  };
  qty.addEventListener('input', render);
  render();
`,
);

/** The estimate endpoint ENDPOINT_PAGE reads, mounted by the test server. */
export function estimateResponse(qty: number): string {
  return JSON.stringify({
    quantity: qty,
    rate: 0.002,
    data: { estimate: { monthlyTotal: Math.max(25, qty * 0.002), annualTotal: qty * 0.024 } },
  });
}

export { usd };
