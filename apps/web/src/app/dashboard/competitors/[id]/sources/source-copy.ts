import type { SourceState, SourceType } from "@outrival/shared";

/** What the user can do about a source's current state, if anything. */
export type SourceAction =
  | "fix_url"
  | "enable"
  /** Overrule a "no such surface" verdict by naming the page yourself. */
  | "point_at_url"
  | "resume"
  | "upgrade"
  | null;

export type SourceTone =
  /** Working, or on its way. */
  | "ok"
  /** A real limit worth naming — but not the user's fault to fix. */
  | "limited"
  /** Something the user can repair. */
  | "actionable"
  /** Nothing to see here. Neutral by design. */
  | "neutral";

export interface SourceCopy {
  tone: SourceTone;
  message: string;
  action: SourceAction;
}

/**
 * Why a competitor genuinely has no such surface. Phrased as a plain fact about
 * THEM, never as something we failed to do — this is the copy that stops a
 * well-covered competitor from looking full of holes.
 */
const NOT_AVAILABLE: Partial<Record<SourceType, string>> = {
  github_repo: "No public repo for this competitor.",
  youtube: "No YouTube channel linked from their site.",
  status: "They don't publish a status page.",
  changelog: "They don't publish a changelog.",
  trustpilot_public: "No Trustpilot profile for this domain.",
  appstore_reviews: "No App Store listing for this competitor.",
  docs: "They don't publish public developer docs.",
};

/**
 * Sources where naming the page ourselves would change nothing, so we offer no
 * control rather than a field that silently does nothing.
 *
 * The Trustpilot surface derives its business unit from the competitor's own
 * domain (`trustpilot.scraper.ts`), so a stored `config.url` is never read. Until
 * the scraper accepts a profile URL, a "point us at one" field there would look
 * like it worked and quietly change nothing, which is worse than the dead end it
 * replaces.
 */
const NO_URL_OVERRIDE = new Set<SourceType>(["trustpilot_public"]);

/** Failure diagnoses the user can act on, each with its own honest sentence. */
const FIXABLE: Record<string, string> = {
  site_redirected: "This page now redirects to a different domain.",
  site_dead: "This page appears to be down or gone.",
  spa_empty: "We reached the page but couldn't capture its content.",
  unknown: "We couldn't reach this page after several attempts.",
};

/**
 * The user-facing line for one source's state.
 *
 * `fallbacks` are the OTHER sources we're actively collecting on this competitor.
 * They are the whole point of the blocked message: a site isn't monolithic, so a
 * bot wall on the homepage doesn't blind us — the ATS jobs API, the changelog feed
 * and the status page are all still open, and often say more.
 */
export function sourceCopy(args: {
  state: SourceState;
  sourceType: SourceType;
  failureCategory?: string | null;
  fallbacks?: string[];
  minPlanLabel?: string;
  freshness?: string;
}): SourceCopy {
  const { state, sourceType, failureCategory, fallbacks = [], minPlanLabel, freshness } = args;

  switch (state) {
    case "tracking":
      return { tone: "ok", message: freshness ?? "Collecting.", action: null };
    case "pending":
      return { tone: "ok", message: "First scan in progress.", action: null };

    case "blocked": {
      // The old copy promised we were "escalating, no action needed". Under the
      // collection doctrine we no longer route around a refusal at all, so that
      // sentence described something the product had stopped doing. Say what is
      // true — we stop — and immediately say what we read instead.
      const instead =
        fallbacks.length > 0
          ? ` Here's what we track for this competitor instead: ${fallbacks.join(", ")}.`
          : "";
      return {
        tone: "limited",
        message: `This site blocks automated collection and we don't bypass it.${instead} No action needed from you.`,
        action: null,
      };
    }

    case "login_required":
      return {
        tone: "limited",
        message: "This page is behind a login, so it can't be monitored.",
        action: null,
      };

    case "geo_blocked":
      return {
        tone: "limited",
        message: "This site is geo-restricted from where we collect, so we can't reach it.",
        action: null,
      };

    case "fixable":
      return {
        tone: "actionable",
        message: FIXABLE[failureCategory ?? "unknown"] ?? FIXABLE.unknown!,
        action: "fix_url",
      };

    case "not_available":
      // The tone stays neutral: this is a fact about them, and it must never start
      // reading as a gap. What changes is that the row stops being a dead end — if
      // the user knows the surface exists, they can now say where.
      return {
        tone: "neutral",
        message: NOT_AVAILABLE[sourceType] ?? "This competitor doesn't have this surface.",
        action: NO_URL_OVERRIDE.has(sourceType) ? null : "point_at_url",
      };

    case "off":
      return { tone: "neutral", message: "Paused, not scraping.", action: "resume" };

    case "locked":
      return {
        tone: "neutral",
        message: minPlanLabel ? `Available on the ${minPlanLabel} plan.` : "Not on your plan.",
        action: "upgrade",
      };

    case "not_configured":
      return { tone: "neutral", message: "Not enabled.", action: "enable" };
  }
}

/**
 * Whether this state should read as a problem. Only the two genuinely limiting
 * families do — a surface the competitor doesn't have, a source above the plan and
 * a source not turned on are all neutral, and must never be styled as errors.
 */
export function isConcerning(state: SourceState): boolean {
  return (
    state === "blocked" ||
    state === "login_required" ||
    state === "geo_blocked" ||
    state === "fixable"
  );
}
