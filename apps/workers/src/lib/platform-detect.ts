import { and, eq } from "drizzle-orm";
import { logger } from "./job-logger";
import { db, competitors, monitors } from "@outrival/db";
import {
  normalizeDomain,
  normalizeHostname,
  extractHostname,
  PLATFORM_PROFILE_VERSION,
  type PlatformProfile,
  type PlatformConfidence,
} from "@outrival/shared";
import { detectPlatform, resolveCnames } from "@outrival/scrapers/platform";
import { fetchTechStackEvidence, extractScriptUrls } from "@outrival/scrapers/tech-stack";
import { atsBoardFromKey, detectAtsBoard, isApiAdapter } from "@outrival/scrapers/jobs-ats";
import { findCareersLink } from "@outrival/scrapers/jobs-careers";
import { logPlatformDetectionRun } from "./analytics";

/**
 * Platform detection orchestrator (patch-31). Pure detection lives in
 * @outrival/scrapers/platform; this owns the I/O + persistence: step A (native
 * GET + optional CNAME), an optional step B (rendered SPA api-capture) when A is
 * thin, then writes competitors.platform_profile and logs the run. NEVER throws —
 * detection is an optimisation; a failure leaves the prior profile untouched.
 */

const enabled = (): boolean => process.env.PLATFORM_DETECTION_ENABLED !== "false";
const dnsEnabled = (): boolean => process.env.PLATFORM_DNS_ENABLED !== "false";
const stepBEnabled = (): boolean => process.env.PLATFORM_STEP_B_ENABLED !== "false";

const RANK: Record<PlatformConfidence, number> = { high: 3, medium: 2, low: 1 };

/**
 * Remember the board a jobs scrape actually READ, so the next run goes straight
 * to its API instead of rediscovering it.
 *
 * Detection can only name a board the page NAMES. An embedded board is named
 * nowhere in the SSR HTML — clickup.com/careers ships an empty `ashby_embed`
 * container — so `enrichAtsFromCareersPage` will never resolve one, and those
 * competitors would pay a browser render on every single jobs run forever. The
 * scrape that did resolve it is the only place the token is ever observed, and
 * it observes it as a fact rather than a guess.
 *
 * Three things this deliberately does NOT do:
 *
 *  - It does not stamp `platformDetectedAt`. That timestamp drives the periodic
 *    30-day re-detection and the drift cooldown, and this is one observed field,
 *    not a detection run. Moving it would silently defer the pass that refreshes
 *    everything else on the profile.
 *  - It does not clear a board on a run that resolved none. One failed fetch is
 *    not a migration, and the existing drift self-heal already covers a board
 *    that stays unreadable: the profile promises an ATS, the scrape doesn't serve
 *    via it, re-detection runs and drops it. Leaving that path untouched is what
 *    keeps a dead board from being preserved forever.
 *  - It does not write a platform with no adapter. `generic` and `teamtailor`
 *    reach the island through schema.org markup, and their "token" is a hostname:
 *    stored as a board key it would send the next run to an API that cannot exist.
 *    `atsBoardFromKey` has to round-trip the key before it is trusted.
 */
export async function rememberAtsBoard(
  competitorId: string,
  provider: string,
  token: string,
): Promise<void> {
  try {
    if (!provider || !token || !isApiAdapter(provider)) return;
    const key = `${provider}:${token}`;
    if (!atsBoardFromKey(key)) return;

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, competitorId),
      columns: { id: true, type: true, platformProfile: true },
    });
    if (!competitor || competitor.type === "self") return;

    const profile = competitor.platformProfile;
    // Already pointing at this board — the fast path is what fetched it.
    if (profile?.ats?.value === key) return;

    const next: PlatformProfile = {
      ...(profile ?? { v: PLATFORM_PROFILE_VERSION, detectedAt: new Date().toISOString() }),
      ats: {
        value: key,
        confidence: "high",
        evidence: [`ats:${provider}:jobs-scrape`],
      },
    };
    await db
      .update(competitors)
      .set({ platformProfile: next, updatedAt: new Date() })
      .where(eq(competitors.id, competitorId));
    logger.log("Learned ATS board from a jobs scrape", { competitorId, board: key });
  } catch (err) {
    // Best-effort like every other write on this path: a memo that fails costs a
    // render next run, it must never cost the extraction that just succeeded.
    logger.warn("ATS board memo skipped (non-fatal)", {
      competitorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface PlatformDetectResult {
  detected: boolean;
  stage?: "a_static" | "b_browser";
  skipped?: string;
}

export async function detectAndPersistPlatform(competitorId: string): Promise<PlatformDetectResult> {
  if (!enabled()) return { detected: false, skipped: "disabled" };

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, competitorId),
    columns: { id: true, url: true, type: true },
  });
  if (!competitor) return { detected: false, skipped: "not_found" };
  if (competitor.type === "self") return { detected: false, skipped: "self" };
  if (!competitor.url) return { detected: false, skipped: "no_url" };

  const url = competitor.url;
  const domain = normalizeDomain(url) ?? "";
  const startedAt = Date.now();

  try {
    // Step A — native GET + optional CNAME. No browser.
    const evidence = await fetchTechStackEvidence(url);
    const cname =
      dnsEnabled() && evidence ? await resolveCnames(extractHostname(evidence.url)) : [];
    let profile = evidence
      ? detectPlatform({
          url: evidence.url,
          html: evidence.html,
          headers: evidence.responseHeaders,
          scriptSrc: evidence.scriptUrls,
          cname,
        })
      : null;
    let stage: "a_static" | "b_browser" = "a_static";

    // Step B — only when A is thin AND the page looks like an empty SPA shell.
    // Reuses the patch-23 runtime capture; the rendered DOM exposes the framework
    // / widgets the static shell hid. Best-effort: a capture failure keeps A.
    if (stepBEnabled() && isThin(profile, evidence?.html ?? "")) {
      const browserProfile = await stepBDetect(url, cname);
      if (browserProfile) {
        profile = profile ? mergeProfiles(profile, browserProfile) : browserProfile;
        stage = "b_browser";
      }
    }

    if (!profile) return { detected: false, skipped: "unfetchable" };

    // Recall boost: the wappalyzer-style detector only emits `changelog` for hosted
    // widgets (canny/headway/beamer) or an advertised RSS <link> — it misses the
    // common self-hosted /changelog page. Scan the homepage HTML we already fetched
    // for a same-origin changelog link and record it as `page:<url>` so the source
    // gets provisioned (below). Only fills in when detection found nothing scrapeable.
    enrichChangelogFromHtml(profile, evidence?.html ?? "", evidence?.url ?? url);
    await enrichAtsFromCareersPage(profile, evidence?.html ?? "", evidence?.url ?? url);

    const now = new Date();
    await db
      .update(competitors)
      .set({ platformProfile: profile, platformDetectedAt: now, updatedAt: now })
      .where(eq(competitors.id, competitorId));

    await logPlatformDetectionRun({
      competitor_id: competitorId,
      domain,
      stage,
      framework: profile.framework?.value ?? "",
      cms: profile.cms?.value ?? "",
      ats: profile.ats?.value ?? "",
      pricing_widget: profile.pricingWidget?.value ?? "",
      status_page: profile.statusPage?.value ?? "",
      changelog: profile.changelog?.value ?? "",
      techs_found: countTechs(profile),
      duration_ms: Date.now() - startedAt,
      recorded_at: now,
    });

    // Provision the sources detection resolved to a structured connector:
    // changelog (scrapeable page/RSS) and status (status page). Both are seeded
    // here so they stop depending on a manual enable nobody ever performs.
    await seedDetectedSources(competitorId, url, profile);

    return { detected: true, stage };
  } catch (err) {
    // Never let detection break a caller (competitor-add, scheduler). Leave the
    // prior profile in place and move on.
    logger.warn("Platform detection failed (non-fatal)", {
      competitorId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { detected: false, skipped: "error" };
  }
}

// A profile is "thin" when nothing meaningful was found AND the page body is a
// near-empty shell — the signature of a client-rendered SPA worth a browser pass.
function isThin(profile: PlatformProfile | null, html: string): boolean {
  const noStack = !profile?.framework && !profile?.cms && !profile?.ats;
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return noStack && bodyText.length < 500;
}

async function stepBDetect(url: string, cname: string[]): Promise<PlatformProfile | null> {
  try {
    // Lazy import: pulls Patchright (Chromium) only on the rare step B, like
    // scrape-monitor's api-capture path. Returns rendered HTML we re-detect on.
    const { scrapeWithApiCapture } = await import("@outrival/scrapers");
    const cap = await scrapeWithApiCapture(url);
    return detectPlatform({
      url,
      html: cap.html,
      headers: {}, // capture doesn't surface response headers — DOM/scripts only
      scriptSrc: extractScriptUrls(cap.html, url),
      cname,
    });
  } catch (err) {
    logger.warn("Platform step-B capture failed (non-fatal)", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const SINGLE_FIELDS = [
  "framework",
  "cms",
  "hosting",
  "cdn",
  "ats",
  "pricingWidget",
  "statusPage",
  "changelog",
] as const;

function mergeProfiles(a: PlatformProfile, b: PlatformProfile): PlatformProfile {
  const out: PlatformProfile = { ...a };
  for (const k of SINGLE_FIELDS) {
    const bv = b[k];
    const av = out[k];
    if (bv && (!av || RANK[bv.confidence] >= RANK[av.confidence])) out[k] = bv;
  }
  const analytics = [...(a.analytics ?? [])];
  for (const x of b.analytics ?? []) {
    if (!analytics.some((y) => y.value === x.value)) analytics.push(x);
  }
  if (analytics.length > 0) out.analytics = analytics;
  out.detectedAt = new Date().toISOString();
  return out;
}

function countTechs(profile: PlatformProfile): number {
  let n = profile.analytics?.length ?? 0;
  for (const k of SINGLE_FIELDS) if (profile[k]) n++;
  return n;
}

// A changelog value the changelog scraper can actually fetch: an RSS feed or a
// concrete page URL. Hosted-widget tokens (canny/headway/beamer) are not.
function scrapeableChangelogUrl(value: string | undefined): string | null {
  if (value?.startsWith("rss:")) return value.slice(4);
  if (value?.startsWith("page:")) return value.slice(5);
  return null;
}

// A changelog keyword either as a full path segment or as the subdomain label. Kept
// conservative (full-segment match, no bare "/updates") so the auto-seeder doesn't
// latch onto a "/product-updates" blog link.
const CHANGELOG_PATH_RE = /(^|\/)(changelog|releases|release-notes|whats-new)(\/|$)/i;
const CHANGELOG_HOST_RE = /^(changelog|releases|release-notes|whats-new)\./i;

function findChangelogLink(html: string, pageUrl: string): string | null {
  // Same registrable domain (not same origin) so a "changelog.acme.com" or
  // "docs.acme.com/changelog" subdomain still counts, while a link off to another
  // company is rejected.
  const pageDomain = normalizeHostname(pageUrl);
  if (!pageDomain) return null;
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (!href) continue;
    let abs: URL;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (normalizeHostname(abs.hostname) !== pageDomain) continue;
    if (CHANGELOG_HOST_RE.test(abs.hostname) || CHANGELOG_PATH_RE.test(abs.pathname)) {
      return abs.toString();
    }
  }
  return null;
}

/**
 * ATS recall boost. Detection runs on the homepage, but a company's ATS link
 * (Welcome to the Jungle, Greenhouse, …) frequently lives only on the careers page
 * one hop away (a footer "Nous rejoindre" → /jobs → the ATS board). When the
 * homepage yielded no ATS, follow the strongest SAME-host careers link with a
 * single native GET and re-run board detection on it, so the jobs source can take
 * the render-free structured-API fast path (competitors.platform_profile.ats →
 * jobs scraper). A cross-host ATS link would already be visible in the homepage
 * HTML (detectAtsBoard ran on it), so only same-host subpages are worth a fetch.
 * Mutates `profile.ats` in place; best-effort, never throws.
 */
async function enrichAtsFromCareersPage(
  profile: PlatformProfile,
  homepageHtml: string,
  homepageUrl: string,
): Promise<void> {
  if (profile.ats) return;
  const link = findCareersLink(homepageHtml, homepageUrl);
  if (!link) return;
  try {
    const target = new URL(link);
    const home = new URL(homepageUrl);
    if (target.hostname !== home.hostname) return; // cross-host ATS is caught on the homepage
    // A careers link that points back at the page we already have would just refetch it.
    if (target.pathname.replace(/\/+$/, "") === home.pathname.replace(/\/+$/, "")) return;
    const evidence = await fetchTechStackEvidence(link);
    if (!evidence) return;
    const board = detectAtsBoard(evidence.html);
    if (!board) return;
    profile.ats = {
      value: `${board.provider}:${board.token}`,
      confidence: "high",
      evidence: [`ats:${board.provider}:careers-page`],
    };
  } catch {
    // best-effort — leave profile.ats unset, the jobs scraper still detects at scrape time
  }
}

/** Fill `profile.changelog` with a self-hosted page URL when detection found no
 *  scrapeable changelog. Mutates in place; a no-op when a URL is already present. */
function enrichChangelogFromHtml(profile: PlatformProfile, html: string, pageUrl: string): void {
  if (scrapeableChangelogUrl(profile.changelog?.value)) return;
  const link = findChangelogLink(html, pageUrl);
  if (!link) return;
  profile.changelog = {
    value: `page:${link}`,
    confidence: "low",
    evidence: ["html:changelog-link"],
  };
}

/** Insert a weekly monitor for `sourceType` unless one already exists. Idempotent
 *  (one per competitor+source); returns whether a row was created. */
async function seedMonitorOnce(
  competitorId: string,
  sourceType: "changelog" | "status",
  config: { url: string },
): Promise<boolean> {
  const existing = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, sourceType)),
    columns: { id: true },
  });
  if (existing) return false;
  await db.insert(monitors).values({ competitorId, sourceType, frequency: "weekly", config });
  return true;
}

/** Provision the sources platform detection can resolve to a connector. Never
 *  throws — a seeding failure must not break detection.
 *  - changelog: seeded when a scrapeable URL was found (page/RSS). Ungated → runs
 *    on every plan.
 *  - status: seeded when a status page was detected; the connector resolves its
 *    host from profile.statusPage at scrape time, so the competitor URL is only the
 *    fetch fallback here. Plan-gated (starter+) → schedule-scraping freezes the
 *    monitor until the org is entitled, then it activates on upgrade with no
 *    re-detection needed. */
async function seedDetectedSources(
  competitorId: string,
  competitorUrl: string,
  profile: PlatformProfile,
): Promise<void> {
  try {
    const changelogUrl = scrapeableChangelogUrl(profile.changelog?.value);
    if (changelogUrl && (await seedMonitorOnce(competitorId, "changelog", { url: changelogUrl }))) {
      logger.log("Seeded changelog monitor from platform detection", { competitorId, url: changelogUrl });
    }
    if (profile.statusPage?.value && (await seedMonitorOnce(competitorId, "status", { url: competitorUrl }))) {
      logger.log("Seeded status monitor from platform detection", { competitorId });
    }
  } catch (err) {
    logger.warn("Seeding detected-source monitors failed (non-fatal)", {
      competitorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
