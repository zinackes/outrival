// Shared classification blocks (2026-07-10 audit item 2). Both classifiers —
// classifyChange (lexical, in its cached SYSTEM prefix) and
// classifyStructuredChanges (structured, in its prompt) — must judge severity
// and category by the SAME rubric: it used to be pasted verbatim in both files,
// which guarantees divergence at the first edit. A change here is validated by
// the labelled eval (src/eval/severity-eval.ts, `pnpm eval:severity`) BEFORE it
// ships — the rubric decides who gets paged (critical bypasses all moderation).

export const SEVERITY_RUBRIC = `<severity-rubric>
"critical" triggers an IMMEDIATE email to the customer, bypassing all moderation.
Use it only when BOTH hold:
  (a) the change is a direct threat or opening for the customer's own positioning
      or revenue — a price undercut or pricing-structure change by a direct
      competitor, the launch of a directly competing flagship capability, a funding
      round >= $100M or an acquisition of a direct competitor, or entry into the
      customer's exact segment; AND
  (b) the useful reaction window is DAYS, not weeks.
If unsure between "critical" and "high", choose "high".
"high" — a material strategic move where reacting next week loses nothing: a
notable product launch, a quantified price change, a complete repositioning of the
hero/value proposition, a strategic hiring wave.
"medium" — real but incremental: a new job posting, a new page section, a
promotion, a plan-limit tweak.
"low" — cosmetic or informational: copy polish, testimonials/logos, navigation,
meta tags, documentation pages.
If either side of the change looks like an anti-bot or error interstitial
("Robot Challenge Screen", "Checking the site connection security", "Just a
moment...", a bare domain as headline), the "change" is a capture artifact of
our own scraper, not a competitor move: severity "low", is_significant false.
Severity is judged on the CONTENT of the change, never on the size of the diff —
a one-line diff can be critical; a huge redesign diff can be low.
</severity-rubric>`;

export const CATEGORY_RULES = `<category-rules>
Judge WHAT changed, never WHERE it appeared:
- pricing: any price, plan, tier, trial, or gating change, on any page.
- funding: a raise, acquisition, or valuation announcement, even on a blog post.
- product: shipped or announced capabilities, launches, integrations.
- hiring: job postings and team growth — even when they telegraph product direction.
- reviews: review-platform score or review-content movements only.
- content: messaging, positioning, or content-strategy changes (use only when none
  of the above applies).
When two genuinely apply, pick by this priority: pricing > funding > product >
hiring > reviews > content.
</category-rules>`;
