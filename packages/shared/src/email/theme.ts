// Email palette — light-authored, dark-overridden.
//
// Why light is the base: it is the only rendering every client honors. Clients
// that do nothing (Gmail webmail, Yahoo, Outlook classic) show exactly what we
// author, clients that honor `prefers-color-scheme` get the dark block below,
// and the ones that force their own inversion (Gmail iOS/Android — untargetable
// by any CSS) *degrade* a light email instead of breaking it. An already-dark
// email is the one case forced-dark mangles, which is what we shipped before.
//
// Mechanics: a media query in <head> cannot beat an inline `style=""` attribute
// without `!important`, so every element carries BOTH its light inline style
// (for the clients that strip <style>) and a class the shell's dark block
// overrides. `e()` below emits the pair so the two can't drift apart.
//
// The VALUES are the product's own tokens from apps/web/src/app/globals.css, not
// a second palette that happens to look similar — the email used Tailwind zinc
// with an indigo accent, and indigo is the DARK-mode accent, so the light render
// (the one most clients show) was a color the light product doesn't contain.
// Email has no `oklch()`, so the OKLCH tokens are gamut-mapped to sRGB by chroma
// reduction, which is what a browser does with the same declaration.

export const EMAIL_LIGHT = {
  canvas: "#f9fafb", // --background   oklch(0.985 0.002 260)
  surface: "#fefeff", // --surface      oklch(0.998 0.001 260)
  surfaceAlt: "#f0f2f4", // --surface-2    oklch(0.96 0.004 260)
  border: "#dcdee1", // --border       oklch(0.9 0.005 260)
  text: "#181b1f", // --foreground   oklch(0.22 0.01 260)
  muted: "#535861", // --muted        oklch(0.46 0.015 260)
  faint: "#696e76", // --muted-3      oklch(0.535 0.014 260)
  // One rationed cyan for both the fill and accent text. The product splits
  // --accent from --link by 0.017 L; at that distance the link value measures
  // 4.48:1 on the canvas, so email keeps the single darker step (4.85:1) rather
  // than shipping a token that misses AA by a rounding error.
  accent: "#007b80", // --accent       oklch(0.53 0.14 200)
  accentText: "#007b80",
  onAccent: "#ffffff", // --accent-foreground
  // The five-step severity scale, verbatim from :root. Tailwind-700 level: each
  // clears 4.5:1 as text on the light canvas and under white as a solid fill.
  sevCritical: "#b91c1c",
  sevHigh: "#c2410c",
  sevMedium: "#a16207",
  sevLow: "#52525b",
  sevPositive: "#047857",
} as const;

export const EMAIL_DARK = {
  canvas: "#0a0a0a", // --background
  surface: "#161616", // --surface
  surfaceAlt: "#1d1d1d", // --surface-2
  // --border is rgba(255,255,255,0.1). Email clients render alpha borders
  // inconsistently (and Outlook not at all), so the composite over --surface is
  // stored flat — the value the web actually paints on a card edge.
  border: "#2d2d2d",
  text: "#f2f5f8", // --foreground
  muted: "#9aa2ad", // --muted
  faint: "#79808c", // --muted-3
  accent: "#6c5dfd", // --accent (Iris)
  accentText: "#9a8cff", // --link
  onAccent: "#ffffff", // --accent-foreground — pure white, see globals.css
  sevCritical: "#ff5c72",
  sevHigh: "#ff8a5b",
  sevMedium: "#ffc247",
  sevLow: "#5b9cff",
  sevPositive: "#34d399",
} as const;

// One semantic role → its class, its light declarations, its dark overrides.
// The dark side is emitted as CSS by the shell; nothing else may hardcode it.
//
// The severity roles come in pairs: `critical` colors text, `dotCritical` fills a
// swatch. DESIGN.md §2 — severity is reinforced with a label AND a mark, never
// hue alone, so a client that drops color still shows the band.
const ROLES = {
  bg: {
    light: `background-color:${EMAIL_LIGHT.canvas};`,
    dark: `background-color:${EMAIL_DARK.canvas} !important;`,
  },
  card: {
    light: `background-color:${EMAIL_LIGHT.surface};border:1px solid ${EMAIL_LIGHT.border};`,
    dark: `background-color:${EMAIL_DARK.surface} !important;border-color:${EMAIL_DARK.border} !important;`,
  },
  // A tonal step off the canvas with no border — the quiet fill behind a stat
  // strip. Depth by tonal layering, not by another box (DESIGN.md §4).
  panel: {
    light: `background-color:${EMAIL_LIGHT.surfaceAlt};`,
    dark: `background-color:${EMAIL_DARK.surfaceAlt} !important;`,
  },
  text: {
    light: `color:${EMAIL_LIGHT.text};`,
    dark: `color:${EMAIL_DARK.text} !important;`,
  },
  muted: {
    light: `color:${EMAIL_LIGHT.muted};`,
    dark: `color:${EMAIL_DARK.muted} !important;`,
  },
  faint: {
    light: `color:${EMAIL_LIGHT.faint};`,
    dark: `color:${EMAIL_DARK.faint} !important;`,
  },
  accent: {
    light: `color:${EMAIL_LIGHT.accentText};`,
    dark: `color:${EMAIL_DARK.accentText} !important;`,
  },
  btn: {
    light: `background-color:${EMAIL_LIGHT.accent};color:${EMAIL_LIGHT.onAccent};`,
    dark: `background-color:${EMAIL_DARK.accent} !important;color:${EMAIL_DARK.onAccent} !important;`,
  },
  rule: {
    light: `border-color:${EMAIL_LIGHT.border};`,
    dark: `border-color:${EMAIL_DARK.border} !important;`,
  },
  critical: {
    light: `color:${EMAIL_LIGHT.sevCritical};`,
    dark: `color:${EMAIL_DARK.sevCritical} !important;`,
  },
  high: {
    light: `color:${EMAIL_LIGHT.sevHigh};`,
    dark: `color:${EMAIL_DARK.sevHigh} !important;`,
  },
  medium: {
    light: `color:${EMAIL_LIGHT.sevMedium};`,
    dark: `color:${EMAIL_DARK.sevMedium} !important;`,
  },
  low: {
    light: `color:${EMAIL_LIGHT.sevLow};`,
    dark: `color:${EMAIL_DARK.sevLow} !important;`,
  },
  positive: {
    light: `color:${EMAIL_LIGHT.sevPositive};`,
    dark: `color:${EMAIL_DARK.sevPositive} !important;`,
  },
  dotCritical: {
    light: `background-color:${EMAIL_LIGHT.sevCritical};`,
    dark: `background-color:${EMAIL_DARK.sevCritical} !important;`,
  },
  dotHigh: {
    light: `background-color:${EMAIL_LIGHT.sevHigh};`,
    dark: `background-color:${EMAIL_DARK.sevHigh} !important;`,
  },
  dotMedium: {
    light: `background-color:${EMAIL_LIGHT.sevMedium};`,
    dark: `background-color:${EMAIL_DARK.sevMedium} !important;`,
  },
  dotLow: {
    light: `background-color:${EMAIL_LIGHT.sevLow};`,
    dark: `background-color:${EMAIL_DARK.sevLow} !important;`,
  },
  dotPositive: {
    light: `background-color:${EMAIL_LIGHT.sevPositive};`,
    dark: `background-color:${EMAIL_DARK.sevPositive} !important;`,
  },
} as const;

export type EmailRole = keyof typeof ROLES;

// Emits `class="…" style="…"` for one or more roles, plus any layout CSS that
// carries no color (padding, font-size, margins) as `extra`.
export function e(role: EmailRole | EmailRole[], extra = ""): string {
  const roles = Array.isArray(role) ? role : [role];
  const classes = roles.map((r) => `e-${r}`).join(" ");
  const light = roles.map((r) => ROLES[r].light).join("");
  return `class="${classes}" style="${light}${extra}"`;
}

// The type scale. Email can't consume the web's `text-*` tokens, and hand-picking
// px per call site is exactly how the templates ended up with prose at 13px —
// under the 14px floor DESIGN.md §3 sets for anything the user reads. One role
// per job, sizes mapped from that scale, and `t()` carries no color so it
// composes with `e()`: e("muted", t("dense")).
const TYPE = {
  display: "font-size:22px;font-weight:600;line-height:1.25;letter-spacing:-0.02em;",
  title: "font-size:17px;font-weight:600;line-height:1.3;letter-spacing:-0.015em;",
  heading: "font-size:15px;font-weight:600;line-height:1.35;letter-spacing:-0.01em;",
  // The primary read — insight, so-what, AI prose. 15px per the Small-Text Floor.
  lead: "font-size:15px;line-height:1.55;",
  body: "font-size:14px;line-height:1.6;",
  dense: "font-size:13px;line-height:1.5;",
  // The label/badge floor. Never used for prose.
  meta: "font-size:11px;font-weight:500;line-height:1.45;letter-spacing:0.04em;",
  // Figures the product measured: sans + tabular-nums, never mono
  // (DESIGN.md §3, the Numbers-Are-Sans Rule).
  stat: "font-size:28px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums;",
} as const;

export type EmailType = keyof typeof TYPE;

export function t(role: EmailType, extra = ""): string {
  return `${TYPE[role]}${extra}`;
}

// The dark half of every role, as CSS rules. `prefix` scopes them to a client
// hook: "" for the media query, "[data-ogsc] " / "[data-ogsb] " for the Outlook
// apps, which strip the media query but tag elements they repaint themselves.
export function darkRules(prefix = ""): string {
  const roles = Object.entries(ROLES)
    .map(([name, v]) => `${prefix}.e-${name}{${v.dark}}`)
    .join("");
  // Logo swap — the dark-ink mark is the default (correct on the light canvas,
  // which is what an untargetable client shows); the light-ink one is hidden
  // until a client tells us it is dark.
  return `${roles}${prefix}.e-logo-l{display:none !important;}${prefix}.e-logo-d{display:inline-block !important;max-height:none !important;overflow:visible !important;}`;
}
