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
import { quickFetchText } from "@outrival/scrapers/quick-fetch";
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
  let text: string;
  try {
    text = await quickFetchText(url);
  } catch (e) {
    return { ok: false, reason: "fetch_failed", detail: String(e) };
  }
  if (text.length < 100) return { ok: false, reason: "too_short" };
  return derive(() => fromUrl(text));
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
 */
export function productProfileToSelfProfile(pp: ProductProfile | null | undefined): SelfProfile {
  const seed = <T,>(value: T | null | undefined): SelfProfileField<T> | undefined =>
    value == null || (typeof value === "string" && value.trim() === "")
      ? undefined
      : { value, isFromAutoDetect: true, lastEditedByUserAt: null };
  return {
    category: seed(pp?.category),
    audience: seed(pp?.audience),
    valueProp: seed(pp?.valueProp),
  };
}

/** A display name for a product's anchor: the profile-less URL host, else the name. */
export function productAnchorName(url: string | null | undefined, fallback: string): string {
  return (url ? normalizeHostname(url) : null) ?? fallback;
}
