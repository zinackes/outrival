// Per-competitor color identity (user-assignable, shown across the app, adapts to
// dark/light). The product stores ONE value per competitor — either a palette token
// below or a custom `#rrggbb` hex — and the UI derives the dark/light appearance in
// CSS: only the OKLCH *hue* + *chroma* (the color's identity) live here; the per-theme
// *lightness* is set in globals.css (the same split the existing `--cat-*` scale uses).
// Null/absent = neutral (no color), the default look.

export type CompetitorColor = {
  /** Stable token persisted in the DB and used as the zod enum value. */
  token: string;
  /** Human label for the picker UI. */
  label: string;
  /** OKLCH hue in degrees [0, 360). */
  hue: number;
  /** OKLCH chroma — the color's saturation identity (lightness comes from the theme). */
  chroma: number;
};

// Curated palette (~12). Hues spread around the wheel; chroma tuned so each reads as a
// distinct, vivid-but-not-clipping accent once the theme applies its lightness.
export const COMPETITOR_COLORS = [
  { token: "indigo", label: "Indigo", hue: 277, chroma: 0.14 },
  { token: "sky", label: "Sky", hue: 237, chroma: 0.13 },
  { token: "cyan", label: "Cyan", hue: 210, chroma: 0.12 },
  { token: "teal", label: "Teal", hue: 185, chroma: 0.11 },
  { token: "emerald", label: "Emerald", hue: 160, chroma: 0.13 },
  { token: "lime", label: "Lime", hue: 128, chroma: 0.14 },
  { token: "amber", label: "Amber", hue: 75, chroma: 0.14 },
  { token: "orange", label: "Orange", hue: 55, chroma: 0.15 },
  { token: "rose", label: "Rose", hue: 13, chroma: 0.15 },
  { token: "pink", label: "Pink", hue: 350, chroma: 0.15 },
  { token: "violet", label: "Violet", hue: 300, chroma: 0.15 },
  { token: "slate", label: "Slate", hue: 250, chroma: 0.025 },
] as const satisfies readonly CompetitorColor[];

export type CompetitorColorToken = (typeof COMPETITOR_COLORS)[number]["token"];

export const COMPETITOR_COLOR_TOKENS = COMPETITOR_COLORS.map((c) => c.token) as [
  CompetitorColorToken,
  ...CompetitorColorToken[],
];

const TOKEN_MAP = new Map<string, CompetitorColor>(
  COMPETITOR_COLORS.map((c) => [c.token, c]),
);

const HEX6 = /^#[0-9a-fA-F]{6}$/;

// Cap custom-hex chroma so a neon pick can't blow out on either surface; the theme
// still drives lightness, so we only need the hue + a sane saturation.
const MAX_CHROMA = 0.16;

/** sRGB hex (#rrggbb) → OKLCH hue (deg) + chroma. Pure, zero-dep. */
export function hexToOklch(hex: string): { h: number; c: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);

  // linear sRGB → OKLab (Björn Ottosson's matrices)
  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  const c = Math.min(MAX_CHROMA, Math.sqrt(a * a + bb * bb));
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { h, c };
}

/**
 * Normalize a stored color value (palette token or `#rrggbb`) into the OKLCH hue +
 * chroma the UI applies via CSS. Returns null for null/empty/invalid input — the
 * caller renders the neutral (no-color) look.
 */
export function resolveCompetitorColor(
  value: string | null | undefined,
): { h: number; c: number } | null {
  if (!value) return null;
  const entry = TOKEN_MAP.get(value);
  if (entry) return { h: entry.hue, c: entry.chroma };
  if (HEX6.test(value)) return hexToOklch(value);
  return null;
}

/** True when a value is a known palette token or a valid 6-digit hex (API validation). */
export function isValidCompetitorColor(value: string): boolean {
  return TOKEN_MAP.has(value) || HEX6.test(value);
}
