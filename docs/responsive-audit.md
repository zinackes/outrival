# Responsive audit — web app

_Date: 2026-06-28 · Branch: `chore/responsive-audit` · Scope: all of `apps/web` (landing + dashboard + settings + auth + onboarding + admin + UI primitives)._

Method: **hybrid**.
- **Live** — Chrome DevTools device emulation against prod (`outrival.app`) at 375×812 (mobile) and 768×1024 (tablet), public pages only (dashboard is behind login). Measured real horizontal overflow (`scrollWidth` vs `clientWidth`) + per-element offenders.
- **Static** — 4 parallel passes over the codebase (landing/public · dashboard core · settings/auth/onboarding · UI primitives + admin), Tailwind mobile-first semantics, verified each finding in context.

## Verdict

The app is **fundamentally responsive — 0 critical issues**. No public page produces global horizontal scroll on a 375px phone (`scrollWidth == clientWidth` on landing, changelog, status). The foundations are right:

- Dashboard shell sidebar collapses to a **Sheet drawer** on mobile (shadcn `Sidebar` + `SidebarTrigger`).
- Settings sub-rail also collapses to an off-canvas Sheet.
- Signals master-detail **stacks below `lg`** and opens a full-screen sheet with a Back button.
- All 6 wide `<table>`s are wrapped in `overflow-x-auto`; charts use Recharts `ResponsiveContainer`.
- Most card/KPI grids use proper `grid-cols-1 sm:/lg:` ladders.

The real work is concentrated: **2 shared UI primitives** (highest leverage — they propagate everywhere) plus a handful of pages where a fixed-width row or grid doesn't collapse. Nothing here is a rewrite.

Counts: **Critical 0 · High 6 · Medium 8 · Low ~12.**

---

## High — fix first

### Primitives (highest leverage — affect every page)

- `apps/web/src/components/ui/dialog.tsx:41` — **DialogContent has no max-height and no internal scroll**, and is centered via `top-1/2 -translate-y-1/2`. Any dialog taller than the viewport spills past the top edge and is **unreachable** (you can't scroll up to it). Same line: `w-full max-w-lg` with no gutter → dialog is **edge-to-edge** (square corners) on phones.
  · *bp:* short/mobile viewports · *fix:* add `max-h-[calc(100dvh-2rem)] overflow-y-auto` and change `w-full` → `w-[calc(100%-2rem)]`. One edit fixes both the clipping and the edge-to-edge.

- `apps/web/src/components/ui/tabs.tsx:28` — **`tabsListVariants` has no `overflow-x-auto`** and `TabsTrigger` is `whitespace-nowrap`. A long TabsList overflows/clips with no scroll. Propagates to competitor detail, settings, admin (every multi-tab surface).
  · *bp:* ~5+ tabs under ~400px · *fix:* add `max-w-full overflow-x-auto [scrollbar-width:none]` to the list base.

### Pages

- `apps/web/src/app/dashboard/competitors/[id]/competitor-detail-view.tsx:1780` — expanded **Sources** rows are a non-wrapping `flex` packing `w-[104px]` label + `w-12` freq + `ml-auto` action group; the wrapping `<Card overflow-hidden>` (line 1713) **clips** the trailing rescan/Run buttons instead of scrolling them.
  · *bp:* ≤420px · *fix:* `flex-wrap` on the row (drop `ml-auto`) or make the rows container `overflow-x-auto`; relax the fixed `w-[104px]`/`min-w-[84px]`.

- `apps/web/src/app/(onboarding)/onboarding/onboarding-form.tsx:826` — header control row (`Restart` + `Leave for now` + `Sign out`, all `whitespace-nowrap`) + wordmark in `flex justify-between` exceeds the `max-w-3xl px-4` content box → **horizontal scroll** on small phones.
  · *bp:* ≤375px (clearly broken ≤360px) · *fix:* hide labels below `sm` (`<span className="hidden sm:inline">`, keep icons) or collapse the three controls into a dropdown.

- `apps/web/src/app/(auth)/auth/auth-form.tsx:737` — OTP row of six fixed `size-12` (48px) boxes needs ~328px but the card interior is ~248–278px on phones; boxes flex-shrink to ~35px wide while height stays 48px → **non-square, below 44px touch target**.
  · *bp:* all phones · *fix:* `size-10 sm:size-12`, `gap-1.5`, and step card padding (`p-6 sm:p-8`, line 280).

- `apps/web/src/components/landing/hero.tsx:70` — signature timeline = 50 fixed `w-[5px]` bars + `gap-[5px]` (~495px) in a `justify-center` row inside an `overflow-hidden` section → **both ends silently cropped** on phones (confirmed live: bars at `left:-60` and `right:435`).
  · *bp:* 375px (degrades up to ~520px) · *fix:* wrap in `overflow-x-auto` (`justify-start sm:justify-center`), or make bars `flex-1 min-w-px` so the set scales to the container.

---

## Medium

- `apps/web/src/components/dashboard/topbar.tsx:32` — fixed `h-[52px]` non-wrapping flex with **8 always-visible controls**; total fixed width overflows ≤390px, squeezing the `flex-1` spacers to 0. · *fix:* hide secondary controls below `sm` (`hidden sm:inline-flex` on Refresh/ThemeToggle/WhatsNew) and drop the "Ask" label.
- `apps/web/src/app/(admin)/admin/layout.tsx:18` — admin sidebar is `hidden md:block` with **no mobile nav fallback** → zero navigation under 768px. · *fix:* add a mobile Sheet trigger reusing `AdminNav` (admin is internal — lower stakes, but currently unusable on phone).
- `apps/web/src/app/dashboard/discovery/discovery-view.tsx:453` — `grid-cols-[repeat(auto-fill,minmax(320px,1fr))]`: 320px floor + `px-4` gutters overflows ≤360px. · *fix:* `minmax(min(320px,100%),1fr)`.
- `apps/web/src/app/dashboard/products/my-product-view.tsx:130` (also `:428`) — `grid-cols-[140px_1fr]` keeps a fixed 140px label column at every width; value column squeezed to ~100px on ≤360px. · *fix:* `grid-cols-1 sm:grid-cols-[140px_1fr]`.
- `apps/web/src/app/(onboarding)/onboarding/onboarding-form.tsx:1532` — competitor URL `<a>` has no `truncate`/`break-all`; a long unbroken domain overflows its `flex-1 min-w-0` cell. · *fix:* `truncate min-w-0` span (or `break-all max-w-full`).
- `apps/web/src/components/landing/digest-mockup.tsx:143` — `grid-cols-4` stat strip (Signals/Critical/Changes/Sources), no mobile fallback; "Critical" nearly fills its ~82px cell at 375px. · *fix:* `grid-cols-2 gap-px sm:grid-cols-4`.
- Admin stat grids — unprefixed `grid-cols-3` at `enrichment/page.tsx:55`, `multi-product/page.tsx:96`, `delivery/view.tsx:119`: ~115px/col on 375px, cramped for `text-2xl` numbers. · *fix:* `grid-cols-1 sm:grid-cols-3`.
- `apps/web/src/components/ui/command.tsx:31` — `CommandDialog` inherits the dialog edge-to-edge width (fixed by the dialog primitive change above). · *fix:* none once dialog is patched.

---

## Low — polish

**Touch targets < 44px:**
- `apps/web/src/components/landing/nav.tsx:76` — mobile menu toggle `size-9` (36px) → `size-11` / `p-2.5`.
- `apps/web/src/app/(auth)/auth/auth-form.tsx:626` — "Trust this device" checkbox `size-3.5` (14px) → enlarge hit area.
- `apps/web/src/components/ui/calendar.tsx:47` — `day_button` `size-9` (36px) (data-dense, acceptable).
- `apps/web/src/components/ui/pagination.tsx:103` — numbered links `icon-sm` (~32px).

**`100vh` → `100dvh`** (project convention, mobile browser chrome): `app/page.tsx:28`, `landing/doc-page.tsx:22`, `auth-form.tsx:262`, `dashboard/signals-view.tsx:786`.

**Wrapping / flow:**
- `apps/web/src/components/landing/footer.tsx:77` — bottom meta row `flex gap-4` no `flex-wrap`; overflows at 320–360px. · *fix:* `flex-wrap` + `gap-y-1.5`.
- `apps/web/src/components/landing/pipeline.tsx:57` — diff block scrolls horizontally only via implicit `overflow-x` promotion; add explicit `overflow-x-auto`.
- `apps/web/src/components/dashboard/compare-view.tsx:275` — pricing `grid-cols-2` stays 2-up on smallest phones (readable, optional `min-[380px]:grid-cols-2`).
- Admin `grid-cols-2 gap-6` (cost:124, enrichment:73, multi-product:79) — slightly tight ≤400px.

---

## Verified clean (no change needed)

Dashboard sidebar (Sheet on mobile) · settings sub-rail (Sheet) · signals master-detail (stacks `<lg`, full-screen sheet) · all wide tables (`overflow-x-auto`) · Recharts `ResponsiveContainer` · Sheet (`w-3/4 sm:max-w-sm`) · Popover/Select/DropdownMenu (Radix collision-aware, `available-height/width`) · date-range-picker (`numberOfMonths={1}`) · Tooltip (`w-fit`) · consent banner · all legal/doc pages (`doc-page.tsx`, `max-w-3xl px-6` prose) · compare matrix (`overflow-x-auto` + sticky first col).

---

## Suggested fix order (atomic commits)

1. **Primitives** — `dialog.tsx` (max-h + scroll + gutter) and `tabs.tsx` (overflow scroll). Highest leverage, fixes many surfaces at once. _One commit._
2. **High pages** — competitor-detail source rows, onboarding header, auth OTP, hero bars. _One commit per file or grouped._
3. **Medium** — topbar, admin mobile nav, discovery/my-product grids, onboarding URL, digest-mockup, admin stat grids.
4. **Low** — touch targets, `100vh`→`100dvh` sweep, flex-wrap/overflow polish.

> Implementation note: respect `apps/web/CLAUDE.md` — type-scale **tokens only** (no `text-[Npx]`), no hardcoded colors. The fixes above are layout-only (widths, grids, wrap, overflow), so they don't touch typography/color tokens. Validate with `pnpm typecheck` (live render not possible locally — WSL2 OOM).
