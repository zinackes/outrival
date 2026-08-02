/**
 * The copy a company positions itself with, read off one homepage structure —
 * and the rule that decides when that copy has actually CHANGED.
 *
 * Positioning Intelligence v2 P1. The derivation used to live in the API alone
 * (`positioningCopyOf`), read lazily over the snapshot chain every time the
 * Positioning tab was opened. It moves here because it now has THREE callers —
 * the fact sheet, the materialised timeline writer in the worker, and the
 * one-shot backfill — and the comment it carried was already the reason: a "then"
 * capture and a "now" capture must be derived the same way, or drift in the
 * derivation reads as drift in their messaging, which is the one thing an
 * over-time view must never invent.
 *
 * PURE: structure in, copy out. No DB, no network.
 */

/** The subset of a parsed homepage structure the copy is read from. */
export interface HomepageCopySource {
  title?: string | null;
  metaDescription?: string | null;
  openGraph?: { title?: string | null; description?: string | null } | null;
  hero?: {
    headline?: string | null;
    subheadline?: string | null;
    primaryCta?: { text?: string | null; href?: string | null } | null;
  } | null;
  sections?: Array<{ heading?: string | null; type?: string | null }>;
}

export interface PositioningCopy {
  headline: string | null;
  subheadline: string | null;
  /** The hero's primary call to action, as the button words it. */
  primaryCta: string | null;
  valueProps: string[];
}

// Text a site builder writes into <head> on your behalf, and the parked/stopped
// page a dead host serves in place of the site. Neither is the competitor saying
// anything about itself, and both were measured in production as the only junk the
// fallback below would otherwise surface as a headline ("Made with Framer" as an
// og:description, "Sorry, the website has been stopped" as a title).
const HEAD_BOILERPLATE_RE =
  /^(made|built|created|designed)\s+(with|in|on|using)\s+\S+|^powered\s+by\s+\S+$|website\s+has\s+been\s+stopped|site\s+not\s+found/i;

// A <head> line is only usable as positioning copy when it is a PHRASE. A bare
// brand token ("API360") names the company and claims nothing, so it would fill the
// section with the one thing the reader already knows.
//
// The length ceiling is measured, not guessed: across the 157 stored titles in
// production the longest is 158 chars, so it never fires on a title at all. It
// exists for descriptions, where the tail is auto-generated rather than written
// (asista.com publishes a 522-char og:description that is its own page text dumped
// twice and cut off at "[…]"). Over the ceiling the line is DROPPED, never
// truncated: cutting it would hand the reader a sentence nobody wrote.
function usableHeadCopy(value: string | null | undefined): string | null {
  const v = value?.trim() ?? "";
  if (!v || v.length > 200) return null;
  if (!/\s/.test(v)) return null;
  if (HEAD_BOILERPLATE_RE.test(v)) return null;
  return v;
}

/** Highlights shown at a glance. More than this stops being a glance. */
const MAX_VALUE_PROPS = 8;
/** A heading recurring this often is a template/UI label, never a highlight. */
const TEMPLATE_HEADING_REPEATS = 3;

// The section types the parser decides on a cue that cannot be mistaken for a
// product claim: a currency-and-period pattern, a blockquote, stacked <details>, a
// button under a closing line. These verdicts are worth trusting outright.
const NEVER_A_VALUE_PROP = new Set(["pricing", "faq", "testimonials", "cta"]);

// `logos` is deliberately NOT in that set. The parser awards it to any section with
// five or more images and little text, whatever the heading says, and that shape is
// far more often a product grid than a customer wall: of the 50 stored `logos`
// sections on prod 2026-08-01, 31 are not customer walls at all, and excluding them
// wholesale threw away real highlights ("130+ connectors or build your own",
// "Wide list of trending social media channels", "Fits Right Into Your Hiring
// Stack"). So the heading decides, and only for this one type.
//
// French included because the roster is: "Ils parlent de nous" is a press wall and
// reads as a claim to any English-only pattern.
const CUSTOMER_WALL_RE =
  /\b(trusted by|used by|loved by|backed by|powering|join(ed)? \d|our (customers|clients|partners)|(companies|brands|teams|developers) (that|who))\b|\b(ils (parlent de nous|nous font confiance)|nos (clients|partenaires|références))\b/i;

// Two more families that are not a claim about the product: the closing call to
// action, and the blog/press teaser strip near the footer. Anchored at the start,
// where that phrasing opens a section, so a genuine claim carrying the same verb
// ("Start shipping on day one") is untouched.
const NOT_A_CLAIM_RE =
  /^(ready to|get started|start (free|now|your|building)|try |book a |contact (us|sales)|sign up|request a )|^(latest|recent|more from|from the blog|blog|news|press|resources|events|webinars|case stud|customer stor)/i;

// A highlight is a PHRASE the competitor wrote about its product. One word is a tab
// label ("Solo", "Teams", "Pricing"), and past ~120 chars the heading is a whole
// paragraph the section walk glued together, not a heading anyone designed.
function isClaimLike(heading: string | null | undefined): boolean {
  const h = heading?.trim() ?? "";
  if (!h || h.length > 120) return false;
  if (h.split(/\s+/).filter(Boolean).length < 2) return false;
  return !NOT_A_CLAIM_RE.test(h) && !CUSTOMER_WALL_RE.test(h);
}

const trimOrNull = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

export function derivePositioningCopy(s: HomepageCopySource): PositioningCopy {
  const headingsWhere = (pred: (sec: { heading?: string | null; type?: string | null }) => boolean) =>
    (s.sections ?? [])
      .filter(pred)
      .map((sec) => sec.heading?.trim() ?? "")
      .filter((h) => h.length > 0);

  // Section headings carrying the value proposition, in document order, capped for
  // the glance. Scroll-driven "stepped" layouts repeat a mockup label (e.g. an H3
  // "Product Brief") across every panel, so dedupe case-insensitively and drop any
  // heading recurring 3+ times (a template/UI label, never a distinct highlight).
  //
  // The count is per POOL, never across the two below. Sharing one tally would let a
  // heading the page states once as a feature be dropped because it also appears
  // twice elsewhere, which would REMOVE a highlight that renders today.
  const distinct = (headings: string[]): string[] => {
    const counts = new Map<string, number>();
    for (const h of headings) {
      const k = h.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of headings) {
      const k = h.toLowerCase();
      if ((counts.get(k) ?? 0) >= TEMPLATE_HEADING_REPEATS) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(h);
    }
    return out.slice(0, MAX_VALUE_PROPS);
  };

  // What the classifier is confident about, exactly as before.
  const typed = distinct(
    headingsWhere((sec) => sec.type === "features" || sec.type === "integrations"),
  );

  // Then everything it typed `other`, which is where the value props actually are.
  // `classifySection` only calls a section `features` when its HEADING contains one
  // of a handful of words (features, why, how it works, capabilities, product), and
  // homepages name their sections after the benefit rather than after the word
  // "features": measured on prod 2026-08-01, 2572 of 2943 stored sections (87%) fall
  // through to `other`, and 95 of 158 competitors had no highlight to show at all.
  // The ones it drops are the actual pitch, verbatim: "Stop choosing between speed
  // and control", "PostgreSQL re-engineered for multi-tenant apps".
  //
  // So the selection is inverted. What the classifier is genuinely reliable at is
  // recognising what ISN'T a claim, because those verdicts rest on structure rather
  // than vocabulary: a price pattern, a blockquote, stacked <details>, a button
  // under a closing line. Everything it did not rule out that way is a candidate,
  // `logos` included, since counting images cannot tell a customer wall from a
  // product grid and only the heading can (see CUSTOMER_WALL_RE).
  //
  // Typed hits come FIRST and the cap is applied after, so this can only ever ADD:
  // no competitor loses a highlight that renders today. Verified against all 158
  // stored structures (0 lost, 80 empty sections filled, 62 one-liners completed);
  // 34 of the 63 that "worked" were rendering a single bullet.
  const rest = distinct(
    headingsWhere((sec) => !NEVER_A_VALUE_PROP.has(sec.type ?? "") && isClaimLike(sec.heading)),
  ).filter((h) => !typed.some((t) => t.toLowerCase() === h.toLowerCase()));

  const valueProps = [...typed, ...rest].slice(0, MAX_VALUE_PROPS);
  let headline = trimOrNull(s.hero?.headline);
  let subheadline = trimOrNull(s.hero?.subheadline);

  // The parser reads the hero off `$("h1").first()` and nothing else, and the
  // subheadline branch is itself gated on that H1 existing, so a page with no <h1>
  // loses BOTH at once. That is not a broken capture: Framer, Webflow and hand-built
  // React landing pages routinely title in an <h2> or a styled <div>. Measured on
  // prod 2026-08-01, 9 of 158 stored structures, every one of them a live page whose
  // sections, nav and customer logos parsed fine (asista.com: 150 KB, 37 sections,
  // 16 logos, no H1 anywhere). "How they position" is the section the whole tab
  // opens on, so those competitors read as if we had captured nothing.
  //
  // Their own <title> and og: tags sit in the SAME structure we already stored, so
  // this recovers them at read time and every capture ever taken fixes itself with no
  // re-scrape. It lives in the SHARED derivation rather than in any one caller so the
  // positioning history, the fact sheet and the materialised messaging timeline all
  // derive a "then" capture exactly like a "now" one; splitting them would make the
  // fallback itself look like a rewrite on the day it shipped.
  //
  // Only when both are null. A headline with no subheadline already renders the
  // section and is the state of 66 of those 158, so filling their subheadline from a
  // meta description would rewrite copy for 42% of the roster to reach 6% of it.
  if (!headline && !subheadline) {
    headline = usableHeadCopy(s.openGraph?.title) ?? usableHeadCopy(s.title);
    const sub = usableHeadCopy(s.openGraph?.description) ?? usableHeadCopy(s.metaDescription);
    // <title> and meta description are frequently the same string. Printing it twice,
    // once as the headline and once as the line under it, reads as a rendering bug.
    subheadline = sub && sub.toLowerCase() !== headline?.toLowerCase() ? sub : null;
  }

  return {
    headline,
    subheadline,
    primaryCta: trimOrNull(s.hero?.primaryCta?.text),
    valueProps,
  };
}

/**
 * The key two captures are compared on to decide whether the messaging moved:
 * the HEADLINE and the SUBHEADLINE, and nothing else.
 *
 * Case, punctuation and symbols are stripped: a marketing team fixing a stray
 * period or capitalising a word did not reposition the company, and a timeline
 * that opens a new "version" for it is a timeline nobody reads twice. What
 * survives is the WORDS, which is exactly the thing a repositioning changes.
 *
 * The PRIMARY CTA is stored on every version and is deliberately NOT in the key,
 * which cost a measurement to settle. "Start free trial" becoming "Book a demo"
 * is a real go-to-market move and it was the reason to key on it; run against the
 * 913 stored homepage captures on prod (2026-08-02) it opened 37 extra versions
 * across 19 competitors, and read one by one, essentially none of them were that
 * move. Twelve were a single competitor whose hero button renders "Loading... Jul
 * 1, 2026" - the capture date, so every scrape opened a version. The rest are our
 * own extractor being unstable across captures: a CTA flipping between null and a
 * value, "Server Auction" gaining and losing the icon's alt text, "Privacy Policy"
 * and "View all features arrow_right_alt" being picked up as hero CTAs at all.
 * `homepage-diff` reached the same conclusion from the other direction and already
 * refuses to diff CTAs across parser generations.
 *
 * So a CTA move rides ALONG a rewrite instead of opening one. That gives up the
 * standalone GTM signal; keeping it would have bought that signal at the price of
 * a timeline whose busiest competitor churns daily on a loading state.
 *
 * Value props are out for a plainer reason: they come from section headings, which
 * get renamed constantly on a page whose hero is untouched. The version they are
 * stored on says what the page listed when this wording first appeared, and that
 * is all they are for.
 */
export function messagingFingerprint(copy: PositioningCopy): string {
  const norm = (s: string | null): string =>
    (s ?? "")
      .toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  return [norm(copy.headline), norm(copy.subheadline)].join(" ");
}

/** Whether two captures carry the same messaging, up to a copy edit. */
export function isSameMessaging(a: PositioningCopy, b: PositioningCopy): boolean {
  return messagingFingerprint(a) === messagingFingerprint(b);
}

/** A capture the timeline can be built from. */
export interface MessagingCapture {
  capturedAt: Date;
  /** The R2 key of the capture this wording was read off, when there is one. */
  snapshotKey: string | null;
  copy: PositioningCopy;
}

/**
 * Collapse an OLDEST-FIRST run of captures into the distinct versions of the
 * messaging, each stamped with the capture where that wording FIRST appeared.
 *
 * A homepage is scraped daily and rewritten a handful of times a year, so the
 * raw capture list is hundreds of identical rows. Feeding this the whole chain
 * and inserting the result is what makes the backfill idempotent: the same
 * captures always plan the same rows, at the same timestamps, so a re-run
 * conflicts on every one of them and writes nothing.
 *
 * A capture with no headline at all is skipped rather than stored as a version:
 * a hero we failed to read is not a company that stopped saying anything, and
 * recording it would print a blank "repositioning" in the middle of the timeline.
 */
export function planMessagingVersions(captures: MessagingCapture[]): MessagingCapture[] {
  const versions: MessagingCapture[] = [];
  let previous: string | null = null;
  for (const capture of captures) {
    if (!capture.copy.headline) continue;
    const key = messagingFingerprint(capture.copy);
    if (key === previous) continue;
    previous = key;
    versions.push(capture);
  }
  return versions;
}
