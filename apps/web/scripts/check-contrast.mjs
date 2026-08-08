#!/usr/bin/env node
/**
 * Non-text contrast gate (WCAG 1.4.11 / 2.4.11) for the design tokens.
 *
 * Every ratio quoted in DESIGN.md and in globals.css used to be a claim nobody
 * could re-check: the palette is OKLCH, contrast is defined on sRGB luminance,
 * and no tool in the repo bridged the two. This script does, with no dependency —
 * so the next palette change is verified rather than argued.
 *
 * It reads the tokens OUT of globals.css (never a copy: a copy drifts) and
 * asserts a table of pairs. Information-bearing marks — control borders, bar
 * fills, focus rings — need 3:1 against whatever they sit on. Decorative
 * hairlines are exempt by the norm itself and are not asserted here.
 *
 *   node scripts/check-contrast.mjs          # or: pnpm check:contrast
 *   node scripts/check-contrast.mjs -v       # print every pair, not just failures
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "globals.css");
const VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose");

/* ---------------------------------------------------------------- color math */

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// OKLCH -> linear sRGB -> gamma-encoded sRGB, gamut-clipped per channel (which is
// what a browser shows for an out-of-gamut oklch()).
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((x) => {
    const c = clamp01(x);
    return (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255;
  });
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** "oklch(L C H)" | "oklch(L C H / a)" | "#rgb[a]" | "rgba(r,g,b,a)" -> {rgb, alpha} */
function parseColor(css) {
  const s = String(css).trim();

  const ok = s.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/);
  if (ok) return { rgb: oklchToRgb(+ok[1], +ok[2], +ok[3]), alpha: ok[4] ? +ok[4] : 1 };

  const rgba = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const p = rgba[1].split(/[,\s]+/).map((x) => Number(x.trim()));
    return { rgb: [p[0], p[1], p[2]], alpha: p[3] ?? 1 };
  }

  if (s.startsWith("#")) return { rgb: hexToRgb(s), alpha: 1 };

  throw new Error(`cannot parse color: ${css}`);
}

/** Composite a translucent color over an opaque backdrop — what the eye sees. */
function flatten(color, backdrop) {
  const c = parseColor(color);
  if (c.alpha >= 1) return c.rgb;
  const b = parseColor(backdrop);
  if (b.alpha < 1) throw new Error(`backdrop ${backdrop} must be opaque`);
  return c.rgb.map((x, i) => x * c.alpha + b.rgb[i] * (1 - c.alpha));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast of fg over bg, both composited onto `base` first.
 *
 * `base` matters because half these tokens are white-alpha in dark mode: an alpha
 * has no colour of its own, only the one it borrows from what is behind it. Passing
 * the wrong base (or flattening onto white, the tempting shortcut) reports a ratio
 * that appears nowhere on screen.
 */
function contrast(fg, bg, base) {
  const backdrop = flatten(bg, base);
  const l1 = luminance(flatten(fg, `rgb(${backdrop.join(",")})`));
  const l2 = luminance(backdrop);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------ token scraping */

/**
 * Pull `--name: value;` out of the `:root { … }` and `.dark { … }` blocks.
 * Only the first level matters — every token we assert lives directly in one of
 * those two blocks, and `@theme inline` holds aliases, not values.
 */
function readTokens(css) {
  const grab = (selector) => {
    // Anchored to the start of a line: both ":root" and ".dark" also appear inside
    // the file's comments, and indexOf would happily return one of those.
    const head = new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m").exec(css);
    if (!head) throw new Error(`no ${selector} block in globals.css`);
    const open = head.index + head[0].length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const out = {};
    for (const m of css.slice(open + 1, end).matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
      out[m[1]] = m[2].trim();
    }
    return out;
  };

  const light = grab(":root");
  const dark = grab(".dark");
  // .dark only overrides; anything it omits comes from :root.
  return { light, dark: { ...light, ...dark } };
}

/* ------------------------------------------------------------------ the spec */

const AA_LARGE = 3; // WCAG 1.4.11 non-text contrast

/** Surfaces a control or a mark can be dropped onto. */
const SURFACES = ["--background", "--background-2", "--surface", "--surface-2", "--surface-3"];

/** Fills that ride on top of a bar gutter. */
const BAR_FILLS = [
  "--accent",
  "--link",
  "--muted-foreground",
  "--foreground",
  "--positive",
  "--critical",
  "--high",
  "--medium",
  "--low",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
];

/**
 * Each rule is [label, fg, bg, min, base?]. All three colors are token names.
 * `base` is the opaque surface a translucent `bg` composites onto (default: the
 * canvas). It has to be stated because in dark mode --stroke and --border are
 * white alphas — they have no colour until something is behind them.
 */
function rules() {
  const out = [];

  // A control's edge IS the control when it has no fill: checkbox, switch track,
  // input, toggle, and every mark we route through --stroke.
  for (const s of SURFACES) out.push([`--stroke on ${s}`, "--stroke", s, AA_LARGE]);

  // The gutter is the background of its own fill, so the tightest fill binds it.
  for (const f of BAR_FILLS) out.push([`${f} on --track`, f, "--track", AA_LARGE]);

  // A gutter also gets dropped onto several surfaces; it only has to be tellable
  // apart from them, which a fill-bearing bar already guarantees. Asserted at a
  // deliberately low floor so an over-quiet gutter still trips.
  for (const s of ["--background", "--surface"]) out.push([`--track on ${s}`, "--track", s, 1.15]);

  // Keyboard focus (WCAG 2.4.11). ring-ring is the utility every focusable element
  // uses, at full opacity; the ring sits against whatever surface the element is on.
  // (`--color-ring: var(--accent)` in @theme inline — the ring IS the accent.)
  for (const s of SURFACES) out.push([`focus ring on ${s}`, "--accent", s, AA_LARGE]);

  // A switch reads by the step between its thumb and its track, in both states.
  // The unchecked track is --stroke, translucent in dark: it borrows the card it
  // sits on, which is the darkest realistic case for that step.
  out.push(["switch thumb on unchecked track", "--background", "--stroke", AA_LARGE, "--surface"]);
  out.push(["switch thumb on checked track", "--background", "--accent", AA_LARGE]);

  // A reference mark on a bar reads one of two ways, and which one decides what to
  // assert. The compare median overhangs its lane (-inset-y-1) and paints UNDER the
  // fill, so it is read on the row surface — already covered by the --stroke rules
  // above, nothing extra to assert. The hiring/content "was here" ticks paint OVER
  // the fill instead, so they carry a --track outline: the outline is what separates
  // them, and it has to read against the fill it crosses. 1.5 is a traceability
  // floor, not a WCAG one — 3:1 on both sides of a crossing mark is unsatisfiable.
  out.push(["ringed tick over its fill", "--foreground", "--link", 1.5]);
  out.push(["that tick's ring over the fill", "--track", "--link", 1.5]);

  // A checked checkbox is an accent square carrying a tick.
  out.push(["checkbox fill on the field", "--accent", "--field", AA_LARGE]);
  out.push(["checkbox tick on its fill", "--accent-foreground", "--accent", AA_LARGE]);

  return out;
}

/* --------------------------------------------------------------------- run it */

const css = readFileSync(CSS, "utf8");
const themes = readTokens(css);

const resolve = (tokens, ref, seen = new Set()) => {
  const value = tokens[ref];
  if (!value) throw new Error(`token ${ref} is not defined`);

  // Some tokens are aliases (--field: var(--background) in light). Follow them, and
  // refuse to loop if the CSS ever grows a cycle.
  const alias = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!alias) return value;
  if (seen.has(ref)) throw new Error(`token alias cycle at ${ref}`);
  return resolve(tokens, alias[1], new Set(seen).add(ref));
};

let failures = 0;
let checked = 0;

for (const [theme, tokens] of Object.entries(themes)) {
  const lines = [];
  for (const [label, fg, bg, min, base = "--background"] of rules()) {
    const ratio = contrast(resolve(tokens, fg), resolve(tokens, bg), resolve(tokens, base));
    const ok = ratio >= min;
    checked++;
    if (!ok) failures++;
    if (!ok || VERBOSE) {
      lines.push(`  ${ok ? "ok  " : "FAIL"} ${ratio.toFixed(2).padStart(5)} (needs ${min})  ${label}`);
    }
  }
  if (lines.length) {
    console.log(`\n${theme}`);
    console.log(lines.join("\n"));
  }
}

console.log(
  failures === 0
    ? `\n${checked} pairs checked, all above their floor.`
    : `\n${failures} of ${checked} pairs are under their contrast floor.`,
);
process.exit(failures === 0 ? 0 : 1);
