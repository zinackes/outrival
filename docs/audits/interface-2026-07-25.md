# Interface audit, 2026-07-25

Read-only review of the web surface against two written specs: `DESIGN.md` (the
project's own visual system) and the seven `better-*` skills vendored in
`.claude/skills/`. No source file is modified by the audit itself.

Method note: every contrast figure below is measured on the **gamut-mapped**
colour (CSS Color 4 chroma reduction), which is what an sRGB display actually
shows, not on the authored value. The OKLab transform used was validated against
the sRGB primaries (`#ff0000`, `#00ff00`, `#0000ff` round-trip exactly).

Script: `scratchpad/color_audit.py` + `gamut_check.py` + `final_check.py`
(stdlib only, reproducible from `apps/web/src/app/globals.css`).

---

## Phase 0. Compliance with DESIGN.md

The four hard rules `DESIGN.md` states are all respected. This is a clean result,
recorded so the next audit does not re-litigate it.

| Rule | Measured | Verdict |
| --- | --- | --- |
| Type scale in tokens, never `text-[Npx]` | 0 occurrences | Compliant |
| No `text-white` / `bg-white/N` | 2, both on `bg-destructive` (a solid fill) | Correct by intent |
| No low alpha on `text-muted-foreground` | 7, all on `·` separators, `aria-hidden` icons, `marker:` | None is read prose |
| `text-micro` (10px) retired from use | 0 occurrences | Compliant |

### Qualified as non-findings

Measured, inspected, and deliberately rejected rather than reported:

| Candidate | Rejected because |
| --- | --- |
| 51 raw hex values in `.tsx` | OG images and `apple-icon` (Satori reads neither OKLCH nor CSS variables), `global-error` (must render without the CSS bundle), hex inside *comments* documenting a token's resolved value, the digest email sheet (excluded surface), Stripe `appearance.variables` (the API takes a hex string), and the Google logo's brand colours. Plus per-competitor colours, which are `#rrggbb` by design (patch-33). |
| `font-mono` across 80 files | Dominant pattern is `font-mono tabular-nums`, which is the data voice `DESIGN.md` prescribes. `components/ui` and the marketing routes contain zero. |
| `font-mono tracking-[0.3em]` ×4 | All four are OTP, TOTP and backup-code inputs. Letterspaced mono on a 6-digit code is correct. |
| `AnimatePresence` without `initial={false}` | One file, `recap-wrapped.tsx`, the Wrapped slideshow where the entrance is intentional. This is the exception the skill provides for. |
| `will-change` | Already paired with an explicit reset to `auto` and a comment explaining the layer-promotion cost. |

---

## Phase 1. System pass: colour tokens

Scope: `apps/web/src/app/globals.css`, both appearances. Skill: `better-colors`.

### Findings

#### Primary-action contrast

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `globals.css:205,207,208` | `--accent-foreground: #f2f5f8` on `--accent: #6d5eff` measures **4.09:1**, and on `--accent-bright: #7d6fff` (hover) **3.43:1** | Darken `--accent` / `--accent-bright`, or raise the label to pure white, then remeasure | The primary CTA label misses WCAG AA 4.5:1 in the **default** appearance, and hover makes it worse rather than better. `--accent-dim` (active) passes at 5.04:1, so only the resting and hover states fail. APCA is kinder (Lc -69.1 and -63.4, over the 60 non-body floor), so this is a WCAG 2 failure rather than an unreadable control, but it is the most-clicked element in the product. |

The comment at `globals.css:73-77` justifies the light-mode accent by stating the
fill carries white "like the dark-mode Iris fill". Measured, the light fill
clears AA comfortably (5.06 / 6.02 / 7.17 for rest / hover / active) while the
dark fill it cites as the model does not. The stated premise is inverted.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `globals.css:82` | `--link: oklch(0.55 0.14 200)` measures **4.45:1** on `--background` | Lower L until the pair clears 4.5:1 on the canvas, keeping C and H | Links sitting directly on the page canvas miss AA. On a card the same token measures 4.62:1 and passes, so the failure is confined to canvas-level links, which is most of the dashboard. `DESIGN.md` already polices this exact threshold for `text-muted-foreground`. |

#### Surface ramp ordering

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `globals.css:192` | `--night: #191919` (L 0.213) sits **above** `--surface: #161616` (L 0.200) | Bring `--night` under L 0.200, e.g. a value between `--background-2` and `--surface` | Its own comment says the overnight band "stays under the card surface". It does in light (0.945 under 0.998) and does not in dark. The activity strip's asleep hours therefore read as raised above the card containing them. |

#### Authored values that do not render

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `globals.css:78-80,82,99-113,119-124` | 16 OKLCH tokens fall outside sRGB, losing up to 49% of authored chroma (`--accent-dim` C 0.150 renders 0.077) | Either author in-gamut values, or keep them and add an `@media (color-gamut: p3)` layer with an sRGB fallback | These are effectively P3 colours with no fallback. On sRGB the light accent ramp renders `#006266` / `#006e73` / `#007b80`: the chroma differences the values encode are largely discarded, so the palette a reviewer reads in the file is not the palette users see. |

#### Authoring format

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `globals.css:172-220` | `:root` authored in OKLCH, `.dark` neutrals, severity and accent authored in hex | Convert the dark block to OKLCH | Every design rationale in this file is written in lightness terms ("a step below the card surface", "lifts a clear step above", "darkened so the tiers clear AA"), but half the values cannot be read as lightness. The `--night` ordering defect above is the direct consequence: in hex, nobody could see the inversion by reading the file. |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW | `globals.css:177,187,256` | `--surface-3`, `--skeleton-base` and `--sidebar-accent` are all `#242424` | Keep the tokens distinct in value, or document that the collision is intended | Three roles at one value means a skeleton at rest is indistinguishable from a hovered surface and from an active sidebar row. Separate tokens make this cheap to fix later; identical values make it invisible today. |

### Verified as correct

Measured and passing, listed so they are not re-checked next time:

- All four text tiers (`--foreground`, `--muted`, `--muted-2`, `--muted-3`) clear
  4.5:1 on both `--background` and `--surface`, in **both** appearances. The
  comments claiming the muted tiers were darkened/lightened to clear AA are
  accurate: light 4.95 to 17.21, dark 4.55 to 18.09.
- All five severity tokens clear 4.5:1 as text on `--surface` in both appearances.
- All twelve `--cat-*` chips clear 4.5:1 as text on `--surface` in both
  appearances, with a tight lightness band (L spread 0.030 light, 0.040 dark), so
  the twelve read as one system exactly as the comment claims.
- All six `--chart-*` strokes clear the 3:1 graphical floor in both appearances.
- The light accent ramp clears AA on all three interaction states.

### Verification

| Check | Result |
| --- | --- |
| OKLab transform validated against sRGB primaries | `#ff0000`, `#00ff00`, `#0000ff`, `#ffffff` round-trip exactly |
| Contrast measured on gamut-mapped colour, not authored value | Applied; changed the `--link` figure from 4.36 to 4.45, still under floor |
| WCAG 2 and APCA reported side by side | Both, since they disagree on the CTA finding |
| Both appearances checked for every pair | Yes |
| Rendered inspection in a browser | **Not verified.** Deferred to the visual checklist. |

### Verdict

`Needs changes`. One HIGH on the primary CTA in the default appearance, four
MEDIUM, one LOW. Nothing here blocks a release, but the CTA finding sits on the
most-clicked control in the product.

---

## Phase 1. System pass: type scale and primitives

Scope: the `@theme` block of `globals.css`, the 29 `components/ui` primitives,
`lib/motion.ts`. Skills: `better-typography`, `better-ui`.

### Findings

#### The type scale in the specs is not the type scale in the code

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `globals.css:414,417,423` vs `DESIGN.md:230-242` and `apps/web/CLAUDE.md:24` | `--text-title: 26px`, `--text-title-lg: 34px`, `--text-stat: 44px` | Reconcile in one direction and update the losing side | The two spec files agree with each other and both disagree with the code, on the three largest tokens. Every page title and every KPI numeral in the product is one step bigger than what is documented. |

| Token | `DESIGN.md` | `apps/web/CLAUDE.md` | `globals.css` | Drift |
| --- | --- | --- | --- | --- |
| `text-title` | 22px | 22 | **26px** | +4 |
| `text-title-lg` | 26px | 26 | **34px** | +8 |
| `text-stat` | 32px | (32) | **44px** | +12 |

The semantic mapping drifted with the values. `DESIGN.md` maps both title tokens
to `h1` at two breakpoints; the comments in `globals.css` map `--text-title` to
H2 and `--text-title-lg` to H1. These describe different documents.

This is the one place where the answer to "does the site match what is written"
is no. It also matters more than its size suggests: `apps/web/CLAUDE.md` is what
an agent reads before writing UI, so an agent reaching for `text-title` expecting
22px silently ships 26px.

#### Two names for one value

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW | `globals.css:376,379,414,417` | `--text-title` and `--text-2xl` are both 26px; `--text-title-lg` and `--text-3xl` are both 34px | Keep the semantic pair and derive the numeric pair from it, or drop one | Two tokens at one value drift apart the first time someone tunes only one of them. |

#### Shared-primitive polish

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `components/ui/button.tsx:16` | `transition-all duration-[150ms] ease-out` on the button base | `transition-[color,background-color,border-color,box-shadow,scale]` | `transition: all` animates every property that ever changes, including layout-affecting ones, and it is the single highest-reach declaration in the app. `feedback-buttons.tsx` already uses the explicit form, so the correct pattern exists in the codebase. |
| MEDIUM | `components/outrival/feedback-buttons.tsx:180,198` | `active:scale-90` | `active:scale-[0.97]`, matching the button base | `better-ui` sets a hard floor at `0.95` and calls anything below it exaggerated. `0.90` is well under. |
| LOW | `components/outrival/feedback-buttons.tsx:218` | `active:scale-95` | `active:scale-[0.97]` | Third distinct press value in a codebase whose shared base is `0.97`. |
| LOW | `components/ui/checkbox.tsx:17` | `rounded-[4px]` | `rounded-sm` | `--radius-sm` is exactly 4px, so this is a token bypass with an exact token equivalent. |
| LOW | `app/(onboarding)/onboarding/onboarding-form.tsx:1019` | `transition-all` | Name the properties that change | Same rule, in application code rather than a vendored primitive. |

### Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| `globals.css`, all card and control surfaces | `better-ui` §3 prefers layered transparent `box-shadow` over borders for elevation | `DESIGN.md` states the opposite as a deliberate identity choice: "depth comes from hairline borders + lightened surfaces, never heavy shadows". The project spec wins over the generic rule. |
| `components/ui/progress.tsx`, `accordion.tsx`, `sidebar.tsx`, `switch.tsx` | `transition-all` in four more primitives | These are unmodified shadcn defaults. Editing them diverges from upstream and costs on every `shadcn add`, for a symptom nobody has reported. Revisit if one of them shows a real stutter. |
| `components/ui/tooltip.tsx:131` | `rounded-[2px]` bypasses the radius scale | It is the tooltip arrow, a 10px glyph. The scale's roles (badges, buttons, cards, modals) do not describe it. |
| Legal, changelog and policy pages | Pages whose `page.tsx` contains only `h2` | Verified: the `h1` comes from the shared `DocPage` wrapper via `legal-doc.tsx`, and dashboard pages get theirs from `page-head.tsx`. The hierarchy is sound. |
| `lib/motion.ts` | Feed exit uses `scale: 0.97` while press uses the same number for a different meaning | Distinct contexts (list exit vs pointer feedback), no user-visible collision. |

### Verification

| Check | Result |
| --- | --- |
| Type token values read from `globals.css`, not from the docs | Yes, all three divergences confirmed against source lines |
| Heading hierarchy traced to the rendering wrapper before reporting | Yes, cleared as a non-finding |
| Radius bypasses checked against the actual token values | Yes, `rounded-[4px]` equals `--radius-sm` exactly |
| Motion inspected at reduced speed in a browser | **Not verified.** Deferred to the visual checklist. |
| Press feedback felt on a real pointer and on touch | **Not verified.** Deferred. |

### Verdict

`Needs changes`. One HIGH (the spec-versus-code type scale), two MEDIUM, four LOW.

---

## Phase 2A. Flow review: `/auth`

Orchestrated by `better-interface`, mode `full`.

### Scope and coverage

Scope narrowed from "acquisition" (landing + `/auth` + an `/alternatives` page) to
**`/auth` alone**: the sign-in flow end to end, covering the email step, the OTP
code step, the password fallback, the TOTP and backup-code step, and the passkey
and Google entry points. `apps/web/src/app/(auth)/auth/auth-form.tsx`, 799 lines.
The landing and comparison pages were **not** inspected and are not covered by
this verdict.

Stack: Next.js App Router client component, Tailwind v4 with the project's token
scale, shadcn/ui primitives, Better Auth client.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Field labelling, submit states, error association, OTP widget keyboard model, hit areas | 5 findings |
| Layout | Field stack, divider, button insets, six-box row at `sm` | Clear (320px reflow not verified) |
| Writing | Button labels, flow vocabulary, error strings, the password-recovery affordance | Clear |
| Typography | Input sizing vs iOS zoom, error text size against the project floor | 1 finding |
| Colours | Token-level pairs already measured in Phase 1; no screen-local colour introduced | Clear |
| UI | Loading affordances, focus styling, press feedback | 1 finding |

### Findings

| # | Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | MEDIUM | Accessibility | `auth-form.tsx:426`, `:404` | `disabled={!email \|\| status === "loading"}` and `disabled={!email \|\| !password \|\| ...}` | Keep enabled until the request starts; validate on submit and focus the first invalid field | A submit disabled until the form is valid gives a dead control with no stated reason. `better-accessibility` §7 names this exact anti-pattern. The user cannot ask the form what is wrong. |
| 2 | MEDIUM | Accessibility | `auth-form.tsx:366-375` sets it, `:449-453` renders it | Blur validation writes to a page-level centred `role="alert"` at the bottom of the card | Add `aria-invalid` on the field, point `aria-describedby` at an error node rendered next to it | The failing field never announces that it is invalid, and returning to it gives no context. `better-writing` §10 wants the instruction adjacent to the break; here it is detached and centred. |
| 3 | MEDIUM | Accessibility | `auth-form.tsx:359-379`, `:384-392` | `aria-label` + `placeholder`, no visible `<label>` | Add a visible `<label for>` for each field | Assistive tech is covered by `aria-label`, but the placeholder is doing the visible labelling and it disappears on first keystroke. Classic placeholder-as-label, `better-accessibility` §6. |
| 4 | MEDIUM | Accessibility | `auth-form.tsx:393-400` | A 16px icon in a button with no padding, so a roughly 16×16 target | Pad to at least 24×24, or extend with a pseudo-element | Under WCAG 2.5.8's Level AA baseline. The field is 38px tall, so the room exists. |
| 5 | MEDIUM | Typography | `auth-form.tsx:450`, `:548`, `:657` | `text-xs` (12px) on every error message | `text-sm` (14px) | `DESIGN.md` §3's Small-Text Floor Rule floors read prose, helper text included, at 14px. The documented 12-13px exception is for **form field labels**, not error text. The most important sentence on the screen is set below the project's own floor. |
| 6 | LOW | Accessibility | `auth-form.tsx:766-771` | `invalid` drives `border-destructive` only | Add `aria-invalid={invalid}` to each box | The visual invalid state has no programmatic equivalent. The adjacent `role="alert"` carries the message, so this is a gap rather than a failure. |
| 7 | LOW | UI | `auth-form.tsx:406-408` vs `:426-433` | One submit keeps its label and adds a spinner; the other swaps both label and icon | Pick one pattern for the submit class | Two behaviours for the same action type on the same screen. `better-ui` §15 wants motion and state change to be consistent, not per-button. |

### Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| `components/ui/input.tsx:14` | Input font size triggering the iOS focus-zoom | Verified rather than assumed: the field is `text-base` (16px), at the threshold. No zoom, no finding. |
| `auth-form.tsx:768` | `focus:` rather than `focus-visible:` on the OTP boxes | For text inputs, showing the focus treatment on click is conventional and wanted. The `focus-visible` rule targets controls where a mouse ring is noise. |
| `auth-form.tsx:769` | Invalid state carried by border colour alone | A `role="alert"` message renders directly beneath, which is the redundant cue `better-accessibility` §9 asks for. |
| `auth-form.tsx:397` | Physical `right-2` instead of a logical property | The product ships English only per `.claude/rules/language.md`. RTL is not a supported direction, so logical properties buy nothing here. |
| `auth-form.tsx:352-356` | The "or" divider and the `aria-hidden` separators | Correct as written. The divider reads naturally and the decorative spans are properly hidden. |

### Verification

| Check | Result |
| --- | --- |
| OTP widget keyboard model read in full | Arrow keys, backspace-then-step-back, paste distribution, `inputMode="numeric"`, `autoComplete="one-time-code"`, 40px boxes. Sound, no finding. |
| Input font size checked against source before reporting an iOS zoom finding | `text-base`, cleared |
| Small-text floor checked against `DESIGN.md` §3 rather than from memory | Confirmed at `DESIGN.md:260-266` |
| Keyboard walk of the complete flow in a browser | **Not verified.** Deferred to the visual checklist. |
| Screen-reader announcement of the error and OTP steps | **Not verified.** Deferred. |
| 320px reflow and 200% zoom | **Not verified.** Deferred. |
| Landing and `/alternatives` pages | **Not reviewed.** Out of the narrowed scope. |

### Verdict

`Needs changes`. Five MEDIUM, two LOW, no HIGH. Nothing blocks sign-in, but
findings 1, 2 and 5 compound on the same failure path: a user who mistypes their
email gets a dead button, an error that their field never claims, and that error
set below the project's own legibility floor.

---

## Phase 2B/2C/3. Systematic scan across the remaining surfaces

### Scope boundary, stated plainly

This is **not** three more full-mode `better-interface` runs. A per-flow deep read
was done once, for `/auth`. For the dashboard, competitor detail, onboarding and
the copy layer, what follows is a systematic scan for the specific rule classes
that had already produced findings, applied across every non-admin `.tsx` file.

That trades depth for breadth on purpose. It catches a rule violated in twenty
places and misses a subtle single-screen composition problem. The per-flow reads
of the dashboard and onboarding remain genuinely **not reviewed**.

### Findings

| # | Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | MEDIUM | Accessibility | `add-product-wizard.tsx:311-315,331-335` is the only correct instance; `auth-form.tsx` is the counter-example | Exactly 2 files in the app use `aria-describedby`; the wizard is the only form that pairs it with `aria-invalid` and an adjacent error node | Make the wizard's pattern the default for every validated field | The correct pattern is already written, proven, and shipped. It is not missing knowledge, it is an unapplied default. This is the same shape as `transition-all`: `feedback-buttons.tsx` names its transition properties, the shared `button.tsx` base does not. |
| 2 | MEDIUM | Accessibility | `feedback-widget.tsx:178`, `update-profile-dialog.tsx:429` | `disabled={!message.trim()}` and `disabled={!sourceValid \|\| analyzing}` | Keep enabled, validate on submit | Same anti-pattern as `/auth`. Distinct from the roughly 27 other `disabled={!x}` uses in the app, which gate on plan availability or an explicit acknowledgement and are correct: `better-accessibility` §7 permits `disabled` when a control is genuinely unavailable. |
| 3 | LOW | Writing | `auth-form.tsx:122`, `demo-form.tsx:74,79`, `security-settings.tsx:65` | `"Something went wrong. Please try again."` as the server-message fallback | Name the action that failed: "Unable to sign in. Check your connection and try again." | `better-writing` §10 uses this exact string as its bad example. Each of these four call sites knows what the user was doing, so the generic string discards context the code already holds. |

### Verified clean

Scanned across every non-admin component and route. These came back with nothing,
which is worth recording because they are the checks that usually produce noise:

| Check | Result |
| --- | --- |
| Icon-only `<Button size="icon">` without an accessible name | **0** |
| `<img>` without `alt` | **0** |
| `<div>` / `<span>` with `onClick` standing in for a control | **1**, and it is `stopPropagation` on an action cluster, with a comment explaining why the row must not swallow the click. Correct. |
| `"Click here"` | 0 |
| Bare `"Learn more"` link text | 0 |
| `"Oops"` | 0 |
| `Yes` / `No` / `OK` as button labels on consequential actions | 0 |
| Exclamation marks in user-facing copy | 0 |
| Arbitrary `text-[Npx]` sizes | 0 |

The copy layer is in notably good shape. `better-writing`'s most common findings
simply do not occur here, and the two remaining `"Something went wrong"` strings
sit in error boundaries (`global-error.tsx`, `dashboard/error.tsx`) where the code
genuinely does not know what failed, so they are correct as written.

### Verdict

`Needs changes` on the two MEDIUM findings. The breadth scan found no systemic
accessibility failure outside the form-validation pattern.

---

## Remediation status

### Landed

**PR 1**, the zero-risk batch. Verified by re-parsing `globals.css` from disk and
gamut-mapping every token, not by re-running numbers hardcoded in a script.

| Finding | Was | Now |
| --- | --- | --- |
| Dark CTA at rest under AA | 4.09:1 | **4.54:1**, via `--accent` L .590 → .586 (`#6c5dfd`) and the label taken to pure white. Pure white alone only reached 4.47:1, so both had to move. |
| `--night` above the surface it belongs to | L 0.213 vs card 0.200 | **L 0.187**, back between `--background-2` and `--surface` |
| `--link` under AA on the canvas | 4.45:1 | **4.51:1**, L .55 → .547 |
| Type scale: specs disagree with code | `DESIGN.md` and `apps/web/CLAUDE.md` said 22/26/32 | Both now say **26/34/44**. Settled by history: `d5dfc36` (Precision Instrument, 2026-06-21) bumped the tokens deliberately and did not touch the specs, so the code was the intended state. |
| `globals.css` calling `--text-title` "H2" | Comment claimed H2/H1 split | `page-head.tsx:26` renders `<h1 className="text-title md:text-title-lg">`, so both are the same `h1` at two breakpoints. Comments corrected. |

Also confirmed unbroken: the dark active state stays darker than rest (L 0.539 vs
0.586), so the interaction ramp order survives the change.

**PR 2**, the CTA hover model. `hover:bg-accent-bright` is replaced by
`hover:inset-ring-2 hover:inset-ring-accent-bright` on the primary variant: hover
now lights the **edge** instead of the fill, so the label's background never
changes and the engaged state stops being the least legible one.

`inset-ring` rather than `ring` on purpose. Compiling the utilities confirms the
two land on separate `box-shadow` layers (`--tw-inset-ring-shadow` and
`--tw-ring-shadow`), so hovering a keyboard-focused button cannot collapse the
3px focus ring. That was verified by running the Tailwind CLI over the classes,
not assumed from the docs: an invalid utility name fails silently and `tsc` would
never catch it.

`--accent-bright` keeps its value and loses its fill role. `DESIGN.md` §5, which
said "Hover → Cyan Bright", now describes the edge model and records the 3.43:1
measurement that forced it.

**PR 3**, the `/auth` form. Closes findings 1, 2, 5 and 6 of the Phase 2A table,
which all sat on the same failure path.

Both handlers already validated on entry and returned early, so the "validate on
submit" path existed; the disabled button was what made it unreachable. Removing
`!email` / `!password` from the `disabled` expressions turns that dead code live.

Errors now belong to a field: a `fieldError` state drives `aria-invalid` and
`aria-describedby` on the input, renders the message next to it at `text-sm`, and
moves focus there. One `failField` helper sets message, invalid state and focus
together so no caller can set two of the three and leave a field silently
invalid. Blur-time validation passes `focus: false`, since pulling focus back
into the field the user just left would trap them.

The shared bottom region now renders only form-level errors (server, network,
captcha), so a field error is never announced twice.

Verified that `Input` actually forwards its ref: it is a React 19 function
component spreading `...props` onto the `<input>`, so `focus()` reaches the DOM
node. Had it not, the focus half of the fix would have failed silently and `tsc`
would not have noticed.

Left alone as agreed: the same disabled-until-valid pattern in
`feedback-widget.tsx:178` and `update-profile-dialog.tsx:429`. Also left alone:
the placeholder-as-label finding, since visible labels would change the look of a
deliberately minimal screen.

**PR 4**, primitives polish. Closes the remaining LOW and MEDIUM findings.

`transition-all` on the button base becomes an explicit list. The properties were
enumerated by cross-checking every state the variants declare, then the rule was
compiled to confirm it generates. `underline` on the `link` variant is the one
state left out, deliberately: `text-decoration-line` is not animatable, so
`transition-all` was not animating it either.

Press feedback is now one value. `scale-90` twice and `scale-95` once become
`scale-[0.97]`, matching the shared base. `scale-100` on the `link` variant stays:
that is the deliberate opt-out `better-ui` provides for.

Also: `rounded-[4px]` on the checkbox becomes `rounded-sm` (identical value, via
the token), `transition-all` in `onboarding-form.tsx` is enumerated, and the OTP
boxes finally expose `aria-invalid`.

Three of the four generic `"Something went wrong"` fallbacks now name the action
that failed. The fourth, `security-settings.tsx:65`, is left alone: it sits in a
generic fetch helper that genuinely does not know what the caller was doing, the
same reason the two error boundaries keep theirs.

### Found while fixing: shadows

`DESIGN.md` §4 states the system "defines **no** shadow tokens", that depth comes
from tonal surfaces and hairline borders, and that outside true overlays "shadow
is forbidden". `globals.css:377-378` defines `--shadow-e2` and `--shadow-e3`, and
the primary button carries `shadow-e2` (6 consumers in total).

Not fixed here, because it is a real decision rather than a slip: either the
button drops its shadow, or §4 stops claiming the system has none. Flagged
because the original plan for this PR was to intensify that shadow on hover,
which would have deepened exactly what the spec forbids.

Two smaller ones spotted alongside, both unfixed: `DESIGN.md` §5 says buttons are
36px tall (`h-9`) while `button.tsx:43` ships `h-[38px]`, and `--shadow-e3`
hardcodes `rgba(109, 94, 255, …)`, which was the accent value before PR 1.

### Still open
- `/auth` form behaviour, PR 3. Primitives polish, PR 4.
- The 16 out-of-gamut tokens and the three roles sharing `#242424`, both parked
  pending the visual checks below.

## Visual verification checklist

Everything below needs a rendered browser and a human. Grouped by what you need
open, so it is a handful of sittings rather than fourteen errands.

### A. Dark theme, any dashboard page

1. **Primary CTA contrast.** Find a primary (Iris-filled) button. Screenshot it at
   rest, then hovered. The measurement says the label sits at 4.09:1 at rest and
   **3.43:1 on hover**, both under AA. What I need from you is the judgement call:
   does the hover state read as *less* legible than rest? If yes, that confirms
   the ranking and it should be fixed before the rest of the colour work.
2. **Overnight band ordering.** Open `/dashboard/activity`. The band behind the
   asleep hours (`--night`) measures L 0.213 against the card's L 0.200, so it is
   computed as *raised above* the card it sits in, which contradicts its own
   comment. Screenshot the strip. Does the band read as sitting on top of the
   card, or behind it? A photo settles it faster than more arithmetic.

### B. Chrome DevTools, Animations panel, dashboard signals feed

3. **Motion at 10% speed.** Open the Animations panel, set speed to 10%, then
   toggle a filter on the signals feed so rows enter, exit and reorder. Record it.
   Watch for: a row that jumps rather than settles, a detail panel whose last line
   clips as the height animates, and whether fast repeated toggling ever looks
   laggy. `lib/motion.ts` uses one spring for both the list and the panels, so
   they should move as one hand.
4. **Press feedback side by side.** On a signal card, press a feedback button
   (thumbs) and then a normal Button. The feedback buttons use `scale-90`, the
   shared base uses `scale-[0.97]`. Screenshot or just tell me: does the feedback
   button visibly squash more than the others?

### C. `/auth`, keyboard only, no mouse

5. **Focus walk.** Tab from the top through: Google, passkey if enabled, email
   field, Continue, the password toggle, and back. Every stop must show a visible
   ring. Note any stop where the ring vanishes or is clipped.
6. **The error path.** Type a deliberately malformed email, then Tab away. Three
   things to check: does the Continue button look dead before you can submit, does
   anything announce the error if you have VoiceOver or NVDA on, and does the error
   text look small to you. All three are reported findings, this confirms them.
7. **The password reveal target.** Switch to the password fallback and try to hit
   the eye icon with a finger on a phone. It measures about 16×16px, under the
   24×24 baseline. Tell me if you miss it.

### D. Any browser, `/auth` and the signals feed

8. **Reflow.** Set the window to 320px wide, then set zoom to 200%. Nothing should
   scroll horizontally and no control should be clipped. Screenshot anything that
   breaks.

### E. If you have a P3 display

9. **Accent saturation.** 16 colour tokens are authored outside sRGB, up to 49% of
   the chroma. On a P3 screen you see close to the authored colour; on an sRGB
   screen the light accent renders `#006266` / `#006e73` / `#007b80`. If you can
   compare two screens, tell me whether the brand accent looks like the same colour
   on both. That decides whether this is worth a P3 fallback layer or a rewrite to
   in-gamut values.
