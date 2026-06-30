# Page & IA audit — 2026-06-30

Product-level audit of Outrival's user-facing pages: coherence, usefulness, and
relevance against the 2026 competitive-intelligence market. Distinct from
`docs/web-audit-2026-06-30.md` (UX/a11y/perf of the same surfaces). This one asks
a higher-altitude question: **are these the right pages at all?**

## Method & data caveat

- Real route inventory from `apps/web/src/app` + the real nav from
  `components/dashboard/sidebar.tsx` (not the patch-29 spec, which has diverged).
- Page-by-page content/overlap mapped from the actual view components.
- Usage pulled from PostHog `$pageview`, 90 days — but **it is effectively n=1: the
  views are the founder's own navigation, not customers.** So usage is treated as
  *not evidence at all* about page usefulness. The table below is kept only to show
  there is no customer-behavior data to lean on; **none of the verdicts in this audit
  rest on it.** Every verdict stands on three things instead: structural coherence /
  overlap (from the code), the product's own strategy (`PRODUCT.md`), and the 2026
  market. If those three didn't agree, the verdict isn't here.
- External grounding: 2026 CI-market research (Crayon, Klue, Kompyte, Contify, the
  AI-native crop, and the emerging AI-visibility/GEO category). Sources at the end.
- Audited against the product's own north star (`PRODUCT.md`): *founders/execs,
  time-poor, not analysts; decision over data; signal over noise; speed is the
  feature; intel reaches them in the dashboard and the inbox.*

## 1. Inventory — what exists today

**Primary nav (10 items)**, grouped Overview / Monitor / Analyze / Manage:

| Group | Pages |
|---|---|
| — | Overview |
| Monitor | Signals · Activity |
| Analyze | Ask · Sector · Trends · Compare |
| Manage | Competitors · Products · Discovery |
| (bottom) | Settings → 12 sub-pages |

**Built but orphaned from the nav** (reachable only by deep-link / Cmd-K / a button):
Competitor detail, Product detail, **Battle-cards**, **Digests**, What's-new, and
Sector (dropped from nav on plans that can't reach it).

That's **14 dashboard surfaces + 12 settings sub-pages ≈ 26 routes** for a persona
defined as "checks it between meetings, not as a sit-down session."

### Usage (PostHog, 90d) — NOT evidence (n=1, the founder)

These numbers are the founder's own clicks while building, not customer behavior, so
**they prove nothing about usefulness and are not used as an argument anywhere below.**
Listed only to be explicit that there is no real usage signal yet — the audit is
reasoned, not measured.

`/competitors/:id` 58 · `/signals` 27 · `/dashboard` 20 · `/activity` 14 ·
`/competitors` 6 · `/products(:id)` 4+6 · `/discovery` 4 · `/ask` 2 · `/compare` 2 ·
`/trends` 2 · `/sector` 1 · `/whats-new` 1 · `/digests` 0 · `/battle-cards` 0

A 0 here means "the founder didn't click it," not "users don't want it." When the real
ICP is on the product, re-run this query — *that's* when usage becomes a verdict input.

## 2. Central finding — the product violates its own principles

`PRODUCT.md` commits to *signal over noise*, *speed is the feature*, *decision over
data*, and explicitly anti-references *"heavy enterprise BI… chart-soup, density
without hierarchy."* The nav has drifted the opposite way. patch-29 claimed to
rationalize the rail to **5 items** (Overview/Signals/Competitors/Products/Discovery);
it has since re-grown to **10 + 3 orphans**, mostly by bolting on an analyst-grade
**Analyze** group (Ask/Sector/Trends/Compare) — exactly the "slice the data N ways"
surface a *founder, not an analyst* has no time to operate, and whose four pages
re-cut data already shown elsewhere (see §3).

The 2026 market reinforces this from the outside: the consensus is *"a tool without
an owner produces a dashboard nobody reads"* and *intelligence must arrive in a format
you'll actually read (a Slack brief, a digest, an alert), not behind another login.*
Outrival is building **more dashboard**, when the category is moving to **less
dashboard, more delivery**.

**The audit's one-sentence thesis: cut the surface count roughly in half, fold the
redundant cuts of the signal feed, turn Digests into delivery, promote the one
under-exposed asset (Battle-cards), and reinvest the saved surface area into the one
genuinely new, on-trend page (AI Visibility).**

## 3. Structural redundancies (the coherence problem)

1. **Signal re-presented 4×** — `/signals` (full triage), Overview "Recent signals",
   `/digests` (periodic rollup), and partly `/sector`. One feed, four renders.
2. **Competitor roster duplicated** — Overview's "Your competitors" table is, by its
   own code comment, a condensed mirror of `/competitors` (same server stats, columns,
   styling). Two renders of `competitorsQuery`.
3. **Meso "how's the field moving" 3×** — `/trends` (quantitative series), `/sector`
   (qualitative AI patterns), Overview's category bar + sector teaser. Overlapping
   pricing/hiring/review inputs, three places.
4. **Battle-cards 3 surfaces / 1 generator** — `/battle-cards` index + Overview recent
   block + the competitor-detail tab; only the tab generates. The index has 0 views.
5. **Self-product 3 entry points** — `/products` (redirects), `/products/:id`, and
   `/settings/products`, all over the same product data.
6. **Monitoring health 2×** — `/activity` (scrape-run log) vs the freshness dots /
   monitor panels on `/competitors` + competitor-detail.

## 4. Verdict per page

Legend: **KEEP** (core, leave it) · **MERGE** (fold into a sibling) · **DEMOTE**
(keep but off the primary rail) · **CONVERT** (change what it is) · **PROMOTE**
(under-exposed, surface it).

| Page | Verdict | Why |
|---|---|---|
| Overview | **KEEP, retarget** | Strong core, but today it's a mirror of every sibling. Make it answer one question — *"what changed since you last looked, and what's the next move"* — not a mini-render of Signals + Competitors + Sector + Battle-cards. Decision over data. |
| Signals | **KEEP** | This *is* the product. #2 traffic. The triage inbox + evidence dossier is the core loop. |
| Competitors (list) | **KEEP** | Core roster CRUD. |
| Competitor detail | **KEEP** | #1 traffic, the deep workspace. Battle-card generation lives here. |
| Products / detail | **KEEP, dedupe routes** | Collapse `/products`→`/products/:id` redirect and reconcile with `/settings/products` (3 entry points → 1 view + 1 manager). |
| Discovery | **KEEP** | Distinct job (validate candidates → track). Feeds Competitors. |
| Activity | **DEMOTE** | Useful transparency, but it's "did the scraper run," one altitude below Signals, and it re-shows the freshness/monitor info already on competitor-detail (§3.6). Move off the primary rail — a competitor-detail tab + a collapsible Overview strip — instead of sitting peer-to-peer with Signals under "Monitor." |
| Ask | **KEEP capability, rethink surface** | Already ambient via `ask-dock` on every page (correct — matches the 2026 *agentic, embedded* trend). A standalone nav page is redundant with the dock that's on every screen. Keep the dock + a light history; the nav slot is the spend, not the feature. |
| Battle-cards | **PROMOTE** | Klue/Crayon are *built around* battlecards; here it's orphaned from the nav (reachable only via an Overview block or Cmd-K). Either give it a real home or accept it lives on competitor-detail — but stop shipping a category-defining asset as a hidden index. |
| Compare | **MERGE → Competitors** | A multi-select "compare" mode on the roster, not a standalone page; its rows duplicate the competitor-detail tabs (§3). |
| Sector | **MERGE → "Market"** | Gated, and conceptually the qualitative half of Trends (§3.3). |
| Trends | **MERGE → "Market"** | Fold Sector (qualitative patterns) + Trends (quantitative series) into **one** "Market / Landscape" view: charts on top, AI patterns below. One meso surface, not three. |
| Digests | **CONVERT → delivery** | The in-app digest page is the exact anti-pattern the 2026 research names: a digest's job is to land in email/Slack so the user *doesn't* log in, and as a page it's a 4th re-render of the signal feed (§3.1). Keep the generator, drop the page; expose "last digest" as a link inside Overview. |
| What's-new | **KEEP** | Cheap, megaphone-triggered product changelog. Fine. (Minor: name collides conceptually with a *market* "what's new" — keep it clearly "product updates.") |
| Settings (×12) | **KEEP, low-priority trim** | Reference surface, visited rarely, so sprawl is more tolerable. `api-keys`/`integrations`/`members` are gated/empty for most plans — fine to keep, but they shouldn't read as broken empties. |

Net: **14 dashboard surfaces → ~8** (Overview, Signals, Competitors[+Compare mode],
Competitor detail, Products, Discovery, Market[=Trends+Sector], Ask-as-history), plus
Battle-cards promoted and Digests converted to delivery. Roughly half the rail, none
of the actual capability lost.

## 5. What the 2026 market says (and where Outrival sits)

- **Pricing/segment fit is good.** The dedicated incumbents (Crayon, Klue) run
  ~$20–40k/yr and target enterprise CI programs. The AI-native crop (Competely,
  Compttr, Kompyte budget tier) runs $0–~$300/mo for SMB/founders. Outrival's
  persona (time-poor founders) sits squarely in the AI-native lane — *automated
  synthesis + delivery*, not breadth of dashboards. The pipeline (snapshot→diff→
  classify→insight) is the right moat for that lane.
- **Agentic is the 2026 headline.** Klue's "Compete Agent" pushes deal-time intel to
  reps; Contify's Athena and multi-agent research pipelines deliver cited briefs in
  minutes; the broad trend is *AI as goal-driven operator running multi-step
  workflows.* Outrival's **Ask** (tool-based, org-scoped, 2-pass) is the seed of this —
  but it's mono-turn and buried as a nav tab. The opportunity is to make Ask the
  *ambient spine* (it already docks everywhere) and let it *act* (draft a battlecard,
  enable a monitor, queue a rescan), not just answer.
- **Delivery > dashboard, restated for 2026.** Branded auto-newsletters with
  AI-generated overviews, native Slack/Teams, prioritized alerts — these are now table
  stakes. Outrival has digests + alerts + Slack, but as *plumbing*, not as a
  first-class, shareable **briefing** product.
- **Signal quality / prioritization is the differentiator buyers test for** — *"does
  it tell you what matters most right now, or leave that to you?"* Outrival's
  relevance scoring + moderation + batching + quiet-hours (patch-26) is exactly this,
  and it's a genuine strength to lean on, not hide.
- **Headcount / role velocity = strongest leading indicator** of strategic moves.
  Outrival tracks jobs but presents them as counts; surfacing *velocity* ("hiring 4
  AI infra roles in 30d") is cheap and high-signal.

## 6. New pages — prioritized, research-backed

### P1 — AI Visibility / "Share of Model" (build it)
Track how **you and each competitor** appear in answers from ChatGPT, Perplexity,
Claude, Gemini, and Google AI Overviews for a set of buyer-intent prompts ("best
<category> tool", "<competitor> alternatives"). Surface **share-of-voice per platform**
(single number is misleading — 46× citation variance across platforms), the actual
answer text, and citation gaps where a competitor is named and you aren't.

Why it's the strongest bet:
- **It's the fastest-growing CI-adjacent category in 2026** (Profound, Frase, Otterly,
  Peec, a dozen others at $39–500/mo) — *on Outrival's exact segment and price point.*
- **40% of B2B buyers now shortlist via AI assistants before Google** — this is net-new
  competitive surface that website-diffing literally cannot see.
- **The incumbents are weak here** — Crayon/Klue are only "increasingly" adding it;
  there's a window.
- **Outrival already has the plumbing** — competitor set, AI provider pool, scraping,
  a signal pipeline, and a category enum to extend. This becomes a new `source_type`
  (`llm_visibility`), feeds **Signals** (new category), the **digest**, and **alerts**
  ("competitor X overtook you in Perplexity answers this week"). It's additive to the
  existing pipeline, not a new product.

Scope to keep it lean: start with you + tracked competitors across 2–3 engines and a
small prompt set per org; weekly cadence; one chart (share-of-voice over time) + the
answer evidence. Resist building a full GEO-audit/optimization suite (that's a
different product).

### P2 — Briefing / Newsletter (delivery surface, not a dashboard page)
Turn "Digests-the-page" into "Digest-the-product": a branded, AI-written weekly
competitive brief auto-sent to email + Slack + (later) a shareable link, leading with
*the 3 moves to make this week* (decision over data). This is the "delivery > dashboard"
trend made concrete and is what makes a CI tool *sticky for a time-poor founder* — the
value arrives without a login. Low net-new build (the digest generator exists); the
work is making it a first-class, shareable, brand-customizable artifact.

### P3 — Win-Loss / Deal intelligence (defer; validate first)
The signature value driver in the research (+63–84% win-rate lift; Klue/Crayon center
their enterprise pitch on it). But it needs CRM + deal data and a *sales org* to be
real — and Outrival's persona is founders/execs, often pre-sales-team. High value,
wrong-shaped for today's user and a heavy build. Park it; revisit when the ICP includes
PMMs/sales. A "lite" version (let the user log win/loss + competitor on a deal, and tie
it to the battlecard) is the cheap probe if you want to test demand.

## 7. Other ideas (smaller, mostly free)

- **Make the nav decision-typed and ~half the size.** Target 6 primary items. The
  Monitor/Analyze/Manage grouping is sound; the *contents* are bloated. Fewer, denser.
- **Let Ask act, not just answer.** The agentic 2026 move: "draft a battlecard for
  Acme", "mute pricing alerts for Beta", "rescan Gamma's pricing" — executed through
  the org-scoped tools it already has. This is the differentiator vs the static
  AI-native crop, and it's mostly a tools-layer extension of an existing feature.
- **Surface the "so what / recommended action" higher.** It's the product's promise
  and it's buried inside the signal dossier. A standing "3 moves to make" block on
  Overview (and atop the digest) is the decision-over-data principle, visible.
- **Hiring → role velocity, not counts.** Cheap relabel of data already collected;
  it's the strongest leading indicator per the research.
- **Kill the Overview/Competitors table duplication.** Either make Overview's roster a
  genuinely different lens (e.g. "movers this week" only) or drop it for a link.
- **Empty states should sell, not look broken.** Gated settings pages (api-keys,
  members, integrations) and 0-data analytics should read as "here's what unlocks
  this," consistent with the relevance/quality story.
- **One "Market" view, not three.** (Restated from §4 — it's both a cut and an idea.)

## 8. Target nav (before → after)

```
BEFORE (10 + 3 orphans)                AFTER (~6 primary)
Overview                                Overview        (retargeted: what changed + next move)
Monitor ─ Signals                       Signals         (+ Activity demoted to a tab/strip)
        └ Activity                       Competitors     (+ Compare as a mode, Battle-cards promoted in)
Analyze ─ Ask                            Products
        ├ Sector                         Discovery
        ├ Trends                         Market          (= Trends + Sector merged)
        └ Compare                        AI Visibility   (NEW, P1)
Manage  ─ Competitors                   ─────
        ├ Products                       Ask = ambient dock (already), + history
        └ Discovery                      Digest = delivery (email/Slack), not a page
Settings                                 Settings
(orphans: battle-cards, digests,
 whats-new, sector, detail pages)
```

## Sources

- [2026 CI platform trends — Northern Light](https://www.northernlight.com/blog/the-12-best-competitive-and-market-intelligence-platforms-in-2026)
- [Best CI tools 2026 — Klue](https://klue.com/topics/competitive-intelligence-tools-b2b-software)
- [CI tools 2026 (CEO guide) — Caelian](https://caelian.ai/blog/competitive-intelligence-tools-2026)
- [CI platforms for B2B SaaS founders 2026 — Kompense](https://blog.kompense.com/best-competitive-intelligence-platforms-b2b-saas-2026/)
- [AI-native vs traditional CI — Compttr](https://compttr.com/en/blog/ai-vs-traditional-competitive-intelligence)
- [Crayon platform](https://www.crayon.co/) · [Klue platform](https://klue.com/competitive-intelligence-platform) · [Klue win-loss](https://klue.com/win-loss)
- [Win-loss software buyer's guide — Fullcast](https://www.fullcast.com/content/win-loss-analysis-software/)
- [10 best AI visibility tools 2026 — Frase](https://www.frase.io/blog/the-10-best-ai-visibility-tools-in-2026)
- [LLM optimization / AI discovery 2026 — Search Engine Land](https://searchengineland.com/llm-optimization-tracking-visibility-ai-discovery-463860)
- [Affordable AI visibility tools for B2B SaaS 2026 — Siftly](https://siftly.ai/blog/most-affordable-ai-visibility-tools-b2b-saas-startups-2026)
- [Agentic AI trends 2026 — Google Cloud](https://cloud.google.com/resources/content/ai-agent-trends-2026)
```
