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

- **Percentage fees** (`2.9% + $0.30`) — the fixed part lands as a `usage` row; the
  `%` component is not a currency amount and stays out of the numeric layer. The
  status/summary still surfaces it qualitatively.
- **Full graduated/stair-step curves** — only the entry tier + overage rate are
  captured, not every volume break. A calculator page stays `dynamic`.
- **Credit → feature consumption maps** (10 credits per AI action) — the credit
  pack price + quantity are captured; per-feature burn rates are not.

These are captured qualitatively by the AI source summary; making them first-class
would need a per-model sub-schema and is out of scope until a competitor demands it.
