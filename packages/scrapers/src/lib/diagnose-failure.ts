/**
 * Fine-grained scrape-failure diagnosis (patch-23).
 *
 * Patch-20's cascade tells us *that* a scrape failed and surfaces a coarse
 * `failureReason` (anti-bot vs network). This turns the cascade outcome into a
 * *category* with an evidence trail and a suggested next move, so the product can
 * propose alternatives instead of a flat "unscrapable" (see alternatives/generate).
 *
 * PURE and self-contained: it takes a normalized view of the cascade attempts
 * (so it doesn't import the cascade types and can be unit-tested in isolation)
 * and returns a verdict. No DB, no network — the caller persists the result.
 * Must stay cheap (< ~100 ms): only string heuristics over the last attempt's
 * HTML, no parsing.
 */

export type FailureCategory =
  | "anti_bot" // 403/503/Cloudflare challenge — already handled by the patch-20 cascade
  | "site_dead" // 404/410, DNS/SSL/network error
  | "site_redirected" // 30x to a completely different domain
  | "login_required" // a login/auth wall is the only thing rendered
  | "spa_empty" // 200 but almost no visible text (pure SPA loading via API)
  | "geo_blocked" // content indicates a geographic restriction
  | "unknown"; // no clear pattern

export type DiagnosisConfidence = "high" | "medium" | "low";

export type SuggestedAction =
  | "propose_alternative" // surface user-facing alternatives (different URL / manual / pause)
  | "detect_pivot" // could be temporary or a real death/acquisition → structural detection
  | "capture_api" // try runtime XHR/fetch capture for a pure SPA
  | "mark_unscrapable"; // no automated recovery — the site refused us / ops investigates

export interface FailureDiagnosis {
  category: FailureCategory;
  confidence: DiagnosisConfidence;
  evidence: string[];
  suggestedAction: SuggestedAction;
}

/** Normalized view of one cascade attempt's result — what the diagnosis reads. */
export interface AttemptInfo {
  ok?: boolean;
  statusCode?: number;
  failureReason?: string;
  finalUrl?: string;
  html?: string;
  text?: string;
}

/**
 * Diagnose why a scrape failed from the cascade's attempts and the monitored URL.
 * Attempts are ordered cheapest-first (L0 → L4); the last one is the most
 * escalated. Falls back to "unknown" → mark unscrapable when nothing matches.
 */
export function diagnoseFailure(
  attempts: AttemptInfo[],
  originalUrl: string,
): FailureDiagnosis {
  const last = attempts[attempts.length - 1];
  // A 404/410 can show up on any attempt (L0 surfaces it as a statusCode even
  // when it then escalates on "too little content"), so scan all of them.
  const deadStatus = attempts.find(
    (a) => a.statusCode === 404 || a.statusCode === 410,
  )?.statusCode;

  // 1. Dead site — explicit gone status, or a DNS/SSL/network error.
  if (deadStatus) {
    return {
      category: "site_dead",
      confidence: "high",
      evidence: [`HTTP ${deadStatus} returned`],
      suggestedAction: "detect_pivot", // could be temporary; confirm with structural detection
    };
  }
  if (last?.failureReason === "network_error") {
    return {
      category: "site_dead",
      confidence: "medium",
      evidence: ["Network error", "Possible DNS or SSL issue"],
      suggestedAction: "detect_pivot",
    };
  }

  // 2. Redirected to a different root domain (acquisition / domain change).
  const finalUrl = [...attempts].reverse().find((a) => a.finalUrl)?.finalUrl;
  if (finalUrl && isOffsiteRedirect(originalUrl, finalUrl)) {
    return {
      category: "site_redirected",
      confidence: "high",
      evidence: [`Redirected from ${safeHostname(originalUrl)} to ${safeHostname(finalUrl)}`],
      suggestedAction: "detect_pivot",
    };
  }

  // 3. Login wall — a rendered page that is essentially an auth form.
  const html = lastHtml(attempts);
  if (html && detectsLoginPage(html)) {
    return {
      category: "login_required",
      confidence: "high",
      evidence: ["Login form detected", "Limited content visible"],
      suggestedAction: "propose_alternative",
    };
  }

  // 4. Pure SPA — the L0 "needs a browser, almost no text" signal that never
  // resolved into real content through the cascade.
  if (last?.failureReason === "needs_render") {
    const len = textLength(last);
    return {
      category: "spa_empty",
      confidence: "medium",
      evidence: [
        len != null ? `Only ${len} chars of visible text` : "Almost no visible text",
        "Likely a SPA loading content via an API",
      ],
      suggestedAction: "capture_api",
    };
  }

  // 5. Geo-blocking — best-effort copy detection.
  if (html && detectsGeoBlock(html)) {
    return {
      category: "geo_blocked",
      confidence: "medium",
      evidence: ["Content suggests a geographic restriction"],
      suggestedAction: "propose_alternative",
    };
  }

  // 6. Anti-bot — the site refused us (block / challenge). The collection doctrine
  // does NOT bypass a refusal: there is no heavier tier to retry. (Refusals are
  // normally handled up front in scrape-monitor and never reach here; this branch
  // covers a block surfaced via a raw error message.)
  if (
    last?.failureReason === "cloudflare_challenge" ||
    last?.failureReason === "blocked_403" ||
    last?.failureReason === "blocked_503" ||
    last?.failureReason === "soft_block"
  ) {
    return {
      category: "anti_bot",
      confidence: "high",
      evidence: [`Failure reason: ${last.failureReason}`, "Blocked — no bypass"],
      suggestedAction: "mark_unscrapable",
    };
  }

  return {
    category: "unknown",
    confidence: "low",
    evidence: last?.failureReason ? [`Failure reason: ${last.failureReason}`] : ["No clear failure pattern"],
    suggestedAction: "mark_unscrapable",
  };
}

function lastHtml(attempts: AttemptInfo[]): string | undefined {
  return [...attempts].reverse().find((a) => a.html)?.html;
}

function textLength(a: AttemptInfo): number | null {
  if (typeof a.text === "string") return a.text.length;
  return null;
}

/**
 * True when `finalUrl` landed on a genuinely different registrable domain than
 * `originalUrl` — a parked page, an acquisition/domain-change redirect, or a
 * hijacked link, not the site we asked for. Conservative by construction: a
 * locale path, a subdomain (blog.x → x), and a www toggle all share the root and
 * return false. Unparseable input returns false — never grade a capture on a URL
 * we can't read. Shared with the SUCCESS-path completeness grader (R6) so both
 * paths judge "wrong target" identically.
 */
export function isOffsiteRedirect(originalUrl: string, finalUrl: string): boolean {
  const from = safeHostname(originalUrl);
  const to = safeHostname(finalUrl);
  if (!from || !to) return false;
  return from !== to && !sameRootDomain(from, to);
}

/**
 * Why the URL we landed on is not the URL we asked for (R6). Runs on the SUCCESS
 * path: a 200 that followed a redirect somewhere else is the audit's T5 hole —
 * the pipeline stores it "as the page" and every diff, price and posting derived
 * from it is attributed to a URL that did not serve it.
 *
 *   "offsite"     — a different registrable domain (parked, acquired, hijacked).
 *   "root_bounce" — same site, but a path with segments landed on the bare root:
 *                   the page we monitor is gone and the site bounced us home.
 *   null          — the same page, however it is spelled.
 *
 * Deliberately NOT flagged, though both are "a different path":
 *   - a locale prefix (/pricing → /fr/pricing) is the SAME page, localised. The
 *     region it was served for is recorded on the snapshot instead; grading it
 *     partial would silence every monitor whose site geo-redirects, i.e. most.
 *   - a renamed or moved section (/pricing → /plans). It reads like a mismatch,
 *     but the monitor URL never changes, so the verdict would stick forever and
 *     silence the source permanently. URL discovery re-finds those; a partial
 *     capture is the wrong tool for a stale URL.
 *
 * The root bounce is kept because it is unambiguous, self-clearing (the next
 * complete capture of a restored page grades complete), and is exactly the shape
 * that makes a pricing or jobs source read "unknown" forever with no error
 * anywhere.
 */
export type RedirectMismatch = "offsite" | "root_bounce";

export function classifyRedirect(
  intendedUrl: string,
  finalUrl: string,
): RedirectMismatch | null {
  if (isOffsiteRedirect(intendedUrl, finalUrl)) return "offsite";
  const intended = safeSegments(intendedUrl);
  const final = safeSegments(finalUrl);
  if (intended === null || final === null) return null;
  if (intended.length > 0 && final.length === 0) return "root_bounce";
  return null;
}

/** `fr`, `en-US`, `pt-br` — a language segment, not a page. */
const LOCALE_SEGMENT_RE = /^[a-z]{2}([-_][a-z]{2})?$/i;

/** Path segments with a leading locale dropped. null when the URL is unreadable. */
function safeSegments(url: string): string[] | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  return first !== undefined && LOCALE_SEGMENT_RE.test(first) ? segments.slice(1) : segments;
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Login detection: a password input, or sign-in copy concentrated in the early
// markup. Scoped to the first 5 KB so a "Log in" link in a footer of a real page
// doesn't trip it.
function detectsLoginPage(html: string): boolean {
  if (/<input[^>]*type=["']password["']/i.test(html)) return true;
  const head = html.slice(0, 5000);
  return /\b(sign in|log in|sign-in|log-in)\b/i.test(head) &&
    /\b(continue with|email address|password)\b/i.test(head);
}

function detectsGeoBlock(html: string): boolean {
  return /\b(not available in your (region|country)|access denied|geographic(al)? restriction|this content is not available in your)\b/i.test(
    html.slice(0, 8000),
  );
}

// "blog.linear.app" vs "linear.app" → same root → not a real redirect away.
function sameRootDomain(a: string, b: string): boolean {
  const rootA = a.split(".").slice(-2).join(".");
  const rootB = b.split(".").slice(-2).join(".");
  return rootA === rootB;
}
