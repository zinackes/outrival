# Pricing coverage — 2026 model taxonomy

Audit of how Outrival's pricing pipeline represents every pricing model in use in
2026, and the data-model extension that closes the structural gaps. Scope: the
`pricing` source only (scrape → structured/AI extraction → `pricing_history` →
readers). The competitor-agnostic guarantee holds throughout — no branch keys off a
domain or competitor name; every rule is generic (regex / schema.org / heuristics).

## The two layers

The pipeline understands pricing at two independent layers:

1. **Status layer** — `scrapers/pricing/signals.ts` + `determine-status.ts`. A
   6-value taxonomy (`public`, `public_partial`, `gated_signup`, `gated_demo`,
   `dynamic`, `unknown`) plus page-level facts (`has_trial`, `has_free_plan`,
   `promotional`). It already recognizes usage-based / metered pricing → `dynamic`
   (calculator, sliders, "pay-as-you-go", "usage-based", MTU…). This layer is
   healthy and unchanged by this work.

2. **Plan-extraction layer** — `pricing_history` rows produced by the staged
   extractor (structured-first → cached parser → AI floor). Each row is
   `plan_name / price / currency / billing_period / unit / included_quantity`
   + page-level facts. This layer is where the gaps were: a 4-value
   `billing_period` enum and a single scalar price cannot model a price that has a
   **dimension** (per unit / per outcome / per credit / base + variable).

## 2026 pricing models × coverage

| Model (2026) | Status | pricing_history | State |
|---|---|---|---|
| Flat-rate | ✅ | 1 plan (monthly/yearly) | full |
| Tiered (Good/Better/Best) | ✅ | N plans | full |
| Freemium (permanent $0) | ✅ | $0 plan + `has_free_plan` | full |
| Free trial | ✅ | `has_trial`/`trial_days`/`trial_requires_card` | full |
| Quote / Enterprise / Custom | ✅ | price null → `custom` | full |
| One-time / lifetime | ✅ | `one_time` | full |
| Per-seat ($10 /user/mo) | ✅ | price + `unit="seat"` | full (after) |
| Annual/monthly toggle | ✅ | both periods (toggle click) | full (after) |
| Usage / pay-as-you-go / per-unit | ✅ `dynamic` | `usage` + `unit` | full (after) |
| Outcome-based ($0.99/resolution) | ✅ | `usage` + `unit="resolution"` | full (after) |
| Credit-based ($99 / 1000 credits) | ✅ | `one_time` + `included_quantity` | full (after) |
| Hybrid (base + overage) | ✅ | 2 rows: base `monthly` + overage `usage` | full (after) |
| Agentic (per AI agent, all-you-can-eat) | ✅ | per-seat / flat + `unit` | full (after) |
| % / per-transaction (2.9% + 30¢) | ✅ | `usage` + `unit="transaction"` | partial (rate captured, % not numeric) |
| Volume / graduated / stair-step | ✅ `dynamic` | tiers + `usage` overage | partial |

## Data model (the extension)

`billing_period` gains one value; two nullable columns are added. Everything is
additive — legacy rows and readers are untouched.

- **`billing_period = "usage"`** — the `price` is a per-`unit` rate, not a
  per-time subscription. Covers both metered usage ("$0.10 / API call") and
  outcome-based pricing ("$0.99 / resolved conversation") — the unit distinguishes
  them, so no separate `outcome` enum value is needed.
- **`unit: text | null`** — the thing a price applies to: `"API call"`,
  `"resolved conversation"`, `"credit"`, `"seat"`/`"user"`, `"GB"`, `"transaction"`.
  Null = a flat price (the common subscription case).
- **`included_quantity: number | null`** — units bundled into the plan: a credit
  pack's `1000` credits, a tier's `100` included API calls. Null = N/A.

### Hybrid pricing = two rows

A hybrid plan (base subscription + usage overage) is emitted as **two rows sharing
the same `plan_name`**: the base as `monthly`/`yearly` (price = base fee), and the
overage as `usage` (price = per-unit rate, `unit` set). Display readers group by
`plan_name`; numeric readers take only the comparable base row. No bespoke overage
column.

### Reader safety — `isComparablePricePeriod`

A `usage` price ($0.10) must never be averaged or charted against a subscription
price ($99). `@outrival/shared` exposes `COMPARABLE_PRICE_PERIODS`
(`monthly | yearly | one_time`) and `isComparablePricePeriod(period)`; the numeric
aggregators (compare band, sectoral median trend) filter through it. Display
readers (pricing tab, battle-card context, Ask, `resolveCurrentPricing`) are
period-agnostic and render `usage` rows with their unit. `landscape-insights`
already filters `billing_period === "monthly"`, so it excludes usage for free.

## Toggle capture (annual ↔ monthly)

Pricing pages default to one billing period; the other is behind a toggle. The
pricing scraper, after the progressive scroll, locates a billing-period switch
(button/tab/switch whose label matches monthly/annual vocabulary), clicks it, waits
for the re-render, and captures a **second** DOM. Both captures are concatenated so
the extractor sees both periods (enabling the monthly↔yearly ratio validation that
already exists). Scoped to the pricing scraper — the shared cascade capture is
untouched; a page with no toggle costs nothing (no element found → no second pass).

## What is deliberately NOT modeled

> **Closed by Pricing Intelligence P3 (2026-07-31).** The first two entries below
> are now first-class; they are kept for the record because the *reasoning* that
> retired them is the reasoning behind their new guardrails.

- ~~**Percentage fees** (`2.9% + $0.30`)~~ — `percentage_rate` is now a numeric
  column and `price` carries the fixed part, so the two halves of the plan live on
  one row and a change in either emits `rate_changed`. It is still **excluded from
  cost modelling**: `costAtVolume` returns null for a `percentage` structure,
  because its meter is money, not a countable unit, and "what it costs at 10,000
  units" would be a figure with no meaning. It surfaces as a badge.
- ~~**Full graduated/stair-step curves**~~ — `price_tiers` stores every published
  band and `cost-model.ts` prices a volume against them (graduated, volume,
  package, standard, plus a `max(usage, minimum)` floor). The bands are only ever
  stored when the page PRINTS them: an invalid or overlapping set is dropped
  whole, never trimmed to its valid prefix, because a half-read ladder computes a
  confidently wrong cost. A calculator page with no printed table still stays
  `dynamic` — probing one is P4.
- **Credit → feature consumption maps** (10 credits per AI action) — the credit
  pack price + quantity are captured; per-feature burn rates are not (P5).

The remaining entry is captured qualitatively by the AI source summary; making it
first-class would need a per-model sub-schema and is out of scope until a
competitor demands it.

### Reading a metered competitor (P3)

A rate ($0.10/request) and a subscription ($99/mo) are not the same kind of
number, which is why `isComparablePricePeriod` keeps usage rows out of every
numeric aggregate. What IS comparable is a **cost at a volume**, so that is what
the comparison layer reads:

- `unit-alias.ts` gives GB / Go / gigabyte one identity, and refuses to guess a
  meter it does not know — an unnormalised unit keeps its bands (evidence) but
  never produces a cost point, because comparing an unknown meter against a known
  one is arithmetic on two different things.
- `price_points` stores the cost at four fixed preset volumes at capture time.
- A workspace's own volume (`organizations.reference_volumes`) is computed **on
  read**, by the same `costAtVolume`, so changing it never needs a re-capture and
  the on-read number can never disagree with the stored one.
- On the compare axis, a derived cost is marked: an asterisk the legend explains,
  a lighter bar, and the volume it was read at. A competitor that publishes a
  subscription keeps its published band — only a column with nothing chartable
  falls through to its cost.
- A hybrid plan's cost carries the subscription its meter sits on. Without that it
  would enter the comparison at its overage rate alone and read as cheaper than it
  bills.

---

# Part II — Coverage reach: discovery, extraction floor & product-line aggregation (2026-07)

Part I is about **how a captured price is modeled**. Part II is about the two steps
before that: **reaching the page that carries the prices** (discovery) and **getting
numbers off layouts that aren't a SaaS tier table** (extraction). Both were tuned for
the SaaS convention and silently produce *nothing* outside it — the page shows prices,
the status flips to `public`/`public_partial`, but `pricing_history` stays empty and
the tab reads "Tiers not captured yet".

The **competitor-agnostic guarantee from Part I still holds**: nothing below keys off a
domain, a vertical, or a competitor name. Every rule is generic — signal density,
commerce vocabulary regex, DOM structure. A hosting site and a SaaS are routed by the
same heuristics; hosting simply exercises paths SaaS never does.

## Where reach breaks — two independent gaps

The pipeline has three layers, of which Part I hardened only the last:

| Layer | Role | Pre-2026-07 state |
|---|---|---|
| Status (`signals.ts` + `determine-status.ts`) | 6-value status + page facts | ✅ healthy |
| **Discovery** (`pricing/discover-url.ts`) | find the page(s) carrying prices | ⚠️ SaaS-only, first-match |
| **Extraction** (`stagedExtract` → `extractPricing`) | pull tiers off that page | ⚠️ AI floor → `[]` with no sub-floor |

The failure the audit surfaced (hosting / VPS / game-server orgs, all tiers empty):
discovery lands on the homepage or a wrong sub-page, and the AI floor returns `[]`, so
zero rows — while the status still flips from the homepage's "from €X" teasers. The two
outputs (status vs tiers) come from different code and diverge.

## Taxonomy A — WHERE prices live (discovery)

| Pattern | Example | Pre | Target |
|---|---|---|---|
| `/pricing` `/tarifs` `/plans` page | SaaS | ✅ | ✅ |
| Pricing section embedded in the home | one-page landing | ✅ | ✅ |
| Tier-branded page `/pro` `/nitro` | consumer apps | ✅ | ✅ |
| Hub → one page per product (`/pricing/x`) | Back4App | ✅ (`drillPricingHub`) | ✅ (subsumed by L1 ranking) |
| **Product-category pages** `/vps` `/game-hosting` `/dedicated` | hosting, e-comm | ❌ | **L1 + L3** |
| **Commerce subdomain** `boutique.` `shop.` `store.` `billing.`, `/store` `/cart.php` `/order` | WHMCS, e-comm | ❌ | **L1** |
| Non-FR/EN locale paths `/preise` `/precios` `/prezzi` | DE/ES/IT sites | ❌ | **L1 (cheap)** |
| External marketplace listing | Shopify/Chrome/WP store | ❌ | out of scope |
| Prices in a PDF / image rate card | agencies | ❌ | out of scope (no OCR) |
| Login/quote-gated | Enterprise | ✅ classified, 0 tiers expected | ✅ |

## Taxonomy B — HOW the price is encoded (extraction, once on the right page)

| Encoding | Pre | Target |
|---|---|---|
| Named-tier table (Free/Pro/Business) | ✅ AI floor | ✅ |
| schema.org `Offer` JSON-LD | ✅ structured-first | ✅ |
| Monthly↔annual toggle | ✅ `captureBillingToggle` | ✅ |
| JS-injected prices | ✅ browser cascade + scroll | ✅ |
| **"From €X" cards, no tier table** | ⚠️ AI often returns `[]` | **L2 harvest** |
| **Configurator / slider** (per slot, per GB) | ❌ `dynamic`, no price captured | **L4 (default price)** |
| WHMCS / billing product grid | ⚠️ only if discovery points there | **L1 + L2** |
| Percentage fees (2.9% + 30¢) | ⚠️ partial (Part I) | unchanged |

## The strategy — four generic layers, graceful floors

### L1 — Discovery by signal-density ranking (not first-match)

`discoverPricingUrl` returns the **first** convention/nav/footer hit. On a non-SaaS
site the first hit is wrong or absent. Replace first-match with **rank-then-pick**:

- **Widen the candidate set (generic):** convention paths (+ locale variants
  `/preise` `/precios` `/prezzi` …) **and** links whose host or path carries commerce
  vocabulary — `/(shop|store|boutique|billing|order|cart|buy|clients?)/i` — including
  links to a **subdomain of the same registrable domain** (`boutique.heberghub.fr`,
  `shop.acme.com`). Cross-registrable-domain links stay excluded (tenant/safety).
- **Score each candidate** with a cheap L0 GET through `detectPricingSignals`: count of
  distinct price amounts, presence of ≥2 tier words, `hasPriceTokens`. The
  highest-scoring page wins; ties break toward the shallowest path.
- **Cap the fan-out** (`MAX_DISCOVERY_PROBES`, ~6 L0 GETs) so ranking never becomes a
  fetch storm. This generalizes `drillPricingHub` — a "hub" is just "several sibling
  candidates each scoring > 0".
- Discovery now returns a **ranked list**, not one URL, so L3 can consume the top-K.

Files: `packages/scrapers/src/pricing/discover-url.ts` (candidate collection +
`scoreCandidate` + subdomain-aware URL matching), `pricing.scraper.ts` (consume the list).

### L2 — Deterministic price-harvest floor, BELOW the AI

Today the AI floor is terminal: `{plans:[]}` on a noisy page → zero rows. Add a pure,
**AI-free** harvester that runs **only when the AI floor returns empty AND
`hasPriceTokens` is true**:

- Walk the DOM for price tokens; for each, take the **nearest preceding label/heading**
  (plan name or product name) and the **nearest period token** (`/mo`, `/an`, `one-off`).
- Emit at minimum the **entry price** and the **range** (min → max) as
  `pricing_history` rows, so a page with *visible* prices never renders zero.
- Invariant: **if prices are visible, we never show "no tiers".** The harvest is a
  floor, not a replacement — a page the AI parses cleanly never reaches it.

Files: new pure module `packages/scrapers/src/pricing/harvest.ts` (+ unit tests over
fixtures), wired as the last stage in `extract-pricing.job.ts` after `stagedExtract`.

### L3 — Product-line aggregation (catalog sites) — **chosen: N aggregated rows**

When L1 returns **multiple** high-signal candidates (a product catalog: VPS / game /
dedicated), we capture them as **N product-line rows**, not one blurred tier list.

- **One snapshot, delimited.** The pricing scraper concatenates the **top-K** candidate
  DOMs (`MAX_PRODUCT_LINES`, ~3) into a single synthetic document with section
  delimiters, exactly like the api-capture wrapper. This keeps the
  snapshot → diff → change pipeline intact (one snapshot per scrape, one R2 object).
- **Line attribution.** Each section is stamped with a **product line** derived
  generically from the candidate's URL path segment or `<h1>` (`vps-hosting` → "VPS",
  `game-hosting` → "Game hosting"). Extraction (structured / harvest / AI) attributes
  every plan to its enclosing section.
- **Row shape — no new column.** The line is folded into `plan_name` as
  **`"<line> · <tier>"`** ("VPS · Starter", "Game · 10 slots"). This is deliberate:
  `normalizePlanKey` then keeps a "Starter" VPS row distinct from a "Starter" game row
  (they must not merge), and every reader (`resolveCurrentPricing`, compare, trends,
  battle cards, Ask) works unchanged. Consistent with Part I's "no bespoke column until
  a competitor demands it".
- **Caps.** ≤ `MAX_PRODUCT_LINES` sections × ≤ `MAX_ROWS_PER_LINE` rows so a 30-SKU
  billing catalog can't flood the tier list or the diff.

Files: `pricing.scraper.ts` (multi-candidate capture + delimiters),
`extract-pricing.job.ts` (per-section attribution + `plan_name` prefixing).

### L4 — UI honesty when structured tiers can't exist

For `dynamic` (configurator) and `gated_*`, "Tiers not captured yet — they'll appear
after the next successful pricing scan" is a **false promise** (a configurator will
never yield a tier table). Make the card status-aware:

- `dynamic` → "Configurator pricing — no fixed tiers" + the **starting price** captured
  from the configurator's default state (the browser already renders it; read the
  initial computed price, no interaction needed).
- `gated_demo`/`gated_signup` → keep the honest gated copy, drop the "next scan" promise.
- Only `public`/`public_partial` with a discoverable page keep the "after the next
  scan" wording.

Files: `apps/web/src/components/outrival/competitor-pricing-card.tsx` (status-aware
`blurb`), optional starting-price read in the pricing scraper.

## Eventualities — explicit decisions

**Kept generic (never a `if hosting`):** commerce subdomains, product-category pages,
price harvest, multi-locale convention paths, product-line aggregation. All driven by
signal density / vocabulary regex / DOM structure.

**Assumed limits (conscious skip, documented so they're not mistaken for bugs):**

- **Geo / multi-currency pricing** — we capture one region (`SCRAPER_REGION`, FR).
  A per-country price matrix is not modeled; `observed_region` records which we saw.
- **External marketplace listings** (Shopify/Chrome/WP app stores) — pricing on a
  third-party domain; a cross-registrable-domain follow is a tenant/safety risk and
  stays out.
- **PDF / image rate cards** — no OCR.
- **Prices rendered as images** (anti-scrape) — rare, skipped.
- **Login-gated real pricing** — correctly `gated_signup`, zero tiers is the right output.

## Guardrails / invariants (do not regress)

- **Competitor-agnostic** — no branch keys off domain/vertical/name (Part I invariant).
- **Cost** — L1 ranking and L2 harvest are L0/pure (no AI); browser scrapes and L0
  probes are hard-capped per run. The AI floor stays exactly as staged (patch-30).
- **Pipeline shape** — one snapshot per scrape (L3 concatenates, never multi-snapshots);
  `pricing_history` append-only; extraction idempotent.
- **SaaS happy path** — sites with a real `/pricing` page (the ones that work today)
  must take the identical path and cost; ranking with a single candidate = first-match.

## Rollout order

1. **L2 (harvest) + L4 (UI honesty)** — cheap, high-impact, no AI: never "0 tiers" when
   prices are visible, and no false promise. Ships value on day one.
2. **L1 (signal-density ranking + commerce subdomains + locales)** — reaches the
   catalog / boutique-subdomain sites.
3. **L3 (product-line aggregation)** — the heavy lift; delimited multi-candidate capture
   + per-line attribution.

## Implementation status (2026-07-07)

All four layers shipped. Kill-switches default on; each degrades to prior behaviour off.

- **L2 harvest** — `packages/scrapers/src/pricing/harvest.ts` (`harvestPricing`), wired
  as the floor in `extract-pricing.job.ts`. Distinct-title guard: a label repeated
  across prices is a shared section heading, not per-plan → collapses to the `From`/`Up
  to` band. Flag `PRICING_HARVEST_ENABLED`.
- **L1 discovery** — `discoverCommerceCandidates` in `pricing/discover-url.ts`: ranks
  same-registrable-domain commerce/category links (incl. store subdomains) by
  price-token density via capped L0 GETs. `discoverPricingUrl` (single-page) is
  unchanged — L1 is additive and only consumed by the scraper's catalog path.
- **L3 aggregation** — `pricing/product-lines.ts` (`deriveProductLine`,
  `buildAggregatedDocument`, `splitProductLines`) + the pricing scraper (top-K capture
  when no convention pricing page and ≥2 priced product pages) + `extract-pricing.job.ts`
  (per-section extraction, `plan_name = "<line> · <tier>"`, total-plans cap). One
  snapshot, so diff/change stay intact. Flag `PRICING_AGGREGATE_ENABLED` (cap
  `MAX_PRODUCT_LINES = 3`).
- **L4 honesty** — `competitor-pricing-card.tsx`: the missing-tiers blurb no longer
  promises "after the next scan"; it points at manual Edit (suppressed while capturing).

Known residuals (acceptable floor behaviour): harvest can surface a section-heading
label or a per-unit teaser on a messy homepage; catalog quality is highest on
browser-rendered product pages (structured-first / clean cards) and coarsens to a band
on teaser-only pages. Per-section extraction can cost up to K AI-floor calls for a
catalog (bounded by `MAX_PRODUCT_LINES`); structured-first + harvest avoid AI for most.
