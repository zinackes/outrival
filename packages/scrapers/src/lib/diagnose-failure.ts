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
  | "retry_camoufox" // patch-20 already escalates; nothing new to do
  | "propose_alternative" // surface user-facing alternatives (different URL / manual / pause)
  | "detect_pivot" // could be temporary or a real death/acquisition → structural detection
  | "capture_api" // try runtime XHR/fetch capture for a pure SPA
  | "mark_unscrapable"; // no automated recovery — investigate in ops

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
  if (finalUrl) {
    const from = safeHostname(originalUrl);
    const to = safeHostname(finalUrl);
    if (from && to && from !== to && !sameRootDomain(from, to)) {
      return {
        category: "site_redirected",
        confidence: "high",
        evidence: [`Redirected from ${from} to ${to}`],
        suggestedAction: "detect_pivot",
      };
    }
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

  // 6. Anti-bot — patch-20 already escalates through proxies/Camoufox.
  if (
    last?.failureReason === "cloudflare_challenge" ||
    last?.failureReason === "blocked_403" ||
    last?.failureReason === "blocked_503" ||
    last?.failureReason === "soft_block"
  ) {
    return {
      category: "anti_bot",
      confidence: "high",
      evidence: [`Failure reason: ${last.failureReason}`],
      suggestedAction: "retry_camoufox",
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
