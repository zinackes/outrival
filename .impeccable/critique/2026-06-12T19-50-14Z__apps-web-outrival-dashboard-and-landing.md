---
target: apps/web Outrival dashboard and landing
total_score: 33
p0_count: 0
p1_count: 2
timestamp: 2026-06-12T19-50-14Z
slug: apps-web-outrival-dashboard-and-landing
---
# Critique — Outrival web app + landing

Code-grounded review (dev server down + WSL2 RAM; no live browser pass). Surfaces: dashboard overview, signals feed + signal card, competitors, settings, landing.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Skeletons, optimistic updates w/ rollback+toast, streaming onboarding, AI-status banner, freshness dots |
| 2 | Match System / Real World | 4 | Domain language clear; jargon (Overlap, Signal mix, Held back, Threat) is tooltipped |
| 3 | User Control and Freedom | 3 | Per-card auto-read is reversible; bulk "Mark all read" has no undo |
| 4 | Consistency and Standards | 3 | Tokens rigorous, but arbitrary px spacing drift (22/18/7) + side-stripe narrative breaks the stated system |
| 5 | Error Prevention | 3 | Destructive confirm in danger zone; disabled states; no confirm/undo on bulk read |
| 6 | Recognition Rather Than Recall | 3 | Labeled nav, filter chips, saved views; collapsed icon-only sidebar + hover-only metric meaning |
| 7 | Flexibility and Efficiency | 3 | Saved views, CSV, bulk, date range; NO keyboard accelerators on the core feed (j/k, r, e) |
| 8 | Aesthetic and Minimalist | 3 | Calm, restrained, boxless; signals toolbar density + 6-section overview scroll pull it down |
| 9 | Error Recovery | 4 | Plain-language toasts with retry, ListError retry, optimistic rollback |
| 10 | Help and Documentation | 3 | Strong contextual tooltips, onboarding checklist, Ask feature; no help center |
| **Total** | | **33/40** | **Good** |

## Anti-Patterns Verdict

Does NOT look AI-generated. This is a mature, self-aware system (three-system color discipline, tokenized type scale, mono-as-data, flat tonal depth, boxless sections). It clears the product slop test: a Linear/Stripe/Raycast power user would trust it on sight.

Real violations against its OWN DESIGN.md + the impeccable bans:
- **Side-stripe banned border**: signal-card narrative uses `border-l-2 border-primary/40` (2px cyan left rule) + italic + `text-primary/90`. DESIGN.md explicitly forbids border-left >1px as a colored stripe; italic + accent-alpha prose is off-system and a contrast risk.
- **Spacing drift**: `space-y-[22px]` ×14, `p-[22px]`, `p-[18px]`/`py-[18px]`, `w-[7px] h-[7px]` ×7. The project bans `text-[Npx]` but lets spacing run off the 4/8/16/20/24 scale into unofficial tokens (22 = page rhythm AND card padding; 18 = secondary card padding).
- **Hero-metric reflex (mild)**: 4 identical KPI cells; "Last signal" puts a relative-time string in a 32px mono numeral slot (text in a number role).

Deterministic scan: detector hits were false positives (em-dashes/numbers in CSS comments + line numbers; "broken-image" at competitors/[id]:2250 is a code comment, not JSX).

## What's Working

1. **Decision-first signal card** — insight → So what → Action, severity+category+competitor on one meta line, evidence/feedback in a quiet footer. Lives the "decision over data" principle.
2. **Three independent color systems** (brand cyan / severity / category), all OKLCH with light/dark parity, reinforced by label+icon. The cyan migration removed the old severity-amber clash.
3. **Restraint as identity** — flat surfaces, hairline dividers, boxless sections, KPI strip as banded cells (not nested cards). The landing hero is disciplined (no gradient text, signature digest-mockup dissolving into scroll).

## Priority Issues

### [P1] No keyboard layer on the core feed
- **Why**: Stated north star is Linear/Raycast-class; primary persona is the power user. The feed has zero single-key actions (j/k nav, r=read, e=track, /=focus search). Every action is a mouse trip to a per-card dropdown.
- **Fix**: Add roving j/k focus over feed cards; r toggles read, e opens Track, / focuses search, g+s navigation. cmd-k global search exists; extend the same muscle to the feed.
- **Command**: /impeccable shape

### [P1] Signal narrative violates the system (side-stripe + italic + accent-alpha)
- **Why**: `border-l-2 border-primary/40` is a banned colored side-stripe; italic prose isn't in the type system; `text-primary/90` is accent-on-tint at body size (contrast risk, mirrors the muted-/70 ban).
- **Fix**: Replace with a full hairline container or a `bg-primary/[0.04]` tinted block, drop italic, set text to a solid full-strength token. Treat "narrative" as a labeled context block, not a pull-quote.
- **Command**: /impeccable polish

### [P2] Spacing has drifted off the token scale
- **Why**: 22/18/7px arbitrary values are de-facto unofficial tokens. Same failure mode the text-scale rule was written to prevent; erodes the rhythm the system prides itself on.
- **Fix**: Snap to 20/24, or promote 22 to a real `--space-card` token if load-bearing. Replace `w-[7px] h-[7px]` dots with a size token. Apply the No-Arbitrary rule to spacing.
- **Command**: /impeccable layout

### [P2] Signals toolbar is a wall of controls
- **Why**: One row carries 6 counted tabs + Saved views + Sort + Filters + Search, with CSV + Mark-all-read above. ~10 competing controls breaks the ≤4 working-memory guidance and wraps unpredictably below ~lg.
- **Fix**: Merge Sort into the Filters popover (or an overflow), demote Saved views to an icon, keep tabs + search primary. One primary row, secondary controls grouped.
- **Command**: /impeccable layout

### [P2] KPI strip is the generic-dashboard reflex
- **Why**: 4 equal big-number cells is the hero-metric template the anti-references reject; "Last signal" cell mismatches its numeral slot (text where a stat goes).
- **Fix**: Question whether 4 KPIs earn the vertical space vs folding into the page sub; if kept, give "Last signal" a text-appropriate treatment, not text-stat.
- **Command**: /impeccable distill

## Persona Red Flags

**Alex (power user)**: No j/k or single-key read/track on the feed; Track + feedback require mouse trips to dropdowns; bulk Mark-all-read can't be undone; Sort and Filter are two separate dropdowns (extra clicks for a combined intent).

**Sam (a11y)**: `text-primary/90` narrative is cyan-on-tint at body size (verify ≥4.5:1); the "Signal mix" bar and category band convey breakdown by hue alone with the legend in a hover tooltip (keyboard/SR users miss it); collapsed icon-only sidebar leans on hover tooltips. Severity is well reinforced by icon+label.

## Minor Observations

- Stale "amber" comments throughout post-cyan migration (globals.css:172 "primary = brand amber", signal-card narrative comment, hero comment). Comment debt; DESIGN.md frontmatter description also lags.
- Severity ramp is three warm steps (critical red / high orange / medium amber) at adjacent hues; distinguishable mainly via the icon+label, less so at a glance.
- Hero stacks two 130px-blur radials (static, behind -z-10) — large paint areas; fine but watch on low-end.
- Overview is a long single-column scroll of 6 sections; the "what moved + what to do" answer isn't fully above the fold.

## Questions to Consider

- Does the overview answer "what moved and what do I do" in the first viewport, or does the KPI strip + categories band push the actual signals below the fold?
- Should Sort + Filters + Saved views consolidate into one control cluster?
- Is `22px` actually a design decision? If so it deserves a token; if not, it should be 20 or 24.
