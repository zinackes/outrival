# Email design — refresh (OUT-15)

How the transactional emails are designed, and why. The renderers live in
`packages/shared/src/email/` (`theme.ts` → `shell.ts` → `digest.ts` / `lifecycle.ts`);
the per-job bodies live in `apps/workers/src/core/*` and `apps/api/src/lib/sign-in-email.ts`.
Design artefacts: `docs/design/emails/*.html` (committed, open in a browser) and the
live side-by-side at `/dev/preview-emails`.

## Why this was opened

Twelve emails share one shell, and that shell was authored against a palette that
does not exist in the product. The gap, measured before touching anything:

| # | Gap | Evidence |
|---|-----|----------|
| 1 | **The accent is the wrong colour.** Emails fill CTAs with indigo `#4f46e5`. | The product's light accent is deep cyan `oklch(0.53 0.14 200)`; indigo is the **dark-mode** accent (`#6c5dfd`). The light email — the render every client shows by default — used a colour that appears nowhere in the light product. |
| 2 | **Neutrals are Tailwind zinc, not the product ramp.** | Email `#fafafa`/`#ffffff`/`#e4e4e7` vs `globals.css` `#f9fafb`/`#fefeff`/`#dcdee1` (hue-260 tinted). Dark: `#171717`/`#262626` vs `#161616`/`#2d2d2d`. |
| 3 | **Severity drifted in dark mode.** | Email `#ef4444`/`#f59e0b`/`#22c55e` vs product `#ff5c72`/`#ffc247`/`#34d399`. Light happened to match. |
| 4 | **Severity carried by hue alone.** | A coloured `<h3>` is the only urgency cue. DESIGN.md §2: severity is "always reinforced with label and icon, never hue alone". |
| 5 | **Emoji-as-UI.** | 👍/👎 in the digest footer, 🚨🔴🟡🟢 on every daily-briefing row. DESIGN.md §1 rejects emoji-as-UI explicitly; `send-alert.ts` already documents the same rule for in-app notifications. |
| 6 | **No hierarchy.** | "Needs an answer" and "Noted" render as identical bordered cards. The reader has to parse the heading to know what matters. |
| 7 | **No type scale.** | Every call site hand-picks px (21/15/14/13/11). Prose sits at 13px — below the 14px floor DESIGN.md §3 sets, and the primary read (insight) at 15px was the only correct one by accident. |
| 8 | **No preheader.** | Inboxes preview the first body text, so every digest previews as "Your weekly competitive briefing · 2026-07-13 to…" instead of the week's verdict. |

## Options considered

| | Option | Effort | Trade-off |
|---|---|---|---|
| **A** | **Token re-alignment only** — swap `EMAIL_LIGHT`/`EMAIL_DARK` to the exact `globals.css` values, nothing else moves. | ~2 h | Fixes gaps 1–3 in one file; all twelve templates inherit it; near-zero risk. Fixes brand coherence but **not** the UX criterion — the digest still reads as a flat card list. |
| **B** | **Tokens + shell/type/layout refresh** (recommended) — A, plus a role-based type scale, a shell with preheader + hairline-separated header, and the digest restructured to boxless severity groups. Rolled across every template that shares the shell. | ~6 h | Hits both acceptance criteria. The type scale is what stops gap 7 recurring. Cost: touches 8 files, and the shell/digest tests need to follow. |
| **C** | **Rebuild on react-email / MJML.** | ~2–3 d | Components and better Outlook coverage for free. Rejected: it puts React into `@outrival/shared`, the leaf of the dependency graph that web, api **and** workers all import — and the hand-rolled shell already solves the two genuinely hard client problems (forced dark-mode inversion, `<style>` stripping) with the reasoning committed next to the code. 10× the cost for a marginal rendering gain. |
| **D** | **Visual maximalism** — competitor logos, charts rendered to PNG, gradient headers. | ~1.5 d | "Attractive" in the naive sense. Rejected: charts would need a runtime image pipeline on R2, remote images are blocked by default in Outlook and in Gmail-with-images-off (so the design would degrade to nothing for a large share of readers), and DESIGN.md §6 rejects gradient headers and decorative chrome by name. |

**Chosen: B.** A alone fails the brief's second acceptance criterion; C and D both spend
days buying something the design system explicitly does not want.

## What B is

### 1. One palette, taken from `globals.css`

`theme.ts` now carries the product's own values. OKLCH tokens are gamut-mapped to sRGB
by chroma reduction (what a browser does), because email has no `oklch()`.

| Role | Light | Dark | Source token |
|---|---|---|---|
| canvas | `#f9fafb` | `#0a0a0a` | `--background` |
| surface | `#fefeff` | `#161616` | `--surface` |
| surfaceAlt | `#f0f2f4` | `#1d1d1d` | `--surface-2` |
| border | `#dcdee1` | `#2d2d2d` | `--border` |
| text | `#181b1f` | `#f2f5f8` | `--foreground` |
| muted | `#535861` | `#9aa2ad` | `--muted` |
| faint | `#696e76` | `#79808c` | `--muted-3` |
| accent (fill) | `#007b80` | `#6c5dfd` | `--accent` |
| accent (text) | `#007b80` | `#9a8cff` | `--accent` / `--link` |
| critical · high · medium · low · positive | `#b91c1c` `#c2410c` `#a16207` `#52525b` `#047857` | `#ff5c72` `#ff8a5b` `#ffc247` `#5b9cff` `#34d399` | `--critical`… |

Dark `border` is `rgba(255,255,255,0.1)` composited over the card surface — email
cannot use alpha borders reliably, so the composite is stored flat.

Every foreground/background pair used in the templates clears WCAG AA 4.5:1 in both
modes; white on the light accent fill measures 5.07:1, on the dark fill 4.54:1.

### 2. A type scale, not per-call-site pixels

`t(role, extra)` in `theme.ts` returns the layout CSS for one role and composes with
`e()`, which keeps owning colour: `e("muted", t("dense"))`. The roles map DESIGN.md §3
onto the sizes email can actually hold:

| Role | Size / weight | Use |
|---|---|---|
| `display` | 22 / 600 / -0.02em | the week's verdict |
| `title` | 17 / 600 / -0.015em | single-subject email h1 |
| `heading` | 15 / 600 / -0.01em | section heads |
| `lead` | 15 / 400 / 1.55 | the primary read (insight) |
| `body` | 14 / 400 / 1.6 | prose floor |
| `dense` | 13 / 400 / 1.5 | secondary meta lines |
| `meta` | 11 / 500 / 0.04em | label floor (timestamps, footer) |
| `stat` | 28 / 600 / tabular-nums | recap figures |

Prose that sat at 13px moved to 14–15px. 11px stays only where DESIGN.md allows it:
labels and the footer.

### 3. Structure

- **Preheader** — a hidden first node carrying the email's own headline, so the inbox
  preview shows the verdict instead of the date range. No new copy: it reuses a string
  the email already renders.
- **Header** — wordmark, then a hairline. Regions separate with a 1px border, per §4
  (flat by default, depth from tonal steps and hairlines — never shadow).
- **Digest body** — boxless. Each urgency group is a heading (severity dot + label +
  count) over rows separated by hairlines, instead of three identical bordered cards.
  §5: "Boxless is preferred for dashboard sections… Depth from rhythm, not boxes."
  Cards survive where a single object is genuinely being highlighted: the sign-in code
  box, the all-quiet panel, the first-change celebration.
- **Severity dot** — a 8px square of the severity colour beside its label, so urgency
  is never hue-only and survives a client that drops colour.
- **Buttons** — a `<table>` with `bgcolor` and a padded `<td>` around the anchor.
  Outlook's Word engine honours cell padding but not anchor padding, so this renders
  as a real button there instead of a bare link. No VML: labels are variable-width and
  `v:roundrect` needs a fixed one.
- **Emoji removed from rendered HTML.** Subject lines and Slack payloads are untouched
  (they are content). 👍/👎 became text links, the daily briefing's 🚨🔴🟡🟢 became the
  severity dot.

### Not changed

Copy, data, section order, section presence, subject lines, and every degradation
contract (`readUrl` / `feedbackLinks` / `unsubscribeUrl` absent → block omitted).
The email tests assert wording and ordering; they still pass unmodified.

## Regenerating the artefacts

```bash
pnpm --filter @outrival/shared email:preview   # writes docs/design/emails/*.html
```

Each file renders light and dark side by side, from the same sample data as
`/dev/preview-emails`, in one self-contained page with no external assets.
