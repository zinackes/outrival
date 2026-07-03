import { detectAll } from "tinyld";

// Below this many characters of real copy we don't trust statistical detection —
// a 3-word headline can trigram-match almost any language — and keep the declared
// <html lang> instead.
const MIN_SAMPLE_CHARS = 40;
// tinyld normalizes accuracy to 0..1 across candidates; the top guess must clear
// this before it's allowed to override the declared attribute. English homepage
// copy scores ~0.9+, a real foreign page ~0.6, so 0.3 rejects only noise.
const MIN_ACCURACY = 0.3;

/**
 * Detect the language of homepage copy from the text itself rather than the
 * `<html lang>` attribute. That attribute lies constantly — sites ship a
 * boilerplate `lang="fr"` (leftover template default, agency build, multi-locale
 * site whose fallback is French) on copy that's plainly English, which then gets
 * flagged as foreign and offered a bogus "Translate to English".
 *
 * Falls back to the declared attribute when there isn't enough text to detect
 * reliably (image-only hero, sparse page).
 *
 * Returns a lowercased ISO 639-1 subtag ("en", "fr", …) or null.
 */
export function detectLanguage(sample: string, declared: string | null): string | null {
  const text = sample.replace(/\s+/g, " ").trim();
  if (text.length < MIN_SAMPLE_CHARS) return declared;
  const top = detectAll(text)[0];
  if (!top || top.accuracy < MIN_ACCURACY) return declared;
  return top.lang.toLowerCase();
}
