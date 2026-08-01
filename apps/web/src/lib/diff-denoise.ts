export type DiffLine = { kind: "add" | "remove"; text: string };

/**
 * Drop the lines of a page-text diff that carry no change.
 *
 * A lexical diff compares the WHOLE extracted text of two captures, so a page
 * that moved one paragraph reports its navigation, its language switcher, its
 * cookie notice and its footer alongside the paragraph. Measured on production
 * over 30 days, 42% of all rendered diff lines are that chrome (56% on pricing),
 * plus 674 lines a single character long, which are hero words a site animates
 * letter by letter and the extractor reads as one line each.
 *
 * This runs at RENDER time and only on the signal surfaces. The stored
 * `diff_text` stays complete: it is the audit trail, and it is what the
 * classifier read. The competitor Activity tab, whose control says "Show raw
 * diff", keeps showing the raw diff.
 *
 * Every rule is deterministic and reversible by reading the source page. None of
 * them guesses at meaning: the two that remove the most (a line present on both
 * sides, a line repeated within a side) are set logic, not judgement.
 */

/**
 * Whole-line navigation, legal and language chrome, in the three languages the
 * corpus actually contains. Deliberately excludes calls to action ("Get
 * started", "Book a demo", "Contact sales"): a competitor swapping its primary
 * CTA is news, and the homepage differ has a typed change for exactly that.
 */
const CHROME = new Set([
  // Navigation
  "home", "blog", "docs", "documentation", "pricing", "product", "products",
  "solutions", "solution", "resources", "company", "about", "about us",
  "careers", "jobs", "customers", "partners", "integrations", "support",
  "help", "contact", "contact us", "login", "log in", "sign in", "sign up",
  "register", "menu", "search", "more", "overview", "features", "community",
  "changelog", "status", "faq", "newsletter", "press", "events", "webinars",
  // Legal and footer
  "privacy", "privacy policy", "terms", "terms of service", "terms of use",
  "legal", "imprint", "cookies", "cookie policy", "cookie settings",
  "manage cookies", "all rights reserved", "sitemap", "accessibility",
  "security", "trust center",
  // Language switchers
  "en", "fr", "de", "es", "it", "pt", "nl", "ja", "zh", "ko", "english",
  "français", "deutsch", "español", "italiano", "português", "日本語",
  "简体中文", "繁體中文", "한국어",
  // Social
  "twitter", "linkedin", "github", "facebook", "instagram", "youtube",
  "discord", "slack", "mastodon", "reddit", "tiktok",
  // French
  "accueil", "tarifs", "tarification", "à propos", "contactez-nous",
  "nous contacter", "connexion", "s'inscrire", "mentions légales",
  "politique de confidentialité", "conditions d'utilisation", "ressources",
  "entreprise", "carrières", "aide", "recherche", "plus", "produits",
  // German
  "startseite", "preise", "über uns", "kontakt", "anmelden", "registrieren",
  "impressum", "datenschutz", "nutzungsbedingungen", "unternehmen", "karriere",
  "hilfe", "suche", "mehr", "produkte", "lösungen",
]);

/** A copyright line names a year, not a change. */
const COPYRIGHT = /^(©|\(c\)|copyright\b)/i;

/** Case and spacing are not the change either, so comparisons ignore both. */
function key(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The rules, in the order they have to run.
 *
 * Both-sides removal comes FIRST and needs the complete sets: a line the differ
 * reports as removed AND added is a line that did not change, and it is the
 * single biggest source of "these changes aren't really on the page". Only then
 * can per-side deduplication run, or a line repeated three times by a logo
 * carousel would survive on one side because its twin was already gone.
 */
export function denoiseDiffLines(lines: readonly DiffLine[]): DiffLine[] {
  const onSide = (kind: DiffLine["kind"]) =>
    new Set(lines.filter((l) => l.kind === kind).map((l) => key(l.text)));
  const added = onSide("add");
  const removed = onSide("remove");

  const seen = new Set<string>();
  const out: DiffLine[] = [];

  for (const line of lines) {
    const k = key(line.text);
    if (!k) continue;
    // A single glyph is a checkmark, a bullet, or one letter of a word the page
    // animates character by character. It is never the news on its own.
    if (k.length <= 1) continue;
    // Present on both sides: the text is still on the page, the differ just
    // moved it. Showing it as removed AND added is the reading the user was
    // right to distrust.
    if (added.has(k) && removed.has(k)) continue;
    if (CHROME.has(k) || COPYRIGHT.test(k)) continue;
    // Same line twice on the same side (logo carousels, repeated feature rows).
    const sideKey = `${line.kind}:${k}`;
    if (seen.has(sideKey)) continue;
    seen.add(sideKey);
    out.push(line);
  }

  return out;
}
