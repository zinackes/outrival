/**
 * Did a competitor's post name the WORKSPACE'S OWN product? (Content Intelligence
 * v2 P2, the `competitor_named_you` signal.)
 *
 * This is the one place in the feature where a wrong answer is expensive: the
 * signal it gates is `critical`, and critical bypasses every moderation layer and
 * mails the user within minutes. A competitor writing "our workflow is linear" must
 * never page a workspace whose product is called Linear.
 *
 * Two ways to be sure, in order of strength:
 *
 *  1. DOMAIN. The post text carries the workspace's own domain. A domain is not a
 *     word — nobody writes "outrival.io" by accident — so this stands on its own.
 *  2. BRAND, at word boundaries. Good enough for a distinctive name, and the only
 *     evidence available when a post names a rival without linking to it.
 *
 * A brand that is also an ordinary word in English or French falls back to (1):
 * without the domain, "monday" in a post is Monday. That stoplist is deliberately
 * small — it exists to stop the homonyms that actually ship as SaaS names, not to
 * be a dictionary.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** Who the workspace is, as a post could refer to it. */
export interface SelfIdentity {
  /** Product/company names as a human writes them ("Outrival"). */
  brands: string[];
  /** Hosts the workspace owns, lowercase, www-stripped ("outrival.io"). */
  domains: string[];
}

/** How the mention was established. Both are reported; neither is a guess. */
export type SelfMatchKind = "domain" | "brand";

/**
 * Brands that are also ordinary EN/FR words. A mention of one of these is only
 * ever the workspace when the post also carries its domain.
 *
 * Curated, not exhaustive: every entry is a word a competitor writes in normal
 * prose, and each one it holds back is a critical alert that would have been about
 * a sentence rather than about the reader.
 */
export const COMMON_WORD_BRANDS = new Set([
  // EN
  "arc", "base", "bench", "block", "board", "box", "brand", "canvas", "circle",
  "cloud", "craft", "drive", "echo", "flow", "focus", "forge", "front", "grid",
  "group", "hub", "level", "lever", "light", "line", "linear", "link", "list",
  "loop", "mode", "monday", "motion", "notion", "order", "pace", "path", "peak",
  "pitch", "plane", "point", "prime", "pulse", "ramp", "range", "reach", "relay",
  "rise", "root", "scale", "scope", "shift", "signal", "slack", "sprint", "stack",
  "stage", "start", "stock", "store", "stream", "studio", "swift", "tempo",
  "track", "trust", "unit", "vault", "view", "vision", "wave", "zone",
  // FR
  "accord", "atelier", "cadre", "canal", "chemin", "cible", "coeur", "essor",
  "forme", "lien", "ligne", "marche", "monde", "niveau", "nord", "onde", "phare",
  "pointe", "portail", "poste", "sommet", "source", "temps", "trait", "vague",
  "vue",
]);

/** Lowercase, alphanumerics only — so "Out-Rival" and "outrival" are one name. */
export function normalizeBrand(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Is `brand` present in `text` as a WORD, rather than inside another one? Unicode
 * boundaries, so "Notionally" and "Slackline" do not count.
 */
export function namesBrand(text: string, brand: string): boolean {
  const trimmed = brand.trim();
  if (trimmed.length < 3) return false; // too short to tell apart from anything
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(trimmed)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** The registrable-ish host of a URL, lowercase and www-stripped, or null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Does this mention refer to the workspace's own product?
 *
 * `mention` is the name the model read out of the post; `postText` is the post it
 * read it from. The mention alone is never enough — the name has to be in the text
 * as a word, which is also what keeps a model's paraphrase from reaching the
 * signal.
 */
export function resolveSelfMatch(args: {
  mention: string;
  postText: string;
  self: SelfIdentity;
}): SelfMatchKind | null {
  const { mention, postText, self } = args;

  // (1) The domain. Checked against the post itself, not the mention: a post links
  // to what it compares against far more often than it spells the domain out.
  const text = postText.toLowerCase();
  for (const domain of self.domains) {
    const d = domain.trim().toLowerCase();
    if (d.length >= 4 && text.includes(d)) return "domain";
  }

  // (2) The brand. Both sides must agree: the model named it AND the post writes it.
  const mentionKey = normalizeBrand(mention);
  if (!mentionKey) return null;
  for (const brand of self.brands) {
    const key = normalizeBrand(brand);
    if (!key || key.length < 3 || key !== mentionKey) continue;
    if (COMMON_WORD_BRANDS.has(key)) continue; // needs the domain, and it wasn't there
    if (namesBrand(postText, brand)) return "brand";
  }
  return null;
}
