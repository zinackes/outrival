---
name: Outrival
description: Competitive-intelligence terminal that turns competitor moves into decisions.
colors:
  signal-amber: "#f59e0b"
  signal-amber-bright: "#fbb734"
  signal-amber-dim: "#e8920a"
  accent-ink: "#0b0b0d"
  canvas: "#fafafa"
  surface: "#ffffff"
  surface-2: "#f4f4f5"
  surface-3: "#e8e8eb"
  border: "#e6e6e6"
  ink: "#131313"
  muted: "#737373"
  critical: "#dc2626"
  high: "#ea580c"
  medium: "#d97706"
  low: "#71717a"
  positive: "#059669"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
  xl: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.signal-amber-bright}"
    textColor: "{colors.accent-ink}"
  button-primary-active:
    backgroundColor: "{colors.signal-amber-dim}"
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
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
---

# Design System: Outrival

## 1. Overview

**Creative North Star: "The Analyst's Terminal"**

Outrival looks like the surface a competitive analyst would actually want open
between meetings: terminal-grade density, dark-capable, monospaced where the data
lives, with a single amber that lights up only when something has earned attention.
It borrows the trading terminal's economy (every pixel earns its place, nothing
decorative) but bends it toward the analyst's desk: the finding leads, the evidence
is one click away, and the interface recedes the moment it has handed you the
decision. Familiarity is a feature. A power user of Linear, Stripe, or Raycast
should sit down and trust it on sight.

The system is built on tonal neutrals and one accent. Depth comes from stacking
surfaces, not from shadow. Type does the heavy lifting: a single grotesque sans for
voice and a mono for the machine-truth layer (timestamps, counts, IDs, diffs). The
palette is quiet on purpose so that severity reads instantly when it appears, the
same way the product itself suppresses noise to surface signal.

It explicitly rejects the generic 2026 SaaS look (cards nested in cards, purple-blue
gradients, the hero-metric block, an all-caps eyebrow over every section), the heavy
enterprise-BI aesthetic (dull gray, chart-soup, density without hierarchy), anything
playful or toy-like (emoji-as-UI, blobby radii, mascots), and the anxiety wall of
red numbers with no hierarchy.

**Key Characteristics:**
- One accent (amber), spent only on action and live signal.
- Flat surfaces; depth by tonal layering, never decorative shadow.
- Single sans (Bricolage Grotesque) + mono (DM Mono) as a deliberate data voice.
- Tight radii (4px on controls), fixed type scale, high information density.
- Severity is a semantic color system, kept separate from the brand accent.
- Calm by default; color and motion are spent only when severity earns them.

## 2. Colors

A near-monochrome neutral field carrying one amber accent and a five-step severity
scale. The system is maintained at light/dark parity (`:root` is light, `.dark`
overrides); the frontmatter carries the light values as canonical, the dark ramp
lives in the sidecar.

### Primary
- **Signal Amber** (`#f59e0b`): the only brand accent. Primary buttons, current
  selection, focus ring, progress, and live-signal highlights. Hover lifts to
  **Amber Bright** (`#fbb734`), active presses to **Amber Dim** (`#e8920a`). On amber,
  text is **Accent Ink** (`#0b0b0d`), never white.

### Neutral
- **Canvas** (`#fafafa` light / `#0b0b0d` dark): the page background.
- **Surface** (`#ffffff` light / `#131316` dark): cards and raised content, one step
  brighter than canvas in light, one step lighter than canvas in dark.
- **Surface-2** (`#f4f4f5` light / `#1a1a1f` dark): popovers, secondary fills.
- **Surface-3** (`#e8e8eb` light / `#26262d` dark): elevated hover state. Must stay
  distinct from Surface-2 (popover) so hover never reads as a popover.
- **Ink** (`rgba(0,0,0,0.92)` / `rgba(255,255,255,0.95)`): primary text.
- **Muted** (`rgba(0,0,0,0.55)` / `rgba(255,255,255,0.6)`): secondary text, never
  below 4.5:1 on its surface.
- **Border** (`rgba(0,0,0,0.1)` / `rgba(255,255,255,0.08)`): hairline dividers and
  control strokes; `border-strong` for emphasis.

### Severity (the semantic scale; not decorative, never the brand accent)
- **Critical** (`#dc2626` / `#ff4d4d`), **High** (`#ea580c` / `#ff9f43`),
  **Medium** (`#d97706` / `#ffc542`), **Low** (`#71717a` / `#8a8a94`),
  **Positive** (`#059669` / `#34d399`). Darkened on light surfaces for contrast,
  brightened on dark.

### Named Rules
**The One Voice Rule.** Amber is the only brand color, and it appears on a small
fraction of any screen: a primary action, the current selection, a focus ring, a
live signal. Its rarity is what makes it read as signal. Never use it for decoration
or for large fills.

**The Severity-Is-Not-Amber Rule.** Medium severity (`#d97706`) is close to amber by
hue; they are different systems and must never be confused. Severity reinforces with
label and icon, never hue alone.

## 3. Typography

**Display / Body Font:** Bricolage Grotesque (with `ui-sans-serif, system-ui, sans-serif`)
**Label / Mono Font:** DM Mono (with `ui-monospace, SFMono-Regular, monospace`)

**Character:** One expressive grotesque carries everything from page titles to body
to labels, paired with a single mono that does the machine-truth work. The contrast
is sans-vs-mono, not display-vs-body, which keeps the product dense and consistent
rather than editorial.

### Hierarchy
- **Display** (600, 2rem fixed, 1.1): page-level titles on product surfaces. The
  marketing landing may run larger with a clamp; product UI stays fixed.
- **Headline** (600, 1.25rem, 1.2): section titles, dialog titles.
- **Title** (600, 0.8125rem / 13px, tracking -0.01em, 1.25): card titles, table
  group headers. Deliberately small and tight; titles label, they don't shout.
- **Body** (400, 0.875rem / 14px, 1.5): default UI text. Prose blocks cap at 65–75ch;
  tables and dense panels may run wider.
- **Label** (500, 0.75rem / 12px): buttons, form labels, nav items.
- **Mono** (400, 0.6875rem / 11px): timestamps, counts, IDs, metadata, diffs, and
  card descriptions. The data voice.

### Named Rules
**The Machine-Truth Rule.** DM Mono is reserved for values the machine produced:
timestamps, counts, IDs, prices, diffs, metadata. It is never used for prose or
headings. When you see mono, you are looking at data, not voice.

**The No-Display-In-UI Rule.** No display sizing or expressive type in labels,
buttons, or data. Product chrome uses the fixed scale; expressive type is a landing
(brand) move only.

## 4. Elevation

Flat by default. The system defines no shadow tokens; depth is built by stacking
tonal surfaces (Canvas → Surface → Surface-2 → Surface-3) and separating regions with
hairline borders. The only ambient shadow in use is the browser-default `shadow-xs`
on inputs and outline buttons, which reads as a hairline, not a lift.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Reach for a tonal step or a
border before reaching for a shadow. If a true overlay (dialog, dropdown, popover)
needs to detach from the page, a single soft shadow is permitted; everywhere else,
shadow is forbidden. A 2014-app drop shadow on a card is always wrong here.

## 5. Components

Precise and restrained. Tight radii, mono metadata, no decoration. Every interactive
component ships its full state set: default, hover, focus-visible, active, disabled,
and (where relevant) loading and error.

### Buttons
- **Shape:** gently squared (`rounded-md`, 4px). Default height 36px (`h-9`);
  sizes xs/sm/lg and icon variants share the radius.
- **Primary:** Signal Amber fill, Accent Ink text, `text-sm` weight 500.
  Hover → Amber Bright, active → Amber Dim.
- **Focus:** 3px amber ring at 50% (`ring-ring/50`) plus border shift. Always visible.
- **Outline / Secondary / Ghost / Link:** outline carries a border on canvas with a
  neutral hover fill; ghost is fill-on-hover only; link is amber text with underline
  on hover. Disabled drops to 50% opacity, pointer-events off.

### Cards / Containers
- **Corner Style:** `rounded-md` (4px).
- **Background:** Surface, on the darker Canvas. No nested cards.
- **Shadow Strategy:** none (see Elevation). Separation is the border plus the tonal step.
- **Border:** 1px Border hairline; header and footer are divided by the same hairline.
- **Internal Padding:** 16px vertical / 20px horizontal (`px-5 py-4`).
- **Title/Description:** title is 13px semibold tracking-tight; description is 11px
  **mono**, muted, the metadata voice.

### Inputs / Fields
- **Style:** 36px tall, `rounded-md`, 1px Border stroke, transparent fill
  (`bg-input/30` in dark), `text-sm`. Hairline `shadow-xs`.
- **Focus:** border shifts to ring color, 3px amber ring at 50%.
- **Error / Disabled:** `aria-invalid` shows a destructive border + ring; disabled is
  50% opacity, not-allowed cursor.

### Badges / Chips
- **Style:** `rounded-md`, `px-2 py-0.5`, `text-xs` weight 500. Variants:
  default (amber), secondary (neutral fill), destructive, outline (border only), ghost,
  link. Severity badges map to the severity scale, reinforced with an icon.

### Navigation (signature)
- The dashboard runs a custom **sidebar** app shell (`components/ui/sidebar.tsx`) on
  the `--sidebar` surface, a half-step off the content surface. Nav items are `label`
  type, with neutral hover/active fills and an amber active indicator. Collapses
  structurally on small screens (not fluid type).

## 6. Do's and Don'ts

### Do:
- **Do** spend Signal Amber only on action, selection, focus, and live signal, on a
  small fraction of any screen (the One Voice Rule).
- **Do** build depth with tonal surfaces (Canvas → Surface → Surface-2 → Surface-3)
  and hairline borders, not shadow (the Flat-By-Default Rule).
- **Do** use DM Mono for data, metadata, timestamps, counts, IDs, and diffs, and only
  for those (the Machine-Truth Rule).
- **Do** reinforce severity with label and icon, not color alone, and keep the five
  severity hues separate from the brand amber.
- **Do** ship every interactive component's full state set, including focus-visible
  (3px amber ring) and disabled.
- **Do** hold body and placeholder text to ≥4.5:1 contrast; bump muted text toward
  Ink rather than letting it drift light "for elegance".
- **Do** keep transitions in the 150–250ms range and give every animation a
  `prefers-reduced-motion` alternative.

### Don't:
- **Don't** ship the generic 2026 SaaS look: cards nested in cards, purple-to-blue
  gradients, the hero-metric block, or an all-caps tracked eyebrow over every section.
- **Don't** drift toward heavy enterprise BI: dull gray chart-soup, density without
  hierarchy, intimidating walls of controls.
- **Don't** go playful or toy-like: emoji-as-UI, blobby radii, mascot illustrations,
  saturated toy palette.
- **Don't** build the anxiety wall: a screen of red numbers and charts with no
  hierarchy. Noise over signal is the exact failure the product exists to fix.
- **Don't** put a decorative drop shadow on a card, or use `border-left`/`border-right`
  greater than 1px as a colored stripe accent.
- **Don't** use gradient text (`background-clip: text`) or glassmorphism as decoration.
- **Don't** use amber for large fills, and don't use white text on amber (use Accent Ink).
- **Don't** set mono on prose or headings, or display type in UI labels, buttons, or data.
