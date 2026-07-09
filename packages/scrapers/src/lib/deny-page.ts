// Pure HTML heuristics for recognising a "deny page" — a page that responded 200
// but is NOT the real content: a client-rendered soft-404, an access-denied/geo-block
// page, a login wall, or a worded verification interstitial not covered by the vendor
// challenge markers in block-detection.ts. These slip past both the L0 status-code
// checks (200 OK) and the vendor-string challenge detector (no CHALLENGE_MARKERS
// hit), so they get stored as successful snapshots and later diffed as if they were
// real content — the exact failure mode the 2026-07-09 pipeline audit found in prod
// (TargetRecruit, Codebenders, Lane, MTGStocks, HebergHub).
//
// Browser-free (no Patchright import) — same reasoning as block-detection.ts: cheap
// enough to run on every L0/browser-tier success AND on archived Wayback HTML.
//
// The `< 3000 visible chars` gate is load-bearing and applies to EVERY branch: real
// content pages run long; deny pages are short (though above the existing 500-char L0
// "needs_render" floor). A long article that merely mentions "sign in", "404", or "one
// moment, please" in passing — or a marketing page that ships a hidden login modal /
// inline `<input type="password">` — must not trip this. Only a genuinely short page
// carrying deny copy does.
//
// Why no signal is ever un-gated here (unlike diagnose-failure.ts's ungated password
// check): this runs on the SUCCESS path. A false positive doesn't merely mislabel an
// already-failed scrape — it grades a HEALTHY capture `partial`, so the pipeline skips
// its diff AND its extraction on every scrape of that monitor, silencing that
// competitor's diffs/signals/pricing/jobs forever (visible only in a logger.warn).
// That asymmetric cost is why the length gate is mandatory on all four kinds.

export type DenyPageKind = "soft_404" | "access_denied" | "login_wall" | "verification_wall";

const VISIBLE_TEXT_LIMIT = 3000;

// Our own scrapers synthesize an HTML document out of ALREADY-parsed structured data
// (a sitemap URL list, a Reddit/News mention feed, a changelog RSS feed, an ATS job
// island, aggregated pricing product-lines). detectDenyPage must never run on those:
// a synthesized doc listing `/404` or `/sign-in`, or quoting deny copy from a feed
// item, is legitimate CONTENT — grading it a deny page would silence the monitor
// forever. Each such doc carries a `data-outrival-<kind>` section marker; this matches
// them so the caller can skip the copy heuristic.
//
// `billing` is deliberately ABSENT from the alternation: `data-outrival-billing`
// (scrape-patchright.ts) marks the pricing-toggle block APPENDED to a REAL fetched
// page, not a synthesized document — that capture is a genuine page and must stay
// deny-checked.
const SYNTHETIC_DOC_MARKER_RE = /<section\s+data-outrival-(sitemap|news|reddit|changelog|ats|line)\b/i;

export function isSyntheticDocument(html: string): boolean {
  return SYNTHETIC_DOC_MARKER_RE.test(html);
}

const TITLE_RE = /<title>([^<]*)<\/title>/i;
const TITLE_404_RE = /\b(404|not found|page (not|introuvable)|doesn.t exist)\b/i;
const BODY_404_RE =
  /\b(404|page not found|page you requested (does not|doesn.t) exist|this page (isn.t|is not) available)\b/i;
const ACCESS_DENIED_RE =
  /\b(access denied|not available in your (region|country)|geographic(al)? restriction|forbidden|request blocked|unusual traffic)\b/i;
const PASSWORD_INPUT_RE = /<input[^>]*type=["']password["']/i;
const SIGNIN_RE = /\b(sign in|log in|sign-in|log-in)\b/i;
const SIGNIN_CONTEXT_RE = /\b(continue with|email address|password)\b/i;
const VERIFICATION_RE =
  /\b(verify(ing)? (you are|that you.re) (a )?human|one moment, please|request is being verified|robot challenge)\b/i;

function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectDenyPage(html: string): DenyPageKind | null {
  const text = visibleText(html);
  const short = text.length < VISIBLE_TEXT_LIMIT;
  const titleContent = html.match(TITLE_RE)?.[1] ?? "";

  if (short && (TITLE_404_RE.test(titleContent) || BODY_404_RE.test(text.slice(0, 3000)))) {
    return "soft_404";
  }
  if (short && ACCESS_DENIED_RE.test(text.slice(0, 8000))) {
    return "access_denied";
  }
  if (
    short &&
    (PASSWORD_INPUT_RE.test(html) ||
      (SIGNIN_RE.test(text.slice(0, 5000)) && SIGNIN_CONTEXT_RE.test(text.slice(0, 5000))))
  ) {
    return "login_wall";
  }
  if (short && VERIFICATION_RE.test(text.slice(0, 3000))) {
    return "verification_wall";
  }
  return null;
}
