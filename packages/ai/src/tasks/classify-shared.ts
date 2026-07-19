// Shared classification blocks (2026-07-10 audit item 2). Both classifiers —
// classifyChange (lexical, in its cached SYSTEM prefix) and
// classifyStructuredChanges (structured, in its prompt) — must judge by the SAME
// rubric: it used to be pasted verbatim in both files, which guarantees divergence
// at the first edit. A change here is validated by the labelled eval
// (src/eval/severity-eval.ts, `pnpm eval:severity`) BEFORE it ships.
//
// The severity RUBRIC was replaced by a materiality rubric: the model no longer
// names a band. It scores three observable axes and the band is computed from them
// in TypeScript (materiality.ts) — so who gets paged is a reviewable function, not
// a prose judgement that drifts with the provider. See materiality.ts for the
// mapping table.

export const MATERIALITY_RUBRIC = `<materiality-rubric>
Do NOT assign a severity, a priority, or an alert level. You score three axes and
nothing else; the severity is computed from your scores downstream.

Score each axis as an integer 0-3.

decision_impact — does this change a decision the customer would make, or an
action they should take?
  0 — nothing to act on: rewording, layout, cosmetics, routine copy.
  1 — worth knowing, but it changes no decision on its own.
  2 — it changes how the customer should position, price, or sell.
  3 — a direct threat to, or opening for, the customer's own revenue or
      positioning: a price undercut or pricing-structure change by a direct
      competitor, the launch of a directly competing flagship capability, a
      funding round >= $100M, an acquisition of a direct competitor, or entry
      into the customer's exact segment.

urgency — interrupt the customer now, or hold it for Monday's digest?
  0 — the Monday digest is fine.
  1 — this week.
  2 — the next couple of days.
  3 — the useful reaction window is measured in DAYS; reacting next week loses
      ground. Weeks-long windows are never 3.

corroboration — how many INDEPENDENT surfaces show the same thing? Use the recent
signals for this competitor, when provided, as the other surfaces.
  0 — the surfaces contradict each other, OR either side of the change looks like
      an anti-bot or error interstitial ("Robot Challenge Screen", "Checking the
      site connection security", "Just a moment...", a bare domain as the
      headline) — that is a capture artifact of our own scraper, not a competitor
      move. When it looks like an artifact, also score decision_impact 0.
  1 — this one surface shows it. THIS IS THE NORMAL CASE — use 1 unless another
      surface genuinely shows the same move.
  2 — a second independent surface agrees.
  3 — three or more independent surfaces agree.

Score on the CONTENT of the change, never on the size of the diff — a one-line
diff can score 3; a huge redesign diff can score 0.
</materiality-rubric>`;

export const CATEGORY_RULES = `<category-rules>
Judge WHAT changed, never WHERE it appeared:
- pricing: any price, plan, tier, trial, or gating change, on any page.
- ma: a merger, an acquisition (in either direction), or a divestiture.
- funding: a raise or valuation announcement, even on a blog post.
- security_compliance: a security or compliance posture change — SOC 2, ISO 27001,
  HIPAA, PCI, FedRAMP, GDPR/DPA, a penetration-test report, a trust center, or a
  disclosed breach or vulnerability.
- product: shipped or announced capabilities, launches.
- partnerships: an alliance, integration, connector, marketplace listing, or a
  reseller/OEM deal with a named third party.
- leadership: an executive or board arrival, departure, or role change.
- hiring: job postings and team growth — even when they telegraph product direction.
- reviews: review-platform score or review-content movements only.
- ads: paid-acquisition posture — ad campaigns, promo codes, limited-time offers,
  dedicated paid landing pages.
- content: messaging, positioning, or content-strategy changes (use only when none
  of the above applies).
A partnership that ships a working integration is "partnerships", not "product".
An acquisition is "ma", never "funding".
When two genuinely apply, pick by this priority: pricing > ma > funding >
security_compliance > product > partnerships > leadership > hiring > reviews >
ads > content.
</category-rules>`;
