// Product-profile derivation — the session-less core behind onboarding's analyze-*
// routes, reused by the "add product" wizard (patch-28 multi-SKU). Each function turns
// one input (a live URL, a description, a GitHub repo, an uploaded document) into a
// ProductProfile, catching provider/parse failures into a typed reason so callers can
// map them to their own HTTP responses. No auth, no DB writes — pure derivation.
import {
  fromDescription,
  fromDocument,
  fromRepo,
  fromUrl,
  type ProductProfile,
} from "@outrival/ai";
import type { SelfProfile, SelfProfileField } from "@outrival/db";
import { normalizeHostname } from "@outrival/shared";
import { quickFetch, quickFetchText } from "@outrival/scrapers/quick-fetch";
import { discoverCommerceCandidates, discoverPricingUrl } from "@outrival/scrapers/pricing";
import { fetchRepoArtifacts } from "./github";
import { extractDocumentText } from "./extract-document";

export type DeriveFailure =
  | "fetch_failed"
  | "too_short"
  | "repo_not_found"
  | "repo_invalid_url"
  | "repo_unreadable"
  | "unreadable_document"
  | "derive_failed";

export type DeriveResult =
  | { ok: true; profile: ProductProfile }
  | { ok: false; reason: DeriveFailure; detail?: string };

// A profile extractor failing two ways — a parse miss (null) or a provider error (an
// empty/rate-limited completion throws at the provider boundary) — both mean the same
// thing: we couldn't derive a profile. Degrade to a typed `derive_failed`.
async function derive(fn: () => Promise<ProductProfile | null>): Promise<DeriveResult> {
  try {
    const profile = await fn();
    return profile ? { ok: true, profile } : { ok: false, reason: "derive_failed" };
  } catch (err) {
    console.error("[profile-derivation] derive failed:", err);
    return { ok: false, reason: "derive_failed" };
  }
}

/** Mode: live — fetch the homepage text and extract a profile from it. */
export async function deriveProfileFromUrl(url: string): Promise<DeriveResult> {
  let html: string;
  let text: string;
  try {
    ({ html, text } = await quickFetch(url));
  } catch (e) {
    return { ok: false, reason: "fetch_failed", detail: String(e) };
  }
  if (text.length < 100) return { ok: false, reason: "too_short" };
  const pricingText = await fetchPricingText(url, html);
  return derive(() => fromUrl(text, pricingText));
}

/**
 * Best-effort: resolve the product's dedicated pricing page from the homepage and
 * fetch its text, so onboarding's `pricingModel` is grounded on the real price grid
 * rather than a homepage that rarely shows prices (e.g. Neon). Everything degrades
 * to `undefined` — no pricing page found, a JS-only page too thin for a plain fetch,
 * a block — and the profiler simply falls back to the homepage. Never throws.
 */
async function fetchPricingText(url: string, homepageHtml: string): Promise<string | undefined> {
  try {
    const candidate = await discoverPricingUrl(url, homepageHtml);
    // homepage_section → prices already in the homepage text the profiler gets.
    if (candidate) {
      return candidate.source === "homepage_section" ? undefined : await quickFetchText(candidate.url);
    }
    // No dedicated pricing page. A catalog site — e-commerce, an equipment
    // installer, hosting — spreads its prices across product pages instead, so the
    // homepage carries no price at all and `pricingModel` came back empty. Reuse the
    // same catalog discovery the pricing scraper runs, and ground the profile on the
    // densest-priced product page. Costs a few L0 GETs, and only on this path (a
    // homepage with < 2 commerce links probes nothing).
    const [topProductPage] = await discoverCommerceCandidates(url, homepageHtml);
    return topProductPage ? await quickFetchText(topProductPage.url) : undefined;
  } catch {
    return undefined;
  }
}

/** Mode: idea — extract a profile from a free-text description (+ optional hints). */
export async function deriveProfileFromDescription(input: {
  description: string;
  category?: string;
  inspirations?: string[];
}): Promise<DeriveResult> {
  return derive(() => fromDescription(input));
}

/** Mode: developing — read a public GitHub repo and extract a profile from it. */
export async function deriveProfileFromRepo(repoUrl: string): Promise<DeriveResult> {
  const artifacts = await fetchRepoArtifacts(repoUrl);
  if (!artifacts.ok) {
    const reason: DeriveFailure =
      artifacts.error === "not_found"
        ? "repo_not_found"
        : artifacts.error === "invalid_url"
          ? "repo_invalid_url"
          : "repo_unreadable";
    return { ok: false, reason };
  }
  return derive(() => fromRepo(artifacts.value));
}

/** Mode: document — extract a profile from an uploaded spec (bytes never persisted). */
export async function deriveProfileFromDocument(
  bytes: Uint8Array,
  fileName: string,
  fileType: string,
): Promise<DeriveResult> {
  const extracted = await extractDocumentText(bytes, fileName, fileType);
  if (!extracted.ok) {
    return { ok: false, reason: "unreadable_document", detail: extracted.error };
  }
  return derive(() => fromDocument(extracted.value));
}

/**
 * Map a ProductProfile to the editable SelfProfile seeded on a self-competitor — the
 * single source of truth so onboarding's self and a wizard-added product's self are
 * seeded identically (auto-detected, not user-edited). null/blank fields are omitted.
 *
 * `keywords` seeds `features`: it is the one derived field that discovery reads
 * directly (`buildDiscoveryQuery` appends it to the Exa query), and until now the AI
 * produced it on every analyze and nothing ever stored it, so a 2nd+ SKU searched on a
 * strictly poorer query than onboarding did. `features` is the slot
 * `selfProfileToDiscoveryProfile` already reads keywords back out of, so seeding it
 * closes the loop without a new field.
 */
export function productProfileToSelfProfile(pp: ProductProfile | null | undefined): SelfProfile {
  const seed = <T,>(value: T | null | undefined): SelfProfileField<T> | undefined =>
    value == null || (typeof value === "string" && value.trim() === "")
      ? undefined
      : { value, isFromAutoDetect: true, lastEditedByUserAt: null };
  const keywords = pp?.keywords?.map((k) => k.trim()).filter(Boolean);
  return {
    category: seed(pp?.category),
    audience: seed(pp?.audience),
    valueProp: seed(pp?.valueProp),
    whatItDoes: seed(pp?.whatItDoes),
    pricingModel: seed(pp?.pricingModel),
    features: seed(keywords?.length ? keywords : undefined),
  };
}

/** A display name for a product's anchor: the profile-less URL host, else the name. */
export function productAnchorName(url: string | null | undefined, fallback: string): string {
  return (url ? normalizeHostname(url) : null) ?? fallback;
}
