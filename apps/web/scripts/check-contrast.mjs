#!/usr/bin/env node
/**
 * Contrast gate (WCAG 1.4.3 text, 1.4.11 / 2.4.11 non-text) for the design tokens.
 *
 * Every ratio quoted in DESIGN.md and in globals.css used to be a claim nobody
 * could re-check: the palette is OKLCH, contrast is defined on sRGB luminance,
 * and no tool in the repo bridged the two. This script does, with no dependency —
 * so the next palette change is verified rather than argued.
 *
 * It reads the tokens OUT of globals.css (never a copy: a copy drifts) and
 * asserts a table of pairs. Information-bearing marks — control borders, bar
 * fills, focus rings — need 3:1 against whatever they sit on. Decorative
 * hairlines are exempt by the norm itself and are not asserted here. Anything
 * carrying words needs 4.5:1.
 *
 * Three passes, because text arrives on this site three different ways:
 *   1. the token table          — the app's ramps on the app's surfaces
 *   2. the literal scan         — the landing's graphite bands dim an off-white
 *                                 inline, with no token to name
 *   3. the syntax themes        — the blog's code blocks are compiled at build
 *                                 time from a shiki theme, so the colours never
 *                                 appear in this file at all
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
    //
    // The selector may head a LIST — `:root,\n.lp-light {` since #518 — so the match
    // runs to the brace across whatever else shares the block. Requiring the brace to
    // follow the name directly made this throw instead of checking anything, and it
    // threw silently — at the time nothing in turbo.json or CI ran this script.
    // Both now do (`pnpm check:contrast`, and a step in ci.yml).
    const head = new RegExp(`^${selector.replace(".", "\\.")}(?![\\w-])[^{]*\\{`, "m").exec(css);
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
  // The landing adds a palette of its own in .landing-canvas. It is region-scoped
  // and never theme-switches, so it is returned beside the two themes rather than
  // merged into either — only the landing pass reads it.
  const landing = grab(".landing-canvas");
  // .dark only overrides; anything it omits comes from :root.
  return { light, dark: { ...light, ...dark }, landing };
}

/* ------------------------------------------------------------------ the spec */

const AA_LARGE = 3; // WCAG 1.4.11 non-text contrast
const AA_TEXT = 4.5; // WCAG 1.4.3 body text

/** Surfaces a control or a mark can be dropped onto. */
const SURFACES = ["--background", "--background-2", "--surface", "--surface-2", "--surface-3"];

/**
 * Ramp steps that carry words, each with the surfaces it is allowed to land on.
 * --muted (`text-text-muted`) and --muted-3 (`text-text-subtle`) are aliased in
 * @theme inline; anything fainter than --muted-3 is a mark, not text, and is
 * covered by the 3:1 rules below instead.
 */
const TEXT_FGS = [
  ["--foreground", SURFACES],
  ["--muted", SURFACES],
  ["--muted-foreground", SURFACES],
  ["--link", SURFACES],
  // The one exemption in this file, and it is about what ships rather than what is
  // expressible: --surface-3 is the hover / elevated-popover ground, and every rule
  // that raises a surface to it raises the text to --foreground in the same
  // declaration (feedback-buttons.tsx is the only place the two classes meet, and it
  // does exactly that). Asserting the pair anyway would push the faintest step up
  // until it collided with --muted-2 and the three-tier ramp collapsed into two.
  ["--muted-3", SURFACES.filter((s) => s !== "--surface-3")],
];

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

  // Text first: it is the floor everything else is judged against, and it is the
  // one an eye cannot compensate for. Every ramp step on every surface — the
  // combination that ships is decided per component, so the table asserts all of
  // them rather than guessing which pairs a page happens to use today.
  for (const [fg, surfaces] of TEXT_FGS) {
    for (const s of surfaces) out.push([`${fg} text on ${s}`, fg, s, AA_TEXT]);
  }

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
const report = new Map();

/** One assertion. Colors are CSS values here, already resolved out of any token. */
function assert(section, label, fg, bg, min, base = bg) {
  const ratio = contrast(fg, bg, base);
  const ok = ratio >= min;
  checked++;
  if (!ok) failures++;
  if (!ok || VERBOSE) {
    const line = `  ${ok ? "ok  " : "FAIL"} ${ratio.toFixed(2).padStart(5)} (needs ${min})  ${label}`;
    report.set(section, [...(report.get(section) ?? []), line]);
  }
}

/* ------------------------------------------------------- pass 1: the tokens */

for (const theme of ["light", "dark"]) {
  const tokens = themes[theme];
  for (const [label, fg, bg, min, base = "--background"] of rules()) {
    assert(theme, label, resolve(tokens, fg), resolve(tokens, bg), min, resolve(tokens, base));
  }
}

/* ---------------------------------------- pass 2: the landing's literal text */

/**
 * The graphite bands carry no token ramp of their own. They dim the off-white
 * inline as rgba(242, 245, 248, a), and fade inherited ink with
 * color-mix(in oklab, currentColor N%, transparent) — both literal values in this
 * file, invisible to readTokens, and together ~86 text declarations. That is the
 * largest single block of `ux:14`, so it is scanned rather than trusted: the floors
 * the comments up there claim (.48 for the off-white, 62% for the fades) are
 * asserted here, and the next ghosted label fails the gate instead of a crawl.
 *
 * Only `color:` is matched. The same families also paint strokes, fills and
 * backgrounds, which are marks and answer to the 3:1 rules, not to 4.5:1.
 */
const GRAPHITE = ["#0a0a0a", "#16161c"]; // the darkest and the lightest landing ground

const scan = (re) => new Set([...css.matchAll(re)].map((m) => m[1]));

const offWhite = scan(/^[ \t]*color:[ \t]*rgba\(242, 245, 248, ([\d.]+)\);/gm);
const fades = scan(/^[ \t]*color:[ \t]*color-mix\(in oklab, currentColor ([\d.]+)%, transparent\);/gm);
// A scan that matches nothing passes silently, which is the failure mode this whole
// script exists to close. If a family really is gone, delete its scan on purpose.
if (!offWhite.size || !fades.size) {
  throw new Error("a literal text family scanned to zero matches — remove the scan rather than let it pass vacuously");
}

const byValue = (a, b) => Number(a) - Number(b);
for (const a of [...offWhite].sort(byValue)) {
  for (const g of GRAPHITE) {
    assert("landing literals", `off-white at ${a} on ${g}`, `rgba(242,245,248,${a})`, g, AA_TEXT);
  }
}
// The fades run in the paper bands too, and --lp-ink on --lp-paper is a far tighter
// pairing than off-white on graphite — whatever clears there clears on the dark.
const ink = resolve(themes.landing, "--lp-ink");
const paper = resolve(themes.landing, "--lp-paper");
for (const n of [...fades].sort(byValue)) {
  const { rgb } = parseColor(ink);
  assert("landing literals", `ink faded to ${n}% on --lp-paper`, `rgba(${rgb.map(Math.round).join(",")},${n / 100})`, paper, AA_TEXT);
}

/* ------------------------------------------- pass 3: the blog's syntax themes */

/**
 * Code blocks are highlighted at BUILD time: rehype-pretty-code compiles the theme
 * into inline --shiki-light / --shiki-dark custom properties, so no colour here
 * appears in globals.css and a crawl only ever sees the one post that has a fenced
 * block. The theme is checked at its source instead.
 *
 * The pair must match components/blog/mdx.tsx — the legacy github-light/github-dark
 * measured 4.29:1 (light comment) and 3.50:1 (dark comment) on --surface-2, which is
 * what `ux:59` found, and only in dark because dark is the theme it crawled.
 *
 * Scopes that carry their own background are skipped: those are the diff markers,
 * and .prose-blog paints no token background, so the theme's foreground is never
 * seen on the theme's background.
 *
 * Both halves of the pairing are READ rather than restated — the theme names out of
 * mdx.tsx, the surface out of the .prose-blog rule — for the reason the tokens are:
 * a copy drifts, and a gate that checks last month's pairing checks nothing.
 */
const MDX = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "blog", "mdx.tsx");

const themePair = readFileSync(MDX, "utf8").match(
  /theme:\s*\{\s*light:\s*"([\w-]+)",\s*dark:\s*"([\w-]+)"\s*\}/,
);
if (!themePair) throw new Error("no rehype-pretty-code theme pair found in mdx.tsx");
const SYNTAX_THEMES = { light: themePair[1], dark: themePair[2] };

const codeBg = css.match(/\.prose-blog pre \{[^}]*?\n\s*background:\s*var\((--[\w-]+)\);/);
if (!codeBg) throw new Error("no `background: var(--token)` in the .prose-blog pre rule");
const CODE_SURFACE = codeBg[1];

const { bundledThemes } = await import("shiki");
for (const [theme, name] of Object.entries(SYNTAX_THEMES)) {
  if (!bundledThemes[name]) throw new Error(`shiki has no theme ${name}`);
  const raw = (await bundledThemes[name]()).default;
  const bg = resolve(themes[theme], CODE_SURFACE);

  // Keyed by colour, not by scope: a theme repeats the same hex across dozens of
  // scopes, and one line per distinct colour is a report a human can read.
  const seen = new Map();
  const add = (fg, scope) => {
    if (!/^#[0-9a-f]{6}$/i.test(fg)) throw new Error(`unhandled theme colour ${fg} (${name})`);
    if (!seen.has(fg)) seen.set(fg, scope);
  };
  add(raw.colors?.["editor.foreground"] ?? raw.fg, "unscoped text");
  for (const t of raw.tokenColors ?? []) {
    if (!t.settings?.foreground || t.settings.background) continue;
    add(t.settings.foreground, Array.isArray(t.scope) ? t.scope[0] : (t.scope ?? "?"));
  }
  for (const [fg, scope] of seen) {
    assert(`${theme} · ${name}`, `${fg} (${scope}) on ${CODE_SURFACE}`, fg, bg, AA_TEXT);
  }
}

/* ------------------------------------------------------------------- verdict */

for (const [section, lines] of report) console.log(`\n${section}\n${lines.join("\n")}`);

console.log(
  failures === 0
    ? `\n${checked} pairs checked, all above their floor.`
    : `\n${failures} of ${checked} pairs are under their contrast floor.`,
);
process.exit(failures === 0 ? 0 : 1);
