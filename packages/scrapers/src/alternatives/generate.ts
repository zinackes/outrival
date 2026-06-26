import type { FailureCategory } from "../lib/diagnose-failure";
import { realisticHeaders, realisticUserAgent } from "../lib/fingerprint";

/**
 * Generate user-facing alternatives for a monitor that became unscrapable
 * (patch-23). The source is auto-paused when it reaches this state, so there is
 * no "pause this source" option to offer — we always offer manual data entry and,
 * depending on the failure diagnosis, one or more concrete URL alternatives or a
 * replace-competitor hint. "Resume anyway" lives on the panel itself, not here.
 *
 * fetch-only (no Patchright) so the `@outrival/scrapers/alternatives` subpath
 * stays light enough to import from the worker without pulling Chromium.
 */

export type AlternativeType =
  | "different_url"
  | "manual_data_entry"
  | "pause_source"
  | "replace_competitor";

export interface AlternativeProposal {
  type: AlternativeType;
  description: string;
  suggestedUrl?: string;
  rationale: string;
}

const MAX_URL_ALTERNATIVES = 2;

export async function generateAlternatives(
  monitorUrl: string | null,
  category: FailureCategory,
): Promise<AlternativeProposal[]> {
  const proposals: AlternativeProposal[] = [];

  // Always available, regardless of the failure. The source is already paused at
  // this point, so manual entry is the only always-on recovery option here
  // (resuming is offered separately on the panel).
  proposals.push({
    type: "manual_data_entry",
    description: "Enter the key information manually",
    rationale: "You stay in control of what's tracked for this competitor.",
  });

  switch (category) {
    case "login_required":
    case "geo_blocked": {
      if (monitorUrl) {
        const reachable = await findPublicAlternatives(monitorUrl);
        for (const url of reachable.slice(0, MAX_URL_ALTERNATIVES)) {
          proposals.push({
            type: "different_url",
            description: `Follow ${url} instead`,
            suggestedUrl: url,
            rationale:
              "This public page of the same product likely carries similar information.",
          });
        }
      }
      break;
    }
    case "site_dead":
    case "site_redirected": {
      proposals.push({
        type: "replace_competitor",
        description: "This competitor seems to have disappeared or pivoted",
        rationale: "You can remove it or replace it with another competitor.",
      });
      break;
    }
    // spa_empty → the runtime API capture path handles it; no alternative here.
    // anti_bot → the cascade already escalates; nothing user-actionable to add.
    // unknown → only the two safe options above.
    default:
      break;
  }

  return proposals;
}

/**
 * Probe a handful of conventional public paths of the same product and return
 * the ones that respond. Best-effort and quick: each probe is a short GET, and a
 * failed probe simply drops the candidate.
 */
async function findPublicAlternatives(originalUrl: string): Promise<string[]> {
  let base: URL;
  try {
    base = new URL(originalUrl);
  } catch {
    return [];
  }
  const host = base.hostname.replace(/^www\./, "");
  const origin = `${base.protocol}//${base.hostname}`;
  const candidates = [
    `${origin}/blog`,
    `${origin}/changelog`,
    `${origin}/docs`,
    `${origin}/about`,
    `${base.protocol}//blog.${host}`,
  ].filter((url) => url !== originalUrl.replace(/\/+$/, ""));

  const results = await Promise.all(
    candidates.map(async (url) => ((await isQuicklyReachable(url)) ? url : null)),
  );
  return results.filter((url): url is string => url !== null);
}

async function isQuicklyReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { ...realisticHeaders(), "User-Agent": realisticUserAgent() },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    return res.status < 400;
  } catch {
    return false;
  }
}
