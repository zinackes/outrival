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
  const text = extractVisibleText(html);
  return CAREERS_SIGNAL_PATTERNS.some((p) => p.test(text));
}
