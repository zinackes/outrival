import { COMPETITOR_NAME_MAX_LENGTH } from "@outrival/shared";

/**
 * Client-side validation for the add-competitor dialog.
 *
 * The dialog used to lean on the browser: `required` on the name, `type="url"` on
 * the URL. Both refusals are silent inside a Radix dialog — no error text, no
 * `aria-invalid`, and no request ever leaves — so an empty submit or a typed
 * "example.com" looked like a dead button (`ux:04`). This module is the explicit
 * gate that replaces them, kept pure and out of the component so the rules are
 * testable.
 *
 * It mirrors what `POST /api/competitors` accepts (name 1…60, an absolute http(s)
 * URL) and stops there: the server still runs the SSRF and plan-limit checks, and
 * those refusals surface through the dialog's existing error slot.
 */

export interface CompetitorFormErrors {
  name?: string;
  url?: string;
}

export interface CompetitorFormResult {
  errors: CompetitorFormErrors;
  /** The payload to send, present only when `errors` is empty. */
  values?: { name: string; url: string };
}

/**
 * Turns what a user types into an absolute http(s) URL, or null when it can't be
 * one. A bare host is the common case ("example.com"): the scheme is what people
 * leave out, so it is added rather than treated as a mistake.
 */
export function normalizeCompetitorUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // Credentials in the URL are never something a user means to monitor, and a
  // hostname with no dot is an intranet name, not a competitor's site.
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname.includes(".") || parsed.hostname.endsWith(".")) return null;
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

export function validateCompetitorForm(input: {
  name: string;
  url: string;
}): CompetitorFormResult {
  const errors: CompetitorFormErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "Enter the competitor's name.";
  else if (name.length > COMPETITOR_NAME_MAX_LENGTH) {
    errors.name = `Keep the name under ${COMPETITOR_NAME_MAX_LENGTH} characters.`;
  }

  const url = normalizeCompetitorUrl(input.url);
  if (!input.url.trim()) errors.url = "Enter the competitor's website.";
  else if (!url) errors.url = "That doesn't look like a website address. Try example.com.";

  if (errors.name || errors.url || !url) return { errors };
  return { errors: {}, values: { name, url } };
}
