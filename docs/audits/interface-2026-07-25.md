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

## Still to run

- Phase 1 remainder: `better-ui` on the 29 `components/ui` primitives, and
  `better-typography` on the type scale.
- Phase 2A/2B/2C: `better-interface` per flow.
- Phase 3: `better-writing` transverse copy pass.
