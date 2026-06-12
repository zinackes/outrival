---
name: Outrival
description: Competitive-intelligence terminal that turns competitor moves into decisions.
colors:
  signal-cyan: "oklch(0.7 0.16 200)"
  signal-cyan-bright: "oklch(0.78 0.14 200)"
  signal-cyan-dim: "oklch(0.64 0.17 200)"
  accent-ink: "oklch(0.17 0.02 230)"
  link: "oklch(0.55 0.14 200)"
  canvas: "oklch(0.985 0.002 260)"
  surface: "oklch(0.998 0.001 260)"
  surface-2: "oklch(0.96 0.004 260)"
  surface-3: "oklch(0.93 0.006 260)"
  border: "oklch(0.9 0.005 260)"
  ink: "oklch(0.22 0.01 260)"
  muted: "oklch(0.46 0.015 260)"
  critical: "#b91c1c"
  high: "#c2410c"
  medium: "#a16207"
  low: "#52525b"
  positive: "#047857"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 560
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-cyan}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.signal-cyan-bright}"
    textColor: "{colors.accent-ink}"
  button-primary-active:
    backgroundColor: "{colors.signal-cyan-dim}"
    textColor: "{colors.accent-ink}"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px 20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  badge-default:
    backgroundColor: "{colors.signal-cyan}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System: Outrival

> Source of truth is the code: tokens live in `apps/web/src/app/globals.css`
> (`:root` light, `.dark` overrides) and are consumed as Tailwind v4 utilities.
> This file documents that system; when they disagree, the code wins and this
> file is stale. Keep them in sync.

## 1. Overview

**Creative North Star: "The Analyst's Terminal"**

Outrival looks like the surface a competitive analyst would actually want open
between meetings: terminal-grade density, dark-capable, monospaced where the data
lives, with a single cyan that lights up only when something has earned attention.
It borrows the trading terminal's economy (every pixel earns its place, nothing
decorative) but bends it toward the analyst's desk: the finding leads, the evidence
is one click away, and the interface recedes the moment it has handed you the
decision. Familiarity is a feature. A power user of Linear, Stripe, or Raycast
should sit down and trust it on sight.

The system is built on tonal neutrals and one accent. Depth comes from stacking
surfaces, not from shadow. Type does the heavy lifting: a grotesque for headings, a
neutral sans for voice, and a mono for the machine-truth layer (timestamps, counts,
IDs, diffs). The palette is quiet on purpose so that severity reads instantly when
it appears, the same way the product itself suppresses noise to surface signal.

It explicitly rejects the generic 2026 SaaS look (cards nested in cards, purple-blue
gradients, the hero-metric block, an all-caps eyebrow over every section), the heavy
enterprise-BI aesthetic (dull gray, chart-soup, density without hierarchy), anything
playful or toy-like (emoji-as-UI, blobby radii, mascots), and the anxiety wall of
red numbers with no hierarchy.

**Key Characteristics:**
- One accent (cyan), spent only on action, selection, focus, and live signal.
- Flat surfaces; depth by tonal layering, never decorative shadow.
- Bricolage Grotesque (headings) + Geist Sans (body/UI) + Geist Mono (data voice).
- Tight radii (6px on controls/cards), a fixed token type scale, high density.
- Severity is a semantic color system, kept separate from the brand accent.
- Calm by default; color and motion are spent only when severity earns them.

## 2. Colors

A near-monochrome neutral field (hue 260, tinted, never pure black/white) carrying
one cyan accent and a five-step severity scale. Maintained at light/dark parity
(`:root` is light, `.dark` overrides). All values are OKLCH so contrast tracks
lightness predictably; the frontmatter carries the light values as canonical.

### Primary
- **Signal Cyan** (`oklch(0.7 0.16 200)`): the only brand accent — a "signal/radar"
  cyan, non-violet by design. Primary buttons, current selection, focus ring,
  progress, and live-signal highlights. Hover lifts to **Cyan Bright**
  (`oklch(0.78 0.14 200)`), active presses to **Cyan Dim** (`oklch(0.64 0.17 200)`).
  On cyan, text is **Accent Ink** (`oklch(0.17 0.02 230)`), never white.
- **Link** (`oklch(0.55 0.14 200)`): links and meaningful icons. A darker step of
  the same hue so the rationed CTA fill stays the rarest cyan on screen.

### Neutral
- **Canvas** (`oklch(0.985 …)` light / `oklch(0.16 …)` dark): the page background.
- **Surface** (`oklch(0.998 …)` / `oklch(0.2 …)`): cards and raised content.
- **Surface-2** (`oklch(0.96 …)` / `oklch(0.24 …)`): popovers, secondary fills.
- **Surface-3** (`oklch(0.93 …)` / `oklch(0.28 …)`): elevated hover state. Stays
  distinct from Surface-2 (popover) so hover never reads as a popover.
- **Foreground / Ink** (`oklch(0.22 …)` / `oklch(0.96 …)`): primary text.
- **Muted** (`oklch(0.46 …)` / `oklch(0.72 …)`): secondary text. Held at full
  strength on its surface — **do not dim it further with `/70`–`/80` alpha**, which
  drops it under 4.5:1. Need more contrast? Step toward Foreground, never lighter.
- **Border** (`oklch(0.9 …)` / `oklch(0.31 …)`): hairline dividers and control
  strokes; `border-strong` for emphasis.

### Severity (the semantic scale; not decorative, never the brand accent)
- **Critical** (`#b91c1c` / `#ff4d4d`), **High** (`#c2410c` / `#ff9f43`),
  **Medium** (`#a16207` / `#ffc542`), **Low** (`#52525b` / `#8a8a94`),
  **Positive** (`#047857` / `#34d399`). Light values are Tailwind 700-level: each
  clears ≥4.5:1 as text on the near-white canvas and under white as a solid fill,
  with wide hue gaps (red → orange → gold) so the warm steps read apart. Dark mode
  stays bright (already separated and AA on the dark canvas).

### Category (wayfinding, a third system)
- Six desaturated hues for the signal categories (pricing/product/hiring/reviews/
  content/funding), `--cat-*`, consumed as `text-cat-*` / `bg-cat-*/12` /
  `border-cat-*/30` on the feed pills. Separate from severity AND from the brand
  cyan; the data-viz line palette (`--chart-1..6`) is the same six hues tuned for
  thin strokes.

### Named Rules
**The One Voice Rule.** Cyan is the only brand color, and it appears on a small
fraction of any screen: a primary action, the current selection, a focus ring, a
live signal. Its rarity is what makes it read as signal. Never use it for decoration
or for large fills.

**The Three-Systems Rule.** Brand cyan, severity (red→amber→gray→green), and
category (cool→rose wayfinding) are three independent color systems. Never borrow a
severity or category hue for the brand accent, or vice versa. Severity and category
are always reinforced with label and icon, never hue alone.

## 3. Typography

**Heading Font:** Bricolage Grotesque (`--font-display`; `ui-sans-serif, system-ui`)
— headings only (`h1`–`h5`, weight 560, optical sizing on).
**Body / UI Font:** Geist Sans (`--font-sans`) — body, labels, buttons, nav, data prose.
**Mono Font:** Geist Mono (`--font-mono`; tabular-nums + slashed-zero) — the data voice.

**Character:** A grotesque does the headings, a neutral sans does the voice, a mono
does the machine-truth work. The contrast that matters most is sans-vs-mono (voice
vs. data), which keeps the product dense and consistent rather than editorial.

### Scale (token-only — never `text-[Npx]`)

The scale is tokenized in `globals.css` and consumed as Tailwind utilities. **Do not
hand-code arbitrary pixel sizes** (`text-[13px]`); reach for a role token. Each px is
defined once, so the scale stays enforceable and changes in one place.

| Utility | Size | Role |
|---|---|---|
| `text-title-lg` | 26px | page title (≥ md) — `h1` |
| `text-title` | 22px | page title (mobile) — `h1` |
| `text-xl` | 20px | dialog / headline titles |
| `text-lg` | 18px | large headings, lead sub |
| `text-lead` | 17px | signal insight lead |
| `text-base` | 16px | base / document body root |
| `text-content` | 15px | comfortable reading body — the primary read (insight, so-what, action, AI summary) |
| `text-sm` | 14px | **default UI body & reading-prose floor** (descriptions, empty states, helper) |
| `text-dense` | 13px | dense tables, secondary/meta lines, compact labels |
| `text-xs` | 12px | labels, table-header text, controls |
| `text-meta` | 11px | **mono** meta + the label/badge **floor**: timestamps, counts, IDs |
| `text-micro` | 10px | a11y floor only — **not for labels**; defined but retired from usage |
| `text-stat` | 32px | KPI numerals (mono) |

Larger display steps (`text-2xl`…`text-7xl`, 25→76px) exist for the marketing
landing (brand register); product chrome stays on the table above.

### Named Rules
**The Machine-Truth Rule.** Geist Mono is reserved for values the machine produced:
timestamps, counts, IDs, prices, diffs, metadata. Never used for prose or headings.
When you see mono, you are looking at data, not voice.

**The No-Arbitrary-Size Rule.** No `text-[Npx]` in product UI. If a size you need
isn't a token, the answer is almost always the nearest token, not a new arbitrary
value. A genuinely new role gets a new token in `globals.css`, documented here.

**The No-Display-In-UI Rule.** No display sizing or expressive type in labels,
buttons, or data. Product chrome uses the fixed scale; expressive type is a landing
(brand) move only.

**The Small-Text Floor Rule.** Prose the user reads — insights, so-what,
descriptions, helper text, empty states — floors at `text-sm` (14px); the primary
read (signal insight, AI summaries, narratives) is `text-content` (15px). Labels and
badges floor at `text-meta` (11px): `text-micro` (10px) stays defined as the WCAG
a11y floor but is retired from real usage, because 10px uppercase/mono labels read as
AI scaffolding. Below the body, get hierarchy from **weight + colour (muted)**, not
from shrinking another step — the dashboard's centre of gravity sits at 14–15px, not
12. (Form field-labels are the one place 12–13px is still correct.)

## 4. Elevation

Flat by default. The system defines no shadow tokens; depth is built by stacking
tonal surfaces (Canvas → Surface → Surface-2 → Surface-3) and separating regions with
hairline borders. The only ambient shadow in use is the browser-default `shadow-xs`
on inputs and outline buttons, which reads as a hairline, not a lift. The KPI strip
uses a faint `bg-gradient-card` (a ~0.03L diagonal lift), the one sanctioned gradient.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Reach for a tonal step or a
border before reaching for a shadow. If a true overlay (dialog, dropdown, popover)
needs to detach from the page, a single soft shadow is permitted; everywhere else,
shadow is forbidden. A 2014-app drop shadow on a card is always wrong here.

## 5. Components

Precise and restrained. Tight radii, mono metadata, no decoration. Every interactive
component ships its full state set: default, hover, focus-visible, active, disabled,
and (where relevant) loading and error. Radius scale: `sm` 4px (badges/pills), `md`
6px (controls **and** cards), `lg` 12px / `xl` 16px (larger surfaces, dialogs).

### Buttons
- **Shape:** gently squared (`rounded-md`, 6px). Default height 36px (`h-9`);
  sizes xs/sm/lg and icon variants share the radius.
- **Primary:** Signal Cyan fill, Accent Ink text, `text-sm` weight 500.
  Hover → Cyan Bright, active → Cyan Dim.
- **Focus:** 3px cyan ring at 50% (`ring-ring/50`) plus border shift. Always visible
  — including on raw `<button>` elements, which must carry `focus-visible` rings too
  (don't `outline-none` without a replacement).
- **Outline / Secondary / Ghost / Link:** outline carries a border on canvas with a
  neutral hover fill; ghost is fill-on-hover only; link is cyan text with underline
  on hover. Disabled drops to 50% opacity, pointer-events off.

### Cards / Containers
- **Corner Style:** `rounded-md` (6px). (The `lg`/`xl` radii are for larger surfaces
  and dialogs, not content cards.)
- **Background:** Surface, on the darker Canvas. No nested cards.
- **Shadow Strategy:** none (see Elevation). Separation is the border plus the tonal step.
- **Border:** 1px Border hairline; header and footer are divided by the same hairline.
- **Internal Padding:** 16px vertical / 20px horizontal (`px-5 py-4`).
- **Title/Description:** title is `text-sm` (14px) semibold tracking-tight;
  description is `text-dense` (13px) / `text-meta` **mono**, muted (full strength, not `/80`).
- **Boxless is preferred** for dashboard sections: a `SectionHead` (title + mono sub,
  bounded by one hairline) over per-section card chrome. Depth from rhythm, not boxes.

### Inputs / Fields
- **Style:** 36px tall, `rounded-md`, 1px Border stroke, transparent fill
  (`bg-input/30` in dark), `text-sm`. Hairline `shadow-xs`.
- **Focus:** border shifts to ring color, 3px cyan ring at 50%.
- **Error / Disabled:** `aria-invalid` shows a destructive border + ring; disabled is
  50% opacity, not-allowed cursor.

### Badges / Chips
- **Style:** `rounded-sm` (4px), `px-2 py-0.5`, `text-xs` weight 500 (mono meta
  badges floor at `text-meta` 11px — never `text-micro`). Variants: default (cyan), secondary
  (neutral fill), destructive, outline (border only), ghost, link. Severity and
  category badges map to their scales, reinforced with an icon. Uppercase is allowed
  on badges only (short labels), never on buttons or body.

### Navigation (signature)
- The dashboard runs a custom **sidebar** app shell (`components/ui/sidebar.tsx`) on
  the `--sidebar` surface, a half-step off the content surface. Nav items are `label`
  type, with neutral hover/active fills and a cyan active indicator. Collapses
  structurally on small screens (not fluid type). On `/dashboard/settings/*` the
  contextual `SettingsSidebar` replaces the main rail (Vercel/Stripe pattern).

## 6. Do's and Don'ts

### Do:
- **Do** spend Signal Cyan only on action, selection, focus, and live signal, on a
  small fraction of any screen (the One Voice Rule).
- **Do** build depth with tonal surfaces (Canvas → Surface → Surface-2 → Surface-3)
  and hairline borders, not shadow (the Flat-By-Default Rule). Prefer boxless sections.
- **Do** use the type-scale role tokens; never hand-code `text-[Npx]`
  (the No-Arbitrary-Size Rule).
- **Do** use Geist Mono for data, metadata, timestamps, counts, IDs, and diffs, and
  only for those (the Machine-Truth Rule).
- **Do** reinforce severity and category with label and icon, not color alone, and
  keep the three color systems separate.
- **Do** ship every interactive component's full state set, including focus-visible
  (3px cyan ring) and disabled — on raw `<button>`s too.
- **Do** hold body and placeholder text to ≥4.5:1; keep muted text at full strength
  and bump toward Foreground when you need contrast, never lighter "for elegance".
- **Do** keep transitions in the 150–250ms range and give every animation a
  `prefers-reduced-motion` alternative.

### Don't:
- **Don't** ship the generic 2026 SaaS look: cards nested in cards, purple-to-blue
  gradients, the hero-metric block, or an all-caps tracked eyebrow over every section.
- **Don't** hand-code arbitrary type sizes (`text-[13px]`) or reinvent the page
  header per view — use the scale tokens and `PageHead`/`SectionHead`.
- **Don't** dim muted text with `/70`–`/80` alpha, or set `text-white`/`bg-white/N`
  (breaks in light mode); use the theme tokens so both modes hold.
- **Don't** drift toward heavy enterprise BI: dull gray chart-soup, density without
  hierarchy, intimidating walls of controls.
- **Don't** go playful or toy-like: emoji-as-UI, blobby radii, mascot illustrations,
  saturated toy palette.
- **Don't** build the anxiety wall: a screen of red numbers and charts with no
  hierarchy. Noise over signal is the exact failure the product exists to fix.
- **Don't** put a decorative drop shadow on a card, or use `border-left`/`border-right`
  greater than 1px as a colored stripe accent.
- **Don't** use gradient text (`background-clip: text`) or glassmorphism as decoration.
- **Don't** use cyan for large fills, and don't use white text on cyan (use Accent Ink).
- **Don't** set mono on prose or headings, or display type in UI labels, buttons, or data.
