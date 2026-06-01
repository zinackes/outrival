import { createHash } from "node:crypto";
import { diffLines, type Change as DiffChange } from "diff";

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Strips per-request volatile tokens from HTML before change detection. CSRF
 * tokens, CSP nonces, and anti-forgery inputs are regenerated on every page
 * load; left in place they flip the content hash and produce a spurious change
 * row + reschedule + classification on every single scrape.
 *
 * Apply symmetrically to BOTH sides of the diff and to the hash input. Never
 * apply it to what we persist to R2 — extractors still need the raw HTML.
 */
export function normalizeHtmlForDiff(html: string): string {
  return html
    // CSRF / XSRF / verification token meta tags (any attribute order).
    .replace(
      /<meta\b[^>]*\bname=["'](?:csrf-token|csrf_token|csrf-param|_csrf|xsrf-token|x-csrf-token|authenticity_token|request-id|x-request-id|trace-id)["'][^>]*>/gi,
      "",
    )
    // Hidden CSRF / anti-forgery inputs.
    .replace(
      /<input\b[^>]*\bname=["'](?:_csrf|csrf_token|csrf-token|authenticity_token|__RequestVerificationToken|xsrf|_token)["'][^>]*>/gi,
      "",
    )
    // CSP nonces on script/style/link tags.
    .replace(/\snonce=["'][^"']*["']/gi, "")
    // Common token assignments inside inline scripts / JSON state.
    .replace(
      /["']?(?:csrf[-_]?token|csrfToken|xsrfToken|authenticity_token)["']?\s*[:=]\s*["'][^"']*["']/gi,
      "",
    )
    .trim();
}

export interface TextDiffResult {
  hasChanges: boolean;
  added: string[];
  removed: string[];
  diffText: string;
}

export function computeTextDiff(before: string, after: string): TextDiffResult {
  const changes: DiffChange[] = diffLines(before, after);
  const added: string[] = [];
  const removed: string[] = [];

  for (const part of changes) {
    if (part.added) added.push(part.value.trim());
    if (part.removed) removed.push(part.value.trim());
  }

  const diffText = [
    ...removed.map((l) => `- ${l}`),
    ...added.map((l) => `+ ${l}`),
  ].join("\n");

  return {
    hasChanges: added.length > 0 || removed.length > 0,
    added,
    removed,
    diffText,
  };
}
