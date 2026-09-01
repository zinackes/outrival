import { extractVisibleText } from "../pricing/signals";

// Strong hiring vocabulary — the words a REAL careers / jobs listing carries, not a
// mere "Careers" nav/footer link (which every marketing homepage has). Kept strict
// on purpose: on a client-routed SPA every path returns HTTP 200 with the app shell,
// so a bare "careers" link in the chrome must NOT qualify a page as a jobs page —
// only listing-level signals do. EN + FR (competitors localise). Anchored so a lone
// word ("engineering", "team") can't trip a false positive.
const CAREERS_SIGNAL_PATTERNS: RegExp[] = [
  /\bopen\s+(positions?|roles?|jobs?|vacanc\w+)\b/i,
  /\bcurrent\s+openings?\b/i,
  /\bjob\s+openings?\b/i,
  /\bwe(?:'|’|\s+a)re\s+hiring\b/i, // "we're hiring" / "we are hiring"
  /\bwe\s+are\s+hiring\b/i,
  /\bnow\s+hiring\b/i,
  /\bview\s+(all\s+)?(open\s+)?(positions?|roles?|jobs?)\b/i,
  /\b(browse|see|explore)\s+(all\s+)?(open\s+)?(positions?|roles?|jobs?)\b/i,
  /\bjoin\s+(our|the)\s+team\b/i,
  /\bapply\s+(now|today|here)\b/i,
  /\blife\s+at\b/i,
  // FR
  /\bpostes?\s+(ouverts?|à\s+pourvoir|disponibles?)\b/i,
  /\bnous\s+recrutons\b/i,
  /\brejoignez\s+(nous|notre\s+[ée]quipe)\b/i,
  /\boffres?\s+d['’]emploi\b/i,
];

/**
 * True when HTML looks like an actual careers/jobs listing — either it embeds a
 * JobPosting JSON-LD, or its visible text carries listing-level hiring vocabulary.
 * Pure. Used to reject a page that merely returned HTTP 200 (an SPA home/404-view, a
 * marketing page) from being committed as "the careers page" and LLM-extracted for
 * jobs that aren't there. An ATS-board match is checked separately by the caller
 * (detectAtsBoard) — a page can be a valid careers page via either route.
 */
export function hasCareersSignals(html: string): boolean {
  if (/"@type"\s*:\s*"JobPosting"/i.test(html)) return true;
  // Minified SSR markup (Next.js, React) has no whitespace between tags, and the
  // text helper glues adjacent elements together: rippling.com/careers read
  // "LoginSee open rolesRippling careers", and every anchored pattern below
  // missed the "See open roles" it carries. Put a space back between tags first.
  // Pricing keeps the glued reading on purpose: spacing flips a real pricing
  // fixture (Linear: public → public_partial), a decision to take on its own.
  const text = extractVisibleText(html.replace(/>\s*</g, "> <"));
  return CAREERS_SIGNAL_PATTERNS.some((p) => p.test(text));
}

// "56 jobs", "54 open positions", "12 offres d'emploi" — the total a listing prints
// above its rows. Requires a hiring noun so a bare number, a year or a headcount
// ("2026", "1200 employees") can't match.
const DECLARED_TOTAL =
  /\b(\d{1,4})\s+(?:current\s+|open\s+|available\s+|active\s+)?(?:jobs?|roles?|positions?|openings?|vacanc(?:y|ies)|offres?\s+d[’']emploi|offres?|postes?)\b/gi;

/**
 * The number of open roles the careers page ADVERTISES, or null when it doesn't say.
 *
 * This is the only independent check we have on an extraction: the rows can be a
 * client-paginated slice, the AI window can cut the list short, a board can exceed
 * its page cap — and in every one of those cases the result still looks like a
 * complete list. The page's own header does not. Takes the largest stated figure,
 * since a listing prints its grand total alongside smaller per-department counts.
 *
 * Advisory only: it feeds a log line, never a decision. The phrasing is too varied
 * across sites to gate anything on it. Pure.
 */
export function declaredOpenRoles(pageText: string): number | null {
  let best: number | null = null;
  for (const m of pageText.matchAll(DECLARED_TOTAL)) {
    const n = Number(m[1]);
    // 0 is a real answer ("0 open positions") but carries no shortfall to detect,
    // and four-digit "totals" are page furniture, not a board we can undercount.
    if (n > 0 && n <= 999 && (best === null || n > best)) best = n;
  }
  return best;
}
