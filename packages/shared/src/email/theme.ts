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

export const EMAIL_LIGHT = {
  canvas: "#fafafa",
  surface: "#ffffff",
  border: "#e4e4e7",
  text: "#18181b",
  muted: "#52525b",
  faint: "#71717a",
  accent: "#4f46e5",
  accentFill: "#4f46e5",
  onAccent: "#ffffff",
  // Severity ramp at Tailwind-700 level: each clears 4.5:1 as text on the light
  // canvas, where the dark-mode 400/500 values sat at ~3:1.
  sevCritical: "#b91c1c",
  sevWatch: "#a16207",
  sevOk: "#047857",
} as const;

export const EMAIL_DARK = {
  canvas: "#0a0a0a",
  surface: "#171717",
  border: "#262626",
  text: "#fafafa",
  muted: "#a3a3a3",
  // Was #525252 (~3.5:1 on the canvas) — the footer tier is 11px, so it moves up
  // to a passing value rather than being carried over verbatim.
  faint: "#737373",
  accent: "#818cf8",
  accentFill: "#6366f1",
  onAccent: "#ffffff",
  sevCritical: "#ef4444",
  sevWatch: "#f59e0b",
  sevOk: "#22c55e",
} as const;

// One semantic role → its class, its light declarations, its dark overrides.
// The dark side is emitted as CSS by the shell; nothing else may hardcode it.
const ROLES = {
  bg: {
    light: `background-color:${EMAIL_LIGHT.canvas};`,
    dark: `background-color:${EMAIL_DARK.canvas} !important;`,
  },
  card: {
    light: `background-color:${EMAIL_LIGHT.surface};border:1px solid ${EMAIL_LIGHT.border};`,
    dark: `background-color:${EMAIL_DARK.surface} !important;border-color:${EMAIL_DARK.border} !important;`,
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
    light: `color:${EMAIL_LIGHT.accent};`,
    dark: `color:${EMAIL_DARK.accent} !important;`,
  },
  btn: {
    light: `background-color:${EMAIL_LIGHT.accentFill};color:${EMAIL_LIGHT.onAccent};`,
    dark: `background-color:${EMAIL_DARK.accentFill} !important;color:${EMAIL_DARK.onAccent} !important;`,
  },
  rule: {
    light: `border-color:${EMAIL_LIGHT.border};`,
    dark: `border-color:${EMAIL_DARK.border} !important;`,
  },
  critical: {
    light: `color:${EMAIL_LIGHT.sevCritical};`,
    dark: `color:${EMAIL_DARK.sevCritical} !important;`,
  },
  watch: {
    light: `color:${EMAIL_LIGHT.sevWatch};`,
    dark: `color:${EMAIL_DARK.sevWatch} !important;`,
  },
  ok: {
    light: `color:${EMAIL_LIGHT.sevOk};`,
    dark: `color:${EMAIL_DARK.sevOk} !important;`,
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
