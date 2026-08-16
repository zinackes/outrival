import { SERIES_TOKENS } from "./competitor-color";

/**
 * The letters drawn on a competitor's tile when no favicon paints.
 *
 * One initial is not an identity. A workspace tracking Cloudsmith, Codeium and
 * Cosyra drew three identical "C" tiles, and the list's leading column — the one
 * the eye actually scans — said nothing about who moved (OUT-179). Two letters
 * separate most collisions on their own; the pairs they don't separate (Codeium
 * and Cosyra both give "CO") are told apart by the tile's hue, see
 * competitorFallbackColor.
 *
 * A multi-word name takes the first letter of each of its first two words, so
 * "Azure Artifacts" and "AWS CodeArtifact" read "AA" and "AC" rather than both
 * "A". A camelCase brand counts as two words for the same reason — a reader sees
 * "CodeArtifact" as two.
 */
export function competitorInitials(name: string): string {
  const words = name
    .trim()
    // camelCase / PascalCase boundary. Written as a capture-group swap rather
    // than a lookbehind: a lookbehind is a PARSE error on Safari below 16.4, so
    // it would take the whole bundle down rather than degrade.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * The palette hue a competitor wears when nobody assigned it one — derived from
 * its name, so it is stable across renders, sessions and surfaces without a
 * round trip.
 *
 * Most workspaces never open the colour picker, which is exactly the workspace
 * the avatar collision was reported in: every unassigned competitor fell back to
 * the same neutral tile. Borrowing a hue is the same trick a compared set already
 * plays (assignSeriesColors) — the difference is that this one needs no set to
 * position itself in, since a row knows only its own competitor.
 */
export function competitorFallbackColor(name: string): string {
  // FNV-1a, for a spread that does not clump on names sharing a first letter.
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return SERIES_TOKENS[(hash >>> 0) % SERIES_TOKENS.length]!;
}
