import { eq } from "drizzle-orm";
import { logger } from "@trigger.dev/sdk/v3";
import { db, competitors } from "@outrival/db";
import {
  normalizeDomain,
  extractHostname,
  type PlatformProfile,
  type PlatformConfidence,
} from "@outrival/shared";
import { detectPlatform, resolveCnames } from "@outrival/scrapers/platform";
import { fetchTechStackEvidence, extractScriptUrls } from "@outrival/scrapers/tech-stack";
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
