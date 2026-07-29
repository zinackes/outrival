/**
 * How a competitor sells, and what their own navigation says their product covers
 * — both read off the homepage structure we already store on every capture
 * (`snapshots.homepage_structure`, patch-16).
 *
 * The fact sheet derived its copy from the hero headline and the feature section
 * headings only, so the hero's calls to action and the nav sat in the jsonb unread.
 * The primary CTA is the shortest honest read of a go-to-market motion there is:
 * "Start free" and "Book a demo" are the same button in the same place, and they
 * describe two different companies.
 *
 * PURE and AI-free, which is the point: it applies retroactively to every homepage
 * capture already in the database, with no backfill and no extra scrape.
 */

export type GtmMotion = "self_serve" | "sales_led";

export interface Cta {
  text: string;
  href: string | null;
}

export interface GtmRead {
  /**
   * What the primary call to action asks for; null when its label carries neither
   * vocabulary ("Learn more", "Explore"). Null is the signal to say NOTHING: the
   * parser falls back to the first link in the hero when no candidate looks like a
   * button, so a label that names no motion is as likely to be a nav link as a CTA.
   */
  motion: GtmMotion | null;
  /**
   * The other motion, when the secondary call to action offers it. A pair of
   * "Start free" / "Talk to sales" is a different company from one that only ever
   * offers the demo, so the pair carries more than the primary alone.
   */
  alternate: GtmMotion | null;
  primary: Cta | null;
  secondary: Cta | null;
}

/**
 * Tested BEFORE the self-serve vocabulary: "Get a free demo" carries both, and it
 * is a sales motion. Every token here names a conversation with a human.
 *
 * A bare "Contact" / "Contact us" is deliberately NOT here. The parser's primary
 * CTA falls back to the first link in the hero's scope when nothing in it looks
 * like a button (`extractHero`, packages/scrapers), and that fallback is routinely
 * a nav link. "Contact" as a nav item is on nearly every homepage, including the
 * most self-serve ones, so accepting it would call a PLG company sales-led on the
 * strength of its footer navigation. "Contact sales" still matches, on `sales`.
 */
const SALES_RE =
  /\b(demos?|démos?|sales|consultation|quote|devis)\b|\b(talk|speak|chat) to\b|\b(book|schedule|request) a\b|\bprendre rendez-vous\b/i;

/**
 * The user reaches the product without asking anyone. Three families, and every
 * entry was put here by a label measured on a real stored capture:
 *
 *  - signing up ("Sign up with Google", "Continue with Google", "S'inscrire")
 *  - an imperative that puts the visitor inside the product ("Deploy now",
 *    "Build with Nile", "Generate your first presentation", "Start submission")
 *  - buying without a conversation ("Buy now", "Commander")
 *
 * "free" is here because a CTA offering something free is offering it directly;
 * when it says "free demo" the sales test above has already claimed it. `start` is
 * matched as a PREFIX because the wild is full of "Getting started" and of labels
 * where two buttons were captured glued together ("Get StartedBring NextGen…").
 */
const SELF_SERVE_RE =
  /\b(get started|sign ?up|register|create|generate|continue with|try|build|deploy|download|install|buy|order|free)\b|\bstart|\b(démarrer|commencer|essai|essayer|gratuit|s'inscrire|inscription|rejoindre|télécharger|commander|ouvrir un compte)/i;

function motionOf(text: string): GtmMotion | null {
  if (SALES_RE.test(text)) return "sales_led";
  if (SELF_SERVE_RE.test(text)) return "self_serve";
  return null;
}

function toCta(raw: { text?: string | null; href?: string | null } | null | undefined): Cta | null {
  const text = raw?.text?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return { text, href: raw?.href?.trim() || null };
}

/** Read the hero's calls to action. Every field is null when the hero carries none. */
export function readGtm(
  hero:
    | {
        primaryCta?: { text?: string | null; href?: string | null } | null;
        secondaryCta?: { text?: string | null; href?: string | null } | null;
      }
    | null
    | undefined,
): GtmRead {
  const primary = toCta(hero?.primaryCta);
  const secondary = toCta(hero?.secondaryCta);
  const motion = primary ? motionOf(primary.text) : null;
  const secondaryMotion = secondary ? motionOf(secondary.text) : null;
  return {
    motion,
    // Requires a primary motion: "the other one" is meaningless without a first,
    // and only the OPPOSITE motion earns a second line. A secondary repeating the
    // primary's motion ("Start free" / "Create an account") adds nothing.
    alternate: motion && secondaryMotion && secondaryMotion !== motion ? secondaryMotion : null,
    primary,
    // Kept only when it names a motion of its own. The parser's secondary is simply
    // the next link in the hero that differs from the primary, which in the wild is
    // "22 more" (a disclosure toggle) or "Join us at our conference" — measured on
    // real homepages. Those say nothing about how they sell, and printing one under
    // "Also offers" spends the reader's trust on noise.
    secondary: secondaryMotion ? secondary : null,
  };
}

/**
 * Nav labels every SaaS ships, which therefore say nothing about what THIS
 * competitor builds. Dropping them leaves the vocabulary that is theirs ("Agents",
 * "Data residency", "For agencies"). A nav made entirely of these yields an empty
 * list and the caller renders nothing, which beats showing a reader four labels
 * they already assumed were there.
 *
 * The surfaces in here (pricing, docs, changelog, status) are not lost by being
 * dropped: they are each tracked as a source, with a monitor and a tab of their own.
 */
const GENERIC_NAV = new Set([
  // Wrappers that introduce the product without naming any part of it.
  "product", "products", "platform", "solutions", "features", "overview",
  "use cases", "why us", "how it works", "explore",
  // Company and content.
  "about", "about us", "company", "team", "careers", "jobs", "hiring", "press",
  "blog", "news", "newsroom", "resources", "library", "guides", "events",
  "webinars", "podcast", "customers", "case studies", "testimonials",
  "partners", "affiliates", "community", "academy", "learn",
  // Surfaces we already track as their own source.
  "pricing", "plans", "plans and pricing", "docs", "documentation", "api",
  "api docs", "developers", "changelog", "releases", "status", "roadmap",
  "integrations", "marketplace", "apps",
  // Support and account.
  "support", "help", "help center", "contact", "contact us", "contact sales",
  "sales", "login", "log in", "sign in", "signin", "sign up", "signup",
  "get started", "start free", "free trial", "book a demo", "request a demo",
  "demo", "dashboard", "account", "my account",
  // Entering the app, and the merch shop. Both are destinations, not product areas.
  "home", "app", "open app", "web app", "launch app", "console", "store", "shop",
  "merch", "downloads", "updates", "pro", "teams",
  // Captured while a session was open, so the nav is the signed-in app's own chrome.
  "log out", "logout", "sign out", "profile", "settings", "account details",
  "change password", "close menu",
  // A segment every B2B nav names, and the tiers are already on the pricing tab.
  "enterprise", "business", "for enterprise",
  // Legal and chrome.
  "legal", "privacy", "privacy policy", "terms", "cookies", "security",
  "search", "menu", "language", "more", "close",
  // Social accounts. A social bar living in the header nav read as a product map.
  "linkedin", "youtube", "twitter", "twitter(x)", "x", "facebook", "instagram",
  "threads", "bluesky", "tiktok", "github", "discord", "mastodon", "reddit",
  // Pages that exist to sell rather than to name a capability.
  "faq", "faqs", "tour", "compare", "compare us", "comparison", "comparisons",
  "reviews", "terms of service", "cookie policy",
  // Accessibility-widget controls. A third-party a11y toolbar renders inside the
  // header nav, so its whole control panel was being read as a product map.
  "open toolbar", "close toolbar", "increase text", "decrease text", "grayscale",
  "high contrast", "negative contrast", "light background", "links underline",
  "readable font", "reset", "accessibility",
  // French equivalents of the same universals. Several tracked competitors are
  // French, and their navs were surviving the English list intact.
  "accueil", "tarifs", "à propos", "a propos", "qui sommes-nous", "contactez-nous",
  "nous contacter", "connexion", "se connecter", "mon compte", "aide", "assistance",
  "produit", "produits", "fonctionnalités", "entreprise", "carrières", "carrieres",
  "actualités", "témoignages", "ressources", "documentation", "intégrations",
  "mentions légales", "conditions générales", "confidentialité", "recherche",
]);

/**
 * Language switchers sit in the header nav, so a multilingual site handed us its
 * locale list as its product map. Matched on the label rather than the href because
 * the pattern is the same everywhere and the hrefs are not.
 */
const LANGUAGE_NAMES = new Set([
  // Endonyms, as switchers usually write them.
  "english", "français", "francais", "deutsch", "español", "espanol", "italiano",
  "português", "portugues", "nederlands", "polski", "svenska", "dansk", "suomi",
  "norsk", "türkçe", "turkce", "čeština", "русский", "українська", "日本語",
  "中文", "简体中文", "繁體中文", "한국어", "العربية", "हिन्दी", "ไทย", "tiếng việt",
  "bahasa indonesia", "bahasa melayu", "română", "ελληνικά",
  // And in English, which some switchers use instead.
  "french", "german", "spanish", "italian", "portuguese", "dutch", "polish",
  "swedish", "danish", "finnish", "norwegian", "turkish", "czech", "russian",
  "ukrainian", "japanese", "chinese", "korean", "arabic", "hindi", "thai",
  "vietnamese", "indonesian", "malay", "romanian", "greek", "hebrew",
]);

/** A bare locale code ("en", "es", "pt-br", "zh-CN") is never a product area. */
const LOCALE_CODE_RE = /^[a-z]{2}(-[a-z]{2,4})?$/i;

function isLanguageLabel(text: string): boolean {
  // Switchers routinely qualify the region: "English (United States)". The
  // parenthetical is dropped before the lookup so one entry covers every variant.
  const t = text.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, "");
  return LANGUAGE_NAMES.has(t) || LOCALE_CODE_RE.test(t);
}

/**
 * The header's brand link, which every site has and which names the competitor we
 * are already looking at. Matched on EQUALITY with a brand token (and on the domain
 * form of the label), never on containment: "Notion AI" contains "notion" and is a
 * genuine product area, so a containment test would delete the very thing this
 * section exists to show.
 */
function isBrandSelfLink(text: string, brandTokens: string[]): boolean {
  if (brandTokens.length === 0) return false;
  const bare = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (brandTokens.includes(bare)) return true;
  // "apiplatform.io" → "apiplatform": a label written as their own domain.
  const asDomain = text.trim().toLowerCase();
  if (!asDomain.includes(".")) return false;
  const host = asDomain.replace(/^www\./, "").split(".")[0] ?? "";
  return brandTokens.includes(host.replace(/[^a-z0-9]/g, ""));
}

/** Longest label we treat as a nav item: past this it is a flattened dropdown. */
const MAX_NAV_LABEL = 28;
/** Past a handful the list stops being a product map and becomes a site index. */
const MAX_NAV_ITEMS = 8;
/**
 * Below this, return nothing. A nav that leaves exactly one label behind has not
 * revealed a product map; it has revealed one page name that happened to miss the
 * generic list ("Now", "Enterprise"), and a section headed "What their product
 * covers" holding a single such chip claims more than the data supports.
 */
const MIN_NAV_ITEMS = 2;

/**
 * The nav labels that describe this competitor's product, in document order.
 * Deduped case-insensitively because a page ships its nav twice (desktop and
 * mobile menus), and both are captured.
 */
export function productNavItems(
  items: Array<{ text?: string | null; href?: string | null }> | null | undefined,
  /** The competitor's own brand tokens, so its header logo link drops out. */
  brandTokens: string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items ?? []) {
    const text = item?.text?.replace(/\s+/g, " ").trim();
    if (!text || text.length > MAX_NAV_LABEL) continue;
    // A label with no letter is chrome (an arrow, a separator, a bare count).
    if (!/\p{L}/u.test(text)) continue;
    // A mailto link renders its address as the label ("pr@acme.com").
    if (text.includes("@")) continue;
    // Numbered and arrow-prefixed navs are common ("01Home", "02Compare", "→ Docs"),
    // and the prefix alone was enough to walk every one of those labels past the
    // generic list. Matched on the stripped key; the chip still shows their text.
    const key = text.toLowerCase().replace(/^[\d\W_]+/u, "");
    if (GENERIC_NAV.has(key) || seen.has(key)) continue;
    // A label that names a buying motion is a call to action sitting in the nav
    // ("Get Notion free", "Talk to a human"), not an area of their product. Reusing
    // the CTA vocabulary catches these without listing every phrasing of them.
    if (motionOf(text)) continue;
    if (isLanguageLabel(text) || isBrandSelfLink(text, brandTokens)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_NAV_ITEMS) break;
  }
  return out.length >= MIN_NAV_ITEMS ? out : [];
}
