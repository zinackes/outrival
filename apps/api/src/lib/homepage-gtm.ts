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
const SALES_RE = /\b(demos?|sales|consultation|quote)\b|\b(talk|speak|chat) to\b|\b(book|schedule|request) a\b/i;

/**
 * The user reaches the product without asking anyone. "free" belongs here because
 * a CTA offering something free is offering it directly; when it says "free demo"
 * the sales test above has already claimed it. "deploy" is here because an
 * imperative that puts the visitor inside the product is self-serve by definition
 * (vercel.com ships "Deploy now" next to "Talk to sales").
 */
const SELF_SERVE_RE = /\b(get started|sign ?up|register|create (an )?account|try|start|download|install|deploy|free)\b/i;

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
  // A segment every B2B nav names, and the tiers are already on the pricing tab.
  "enterprise", "business", "for enterprise",
  // Legal and chrome.
  "legal", "privacy", "privacy policy", "terms", "cookies", "security",
  "search", "menu", "language", "more", "close",
]);

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
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items ?? []) {
    const text = item?.text?.replace(/\s+/g, " ").trim();
    if (!text || text.length > MAX_NAV_LABEL) continue;
    // A label with no letter is chrome (an arrow, a separator, a bare count).
    if (!/\p{L}/u.test(text)) continue;
    const key = text.toLowerCase();
    if (GENERIC_NAV.has(key) || seen.has(key)) continue;
    // A label that names a buying motion is a call to action sitting in the nav
    // ("Get Notion free", "Talk to a human"), not an area of their product. Reusing
    // the CTA vocabulary catches these without listing every phrasing of them.
    if (motionOf(text)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_NAV_ITEMS) break;
  }
  return out.length >= MIN_NAV_ITEMS ? out : [];
}
