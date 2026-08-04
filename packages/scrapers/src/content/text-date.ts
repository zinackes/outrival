/**
 * A publication date a listing printed for a human rather than for a machine.
 *
 * Most blog templates emit `<time datetime="...">` and `blog-links` reads that.
 * A large minority print "June 25, 2026" or "04.08.2026" in a plain `<span>` and
 * nothing else — 262 of the rows we hold came off pages like that, and every one
 * of them ends up dated from the day we scraped it. This is the fallback for
 * exactly those, and it is deliberately narrow: a date we get WRONG is worse than
 * a row that stays honestly undated, because a wrong date moves the cadence chart,
 * the pivot windows and the position of the row in the timeline.
 *
 * So it accepts only formats that cannot mean two things:
 *   "June 25, 2026" · "Jun 25 2026" · "25 June 2026" · "2026-06-25" · "25.06.2026"
 *
 * and refuses everything else. `06/25/2026` is rejected on purpose: the same nine
 * characters are the 6th of June in most of the world and the 25th of June in the
 * US, and there is nothing on a page that says which one a listing meant.
 *
 * PURE: no I/O, no DB, no AI.
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const ORDINAL = "(?:st|nd|rd|th)?";

/** "June 25, 2026", "Jun 25 2026", "June 25th, 2026". */
const MONTH_FIRST = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})${ORDINAL},?\\s+(\\d{4})\\b`, "i");
/** "25 June 2026", "25. Juni" style day-first, English months only. */
const DAY_FIRST = new RegExp(`\\b(\\d{1,2})${ORDINAL}\\.?\\s+(${MONTH_ALT})\\.?,?\\s+(\\d{4})\\b`, "i");
/** "2026-06-25". */
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
/** "25.06.2026" — dots are day-first everywhere they are used, so it is not ambiguous. */
const DOTTED = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/;

/** Older than this and it is a copyright line or a parse accident, not a post. */
const EARLIEST_YEAR = 2000;
/** A post dated slightly ahead is a timezone, further ahead is not a date we trust. */
const FUTURE_SLOP_MS = 2 * 86_400_000;

/** A chip of text longer than this is prose, and a date inside prose is a quote. */
export const MAX_DATE_TEXT_CHARS = 60;

function isoFrom(year: number, month: number, day: number, now: Date): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < EARLIEST_YEAR) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  // Rejects the 31st of a 30-day month, which JS would roll into the next one.
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  if (at.getTime() > now.getTime() + FUTURE_SLOP_MS) return null;
  return at.toISOString();
}

/**
 * The date this string states, as UTC midnight, or null when it states none.
 *
 * UTC is explicit because `new Date("June 25, 2026")` is parsed in the SERVER's
 * timezone: on a Europe/Paris box that is 23:00 on the 24th, and the tab renders
 * its dates in UTC, so the post would show up a day early.
 */
export function parseTextDate(raw: string, now: Date = new Date()): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const monthFirst = MONTH_FIRST.exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1]!.toLowerCase()]!;
    return isoFrom(Number(monthFirst[3]), month, Number(monthFirst[2]), now);
  }

  const dayFirst = DAY_FIRST.exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]!.toLowerCase()]!;
    return isoFrom(Number(dayFirst[3]), month, Number(dayFirst[1]), now);
  }

  const iso = ISO.exec(text);
  if (iso) return isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]), now);

  const dotted = DOTTED.exec(text);
  if (dotted) return isoFrom(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]), now);

  return null;
}

/**
 * The first date among the text chips of one post's card.
 *
 * `chips` is each element's OWN text, so a date has to sit on its own line the way
 * a byline does. A sentence that happens to mention a date ("Back in June 2025 we
 * rewrote…") is longer than `MAX_DATE_TEXT_CHARS` and never reaches the parser.
 */
export function firstTextDate(chips: readonly string[], now: Date = new Date()): string | null {
  for (const chip of chips) {
    const text = chip.replace(/\s+/g, " ").trim();
    if (!text || text.length > MAX_DATE_TEXT_CHARS) continue;
    const at = parseTextDate(text, now);
    if (at) return at;
  }
  return null;
}
