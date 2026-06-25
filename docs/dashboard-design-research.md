# Dashboard & SaaS UI — design research (2026)

> Research memo, June 2026. How a modern SaaS dashboard should be laid out, what
> it should show, how it should manage state and navigation — grounded in real
> products (big + niche) and the 2026 literature. Tailored at the end to Outrival.
> Companion to `DESIGN.md` (the "Analyst's Terminal" system already in code).

---

## 0. TL;DR — the 12 rules that survived the research

1. **One north-star metric, top-left.** Every strong dashboard leads with a single
   number (Stripe = volume, Mercury = balance, Baremetrics = MRR). Size *is*
   hierarchy — make it 2–3× the supporting metrics.
2. **5–9 elements on the default view.** More than that is the #1 documented
   dashboard failure (information overload hits ~47% of users). Everything else
   lives behind a tab, a filter, or a drill-down.
3. **Progressive disclosure is the master pattern.** Summary up front, detail on
   demand. It's good UX *and* good engineering (aggregates load fast, granular data
   is only queried when asked). This is the single decision that separates dashboards
   that pass enterprise review from ones that stall.
4. **Color is functional, never decorative.** A neutral base (grays/near-black) + 1
   brand accent + a reserved severity scale (red = broken, amber = warning, green =
   good). If everything is colored, nothing is a signal.
5. **Three layers of depth:** Overview (what's happening) → List/Feed (what to look
   at) → Detail (the evidence). Navigation moves you *down* these layers, never
   sideways into a maze.
6. **Density is a persona decision.** Executives want low density + whitespace + big
   KPIs; operators (analysts, traders, on-call) want high density to see correlations
   without scrolling. Pick the persona, then commit.
7. **Interpret, don't just report.** The 2026 shift is from "here's the data" to
   "here's the insight + the next action." Ramp shows "saved $4,200," not "spend
   $58,000." Translate raw numbers into outcomes.
8. **The three forgotten states are not optional.** Empty, loading, error. An NN/g
   analysis found 92% of AI-generated dashboards had no empty state, 78% no error
   state, 100% used a generic spinner — vs ~70% done well by human designers. This
   is where craft is visible.
9. **Skeletons, not spinners.** Skeleton screens cut *perceived* load ~30% and stop
   layout shift. Spinners read as 2014. Optimistic UI where the action is reversible.
10. **A command palette (⌘K) is table stakes for power tools.** Fuzzy, typo-forgiving,
    recents-first. It's the keyboard-first escape hatch (Linear, Raycast, Slack,
    Superhuman). Don't make power users reach for the mouse.
11. **Role-based / adaptive defaults.** Same product, different first screen per role.
    A sales rep and a PM should not land on the same dashboard.
12. **Calm by default.** Whitespace, typography-led hierarchy, one clear next action
    per screen. Restraint reads as premium (Raycast, Linear, Vercel).

---

## 1. The mental model: a dashboard is three layers

Almost every good product dashboard resolves to the same nesting. Get this right and
the rest is decoration:

```
LAYER 1 — OVERVIEW (the "is everything OK?" screen)
  north-star metric + 4–8 supporting KPIs + a feed/recent-activity strip
  answers in <5s, loads in <2s, no scrolling for the headline

LAYER 2 — LIST / FEED (the "what should I look at?" screen)
  scannable rows: signals, deployments, issues, transactions, errors
  status color + timestamp + one-line summary per row; filters + search up top

LAYER 3 — DETAIL (the "show me the evidence" screen)
  the full record: the diff, the chart, the thread, the raw data, the actions
```

Stripe, Linear, Sentry, Datadog, Vercel all map cleanly onto this. The job of
navigation is to move the user *down* a layer (drill in) and *back up* (zoom out) —
not sideways through twelve sibling pages. If a user has to leave a widget to
understand it, the widget is wrong (Mixpanel's rule: each card is self-contained).

---

## 2. Layout & information architecture

### App shell
- **Left sidebar nav** is the default for B2B (collapsible, grouped by job not by
  feature). Keep the top-level to ~5–7 destinations. Linear/Vercel/Stripe all run a
  thin left rail + a content area.
- **Contextual sub-navigation** for settings-heavy areas: the settings sidebar
  *replaces* the main rail rather than nesting (Vercel/Stripe pattern). Outrival
  already does this (`SettingsSidebar`).
- **Top bar** carries: workspace/org switcher, global search/⌘K, notifications,
  account. Keep it thin; it's chrome, not content.

### The grid
- **Full-width summary bar** at the very top (the KPI strip) *before* any grid
  begins (HubSpot pattern). Then a responsive grid of equal-weight cards.
- **Single-page when the metric set is finite** (Plausible: 6 metrics + 1 chart, no
  tabs, fits above the fold). Don't add tabs you don't need.
- **Modular/draggable layouts** only for analytics tools where users genuinely build
  their own views (Amplitude, Grafana, Mixpanel). For task/monitoring products, a
  *curated* fixed layout beats a builder — most users never customize.

### Information hierarchy mechanics
- **Size** = importance (Baremetrics MRR 3× everything else).
- **Position** = priority (top-left = first read in LTR).
- **Color** = status, spent sparingly.
- **Weight + muted color** for sub-hierarchy, *not* shrinking font another step.
- **Whitespace** to group and separate — the cheapest, most underused tool.

---

## 3. What to display, and how

### Pick the metric, then earn it
- Lead with the **outcome**, not the activity. "12 competitor moves this week, 3
  need action" beats "847 pages scraped."
- Show **why a number changed** inline, not buried (ChartMogul puts the MRR-waterfall
  *in* the main view; Stripe shows success vs failed right there).
- **Comparisons make numbers mean something**: vs last period, vs target, vs
  competitor. A bare number is rarely a signal.

### Data-viz choices (the boring-but-correct defaults)
- **Trend over time → line / area.** Single big trend for the north-star.
- **Composition → stacked bar or a small table**, not a pie (pies fail past 3–4
  slices).
- **Status/health → color + icon + label**, never color alone (accessibility +
  scannability). Sparklines for at-a-glance trend inside a row.
- **Many series → small multiples** (a grid of mini-charts) beats one spaghetti chart.
- **Global filters control all widgets** at scale (Datadog) — don't let each chart
  carry its own time-range chaos.

### Density, mapped to persona
- Low-density "executive": few cards, big numbers, lots of air (Mercury, Clerk).
- High-density "operator": rows of signals/errors/services readable at a glance
  (Datadog, Sentry, Resend's log-style table). This is the analyst's-terminal end of
  the spectrum and the right one for a monitoring product.

---

## 4. The 6 proven layout patterns (with real examples)

From a 2026 teardown of 35 SaaS dashboards. Use these as templates; most products mix 2–3.

| # | Pattern | Who does it | The core move | Fits a CI/monitoring tool? |
|---|---|---|---|---|
| 1 | **Single-metric focus** | Stripe, Vercel, Baremetrics, ChartMogul | One dominant number top-left, the rest one click away | ✅ overview screen |
| 2 | **Progressive disclosure** | Linear, Notion, Intercom, Asana, Height | Summary list → drill to detail; AI summaries on cards | ✅✅ the whole product |
| 3 | **Data-heavy analytics** | Amplitude, Mixpanel, Datadog, Grafana, PostHog | Grid of charts, global filters, user-built views | ⚠️ only the analytics tab |
| 4 | **Visual hierarchy & layout** | HubSpot, Figma, Loom, Retool, Plausible, Clerk | Full-width summary bar, thumbnails, 3–4 cards | ✅ overview |
| 5 | **Fintech trust** | Mercury, Ramp, Brex, Wise, Causal | Lead with balance, translate data → outcomes, restraint | ✅ the "interpret" ethos |
| 6 | **Dark-mode-first** | Raycast, Railway, Sentry, Resend, Supabase | Near-black + 1 accent, severity = saturated color | ✅✅ exactly Outrival's lane |
| 6b | **AI-native (emerging)** | Attio, Hex, Cursor, Pylon, Default | Rank & surface what to act on; AI triage; insight-first | ✅✅ the 2026 frontier |

**Standout micro-decisions worth stealing:**
- **Sentry** — severity jumps out because everything else is neutral dark; saturated
  color is *reserved* for status. (Outrival's severity scale does this.)
- **Resend** — one headline deliverability number, then a scannable log table that
  relies on contrast + status color, not heavy borders.
- **Intercom / Pylon** — AI-generated summary *on the card* so you rarely open the
  ticket. Directly applicable to a signal feed.
- **Attio / Default** — the dashboard *ranks* what you should act on; it doesn't show
  all records equally. The product does the prioritizing.
- **Ramp** — "saved $4,200" not "spent $58,000": outcome framing.
- **Linear** — separates the "doing" dashboard from the "analyzing" dashboard. Don't
  merge the action feed and the analytics into one screen.

---

## 5. The three states everyone forgets (and onboarding)

This is where most dashboards — especially AI-built ones — fall apart, and where
craft is most visible.

### Empty states
- A blank screen on day one is the worst onboarding moment and the biggest
  opportunity. Explain *why* it's empty and give *one* action ("No competitors yet —
  add your first to start monitoring").
- Rule of thumb: **two parts instruction, one part delight.** Personality, but never
  at the cost of clarity. Dropbox lets you upload a file before completing a profile —
  value before setup.
- Distinguish **first-use empty** (teach), **user-cleared empty** ("all caught up"),
  and **no-results empty** (relax the filter).

### Loading states
- **Skeleton screens** that mirror the final layout — ~30% lower perceived wait, no
  layout shift. Reserve spinners for tiny inline actions only.
- **Optimistic UI** for reversible actions (mark read, dismiss, follow): show the
  result instantly, roll back on failure.
- Stream the dashboard: render the shell + skeletons immediately, hydrate cards as
  data lands. Never block the whole screen on the slowest query.

### Error states
- Say what broke, why, and the next step — never a raw stack trace or a dead spinner.
- Degrade gracefully per-widget: one failed query shows an error *in that card*, the
  rest of the dashboard still works. (Outrival's best-effort analytics already does
  this server-side; the UI should mirror it.)

### Onboarding
- **Adaptive, not one-size-fits-all.** Ask the user's goal and tailor (Duolingo asks
  *why* you're learning). 
- **Time-to-value over completeness.** Get them to the first real signal/insight
  fast; defer profile-completion.

---

## 6. Navigation & the power-user surface

- **Command palette (⌘K)** — fuzzy, typo-forgiving, recents-first, actions +
  navigation + search in one surface. Built with `cmdk` + Floating UI today. Quality
  bar = Raycast / Linear / Superhuman. Must be keyboard-accessible (focus trap, ARIA,
  visible focus).
- **Keyboard shortcuts** for the 5–10 most frequent actions, discoverable *through*
  the palette (Superhuman teaches the shortcut as you use the command).
- **Global search** that spans entities (competitors, signals, pages) — not just a
  filter on the current list.
- **Notifications**: in-app bell + a feed; respect quiet hours / batching so the tool
  doesn't become the noise it's meant to suppress.

---

## 7. 2026 trends (what's actually changing)

1. **AI-native dashboards.** The interface summarizes, prioritizes, and suggests the
   next step instead of leaving you to build charts (Attio, Hex, Cursor, Pylon). The
   bar moved from "show data" to "do the interpretation."
2. **AI as infrastructure, not a feature.** Inline, contextual, no separate "AI
   panel"; auto-classification on save (Notion, Intercom). Don't badge it.
3. **Calm design / cognitive-load reduction.** Whitespace, typography-led hierarchy,
   only what the current workflow needs (Linear, Calendly).
4. **Command palettes + unified search** as default navigation (Linear, Slack).
5. **Role-based / adaptive interfaces** — different default per persona (HubSpot, Asana).
6. **Dark-mode-first** for developer & monitoring tools (Raycast, Sentry, Supabase).
7. **Emotional design crosses into B2B** — human-voiced empty states, contextual
   loading copy, restrained celebration. Personality without toys.

---

## 8. Domain-specific: competitive-intelligence dashboards

How the incumbents in Outrival's category present information (and where they're weak):

- **Crayon** — captures 100+ intel types automatically and delivers *prioritized*
  intelligence; its diff engine deliberately **ignores CSS/asset/CMS-cosmetic
  changes** so the feed isn't spam. (Lesson: noise suppression is the product, not a
  nice-to-have.)
- **Klue** — beautiful **battlecards** that update as intel flows in; a "Compete
  Agent" pushes CI into the deal workflow. UI was rebuilt in 2024 and some users find
  the new editor harder — a caution that a redesign can regress power users.
- **Kompyte** — **pricing surveillance** that "looks more like a financial dashboard
  than a CI tool": structured plan tracking, historical timelines, alerts on tier
  changes, side-by-side comparison. (Lesson: structured > screenshot for pricing.)
- **Visualping** — pixel-level **visual diffs**: regular screenshots, highlight
  exactly what changed. The clearest UX in the category — show the change, don't
  describe it.
- **Feedly (Leo)** — AI assistant that **filters signal from noise** into custom
  feeds. The whole value is curation.

**The 2026 CI bar** (what buyers now expect): continuous monitoring (not periodic),
change *detection* (not snapshots), AI *summarization* (not raw feeds),
*interpretation* support (not just alerts), *push* delivery, low overhead.

**Implication for the dashboard:** the center of gravity is a **prioritized signal
feed** with on-card AI summary + severity, a **visual/structured diff** as the detail
view, **structured pricing/jobs/reviews timelines** (financial-dashboard feel), and
**battlecards** as the exportable artifact. Outrival's architecture already produces
all of these — the UI's job is to *rank and interpret*, not to dump.

---

## 9. Real sites to study (the "getdesign.md"-style list)

### Inspiration galleries & directories
Big and niche, free and paid:

| Site | URL | Best for | Cost |
|---|---|---|---|
| **Mobbin** | mobbin.com | Real production screens & full flows, by screen/flow type | Paid (browse limited) |
| **SaaSframe** | saasframe.io | Largest SaaS archive — pages, emails, full flows | Paid |
| **Nicelydone** | nicelydone.club | SaaS web-app UX, micro-interactions, onboarding flows | Mixed |
| **Pageflows** | pageflows.com | Screen-*recorded* real flows (onboarding→checkout) | Paid |
| **SaaSUI** | saasui.design | Reference patterns for specific SaaS *screens* | Free |
| **Saaspo** | saaspo.com | SaaS landing/website references | Free |
| **Land-book** | land-book.com | Landing pages by industry/color/layout | Free |
| **Godly** | godly.website | High-end, aesthetic-filtered web design | Free |
| **Lapa Ninja** | lapa.ninja | Free landing-page references + resources | Free |
| **Muzli / SaaSFrame blogs** | muz.li, 925studios.co | Curated annual dashboard teardowns | Free |
| **Dribbble / Behance** | dribbble.com, behance.net | Concept exploration (aspirational, not shippable) | Free |
| **Tableau Public / Looker / Geckoboard** | — | *Functional* BI dashboard examples by team/goal | Free |

> Caveat: Dribbble/Behance are concept art — great for direction, dangerous as a spec
> (they ignore empty/error/density realities). Mobbin/Pageflows/Nicelydone show
> *shipped* products and are far more trustworthy for real engineering.

### Live products worth a full teardown (open them, click around)
- **Calm / single-metric:** Stripe, Mercury, Plausible, Baremetrics.
- **Progressive disclosure / feed:** Linear, Intercom, Height, Attio.
- **Dark-first / monitoring (Outrival's lane):** Sentry, Raycast, Resend, Supabase,
  Railway, Datadog.
- **AI-native:** Attio, Pylon, Hex, Cursor.
- **Direct competitors:** Crayon, Klue, Kompyte, Visualping, Feedly.

---

## 10. Reading it back onto Outrival

Outrival already has a strong, opinionated system (`DESIGN.md` — "The Analyst's
Terminal": dark-capable, one rationed cyan/iris accent, mono for machine-truth, flat
tonal surfaces, severity as a separate semantic scale). That system is *on-trend with
everything above* — dark-first monitoring + calm + restraint + reserved severity color
is exactly patterns 2/5/6/6b. So this is mostly confirmation, with a few gaps to close:

**Strengths already aligned:**
- Dark-mode-first + one accent + reserved severity = Sentry/Raycast/Supabase playbook. ✓
- Mono-for-data, flat tonal depth, boxless sections = the right density discipline. ✓
- Settings sidebar replacing the rail = Vercel/Stripe pattern. ✓
- Best-effort degrade server-side = the foundation for per-widget error states. ✓

**Already implemented (verified in code, June 2026) — most of the research is done:**
- North-star + **outcome framing** — `PageHead` sub reads "N competitors moved · M
  critical pending", KPI strip (Signals/Critical/Active/Last) with sparkline. ✓
  (`components/dashboard/overview.tsx`, `kpi.tsx`)
- **On-card AI summary** — `signal.narrative` rendered inline with a Sparkles mark;
  `soWhat`/`recommendedAction` on the card. ✓ (`signal-card.tsx`)
- **Visibly ranked feed** — feed default sort is `threat` (server: severity × overlap
  × relevance) with a 3-bar threat meter per card explaining the rank. ✓
  (`signals-view.tsx`, `signal-card.tsx`)
- **Pricing/jobs/reviews timelines** — dedicated `pricing-tab` / `hiring-tab` /
  `reviews-tab` with `chart-line` time-series in the competitor detail. ✓
- **Three states** — empty ("No signals yet" + explanation), error (`ListError` +
  retry), loading (`DashboardLoading` skeleton), per-widget best-effort degrade. ✓
- **AI transparency** — `ConfidenceDot`, self-check `AiOutputWarning` on cards. ✓
- **⌘K palette + keyboard shortcuts** — `global-search.tsx` (⌘K), `shortcuts-help.tsx`,
  `R` to mark read. ✓ (but search-only — see gaps)

**Genuine gaps left (priority order):**
1. **⌘K is search-only, not a command palette.** It searches competitors/signals/
   digests but has no **navigation** commands (Go to Signals/Competitors/Settings),
   no **actions** (Add competitor, Re-scan, Ask Outrival, Toggle theme, Export), and
   no **recents/suggestions** when empty (shows "type 2 characters"). The Raycast/
   Linear model = nav + actions + search + recents in one surface. Highest-value,
   well-scoped change. (`global-search.tsx`)
2. **Visual diff as the hero detail view** (Visualping) — before/after screenshot +
   highlight of what changed. Genuinely missing (Roadmap Phase 8); the detail today
   is text (narrative/so-what/relevance) via `why-insight-panel`. Larger build.
3. **Streaming skeletons on the overview client-fallback.** Server-prefetch is fine,
   but the client path blocks the whole screen on `signals===null || competitors===null`
   → render the shell + per-card skeletons and hydrate as data lands. Polish.
4. **Empty-state CTAs.** Overview "No signals yet" is instruction-only; add one clear
   action where appropriate ("two parts instruction, one part delight, one action").
   (First-run is already covered by `OnboardingChecklistCard`.) Minor.

---

## 11. Visual references — captured screenshots (June 2026)

Screenshots saved to `scratchpad/dashrefs/` (session scratch; outside the repo).
Open from WSL via `explorer.exe .` in that folder, or ask me to re-capture.

**Method note.** Live product dashboards (Stripe, Linear app, Sentry, Datadog,
Crayon, Klue) are auth-walled — not capturable. Inspiration galleries (Dribbble,
Mobbin, Behance) bot-wall headless browsers (captcha). Most SaaS marketing pages now
hijack scroll + show an *illustrated hero*, not the product. The trustworthy public
references are **login-free live dashboards** (Plausible) and the few products whose
hero *is* a real UI shot (Linear). Those are below.

### `01-plausible-analytics.png` — the analytics-overview archetype (light)
- **KPI strip across the top, and the KPIs are tabs**: Unique visitors / Total visits
  / Pageviews / Views-per-visit / Bounce / Duration — each = big number + tiny delta
  (↗2% green, ↘1% red, 0% grey). Clicking a KPI **re-plots the single chart below**.
  One chart serves six metrics. (Outrival's KPI strip is the same banded-cell look but
  *not* interactive — making KPIs re-plot a chart is a cheap, strong upgrade.)
- **One dominant area chart**, full-width, calm.
- **Two side-by-side tables** (Sources | Top pages), each with **in-row magnitude
  bars** (a tinted fill behind the row = share) + value + %. Tabs inside each table
  (Channels/Sources/Campaigns). No separate bar chart — the table *is* the chart.
- Filters + date range top-right; live "84 current visitors" w/ green dot. Whitespace,
  one indigo accent. → Outrival's overview already mirrors this skeleton.

### `03-linear-hero.png` + `04-linear-product.png` — the dark feed/detail archetype ⭐
- **Three-pane app shell**: (left) grouped nav rail — Inbox/My Issues/Reviews/Pulse,
  then a "Workspace" group, then "Favorites"; (center) the record — title + body +
  **Activity timeline** of events; (right) a **metadata rail** — status (In Progress),
  priority (High), assignee, team. This nav | content+activity | metadata layout is
  the template for Outrival's **competitor detail** and **signal detail**.
- **Near-black canvas, hairline borders, almost no chrome, text-led hierarchy**, one
  tiny accent (yellow). Exactly the DESIGN.md "Analyst's Terminal" target.
- **Pager affordance**: "02 / 145" + up/down chevrons to move through the list without
  leaving the detail — great for a signal feed (next/prev signal with `J`/`K`).
- **AI agent panel docked bottom-right** ("Linear · Opus 4.8 · Examining the startup
  path… Worked for 7s") — AI shown as a *working teammate inline*, not a separate page.
  Validates surfacing "Ask Outrival" as an inline dock rather than only `/dashboard/ask`.

### `07-vercel.png` — type & restraint reference (not a dashboard)
- Minimalist black/white hero: huge headline + **mono uppercase descriptor lines**
  right-aligned + massive whitespace + a single filled CTA. The mono-as-spec treatment
  is the same instinct as Outrival's Geist-Mono machine-truth layer — confirms the
  type direction for labels/metadata.

### Low-value captures (kept for completeness)
- `02-grafana-play.png` (Grafana app-shell home, not a data dashboard),
  `05-sentry.png` (illustrated hero), `06-resend.png` (logo cloud) — marketing frames,
  no usable dashboard layout. Real Grafana data dashboards need a deep link / click-in;
  worth a second pass if we want the dense "operator panel-grid" archetype on tape.

### Concrete upgrades this visual pass surfaced (beyond §10)
1. **Make the overview KPI strip interactive** (Plausible) — click a KPI → the trend
   chart re-plots that metric. Low effort, high "alive" payoff.
2. **In-row magnitude bars** on the competitor roster & category tables (Plausible) —
   the table doubles as the chart; Outrival already does this on the overlap column,
   extend to "Signals 7d".
3. **Three-pane detail with a metadata rail + J/K pager** (Linear) for signal &
   competitor detail — move severity/category/relevance/source into a right rail, free
   the center for the finding + evidence.
4. **Dock "Ask Outrival" inline** (Linear agent panel) rather than only a dedicated page.

## Sources

- [925studios — 35 SaaS Dashboard Examples & Patterns (2026)](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)
- [SaaSUI — 7 SaaS UI Design Trends for 2026](https://www.saasui.design/blog/7-saas-ui-design-trends-2026)
- [SaaSUI — Best SaaS UI Design Inspiration Sites (2026), Compared](https://www.saasui.design/best-saas-ui-design-inspiration)
- [context.dev — 10 Dashboard Design Best Practices for SaaS (2025)](https://www.context.dev/blog/dashboard-design-best-practices)
- [GitNexa — SaaS Dashboard UX Patterns: 2026 Guide](https://www.gitnexa.com/blogs/saas-dashboard-ux-patterns)
- [Pencil & Paper — Dashboard Design UX Patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards)
- [Orbix — 10 B2B SaaS Dashboard UI Examples (2026)](https://www.orbix.studio/blogs/b2b-saas-dashboard-design-examples)
- [Vibe Coder — Empty/Loading/Error: the UX AI forgets](https://blog.vibecoder.me/empty-states-loading-states-error-states)
- [NN/g — Designing Empty States in Complex Applications](https://www.nngroup.com/articles/empty-state-interface-design/)
- [Superhuman — How to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- [UX Patterns for Developers — Command Palette](https://uxpatterns.dev/patterns/advanced/command-palette)
- [Muzli — 50 Best Dashboard Design Examples for 2026](https://muz.li/blog/best-dashboard-design-examples-inspirations-for-2026/)
- [toools.design — 100 Best Inspiration Sites (2026)](https://www.toools.design/blog-posts/ultimate-list-100-best-inspiration-sites-to-inspire-designers)
- [Unkover — 15 Best Competitive Intelligence Tools (2026)](https://unkover.com/blog/competitive-intelligence-tools/)
- [Kompyte — Top Competitive Intelligence Tools (Kompyte/Crayon/Klue)](https://www.kompyte.com/blog/top-competitive-intelligence-tools)
