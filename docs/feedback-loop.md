# Feedback loop — quality of AI outputs (patch-21)

Outrival ships a lot of AI output (signals, discovery suggestions, battle cards,
digests, severity classifications). This loop captures whether each one was
**useful**, takes an immediate user-visible action, and aggregates the verdicts so
**a human** (Mathys) can tune prompts and thresholds. Nothing is ever
auto-adjusted.

## The three layers

1. **Inline capture** — 1-click verdict (`useful` / `not_useful`) at each AI output
   point; the reason is always optional. Table: `quality_feedback`
   (`packages/db/src/schema/quality-feedback.ts`). API: `/api/feedback-quality`
   (upsert / get / delete) + `/api/digest-feedback` (public, HMAC-token, from the
   email).
2. **Immediate action** — a `not_useful` verdict does something visible:
   - signal → hidden from the user's feed (`signals.hiddenForUserAt`)
   - discovery suggestion → dismissed (`competitor_candidates.status = dismissed`)
   - battle card → flagged for regeneration (`battle_cards.flaggedForRegenerationAt`)
   - severity → override written (`signals.severityOverride`, too high → low / too low → high)
   - digest / NPS → recorded only
   Deleting the feedback reverts the action.
3. **Systemic action** — the admin dashboard (`/admin/feedback-quality`,
   `ADMIN_EMAILS`-gated) aggregates verdicts and surfaces **patterns**. The weekly
   `feedback-pattern-detection` job pings `OPS_SLACK_WEBHOOK_URL` on critical
   patterns only.

## The six feedback points

| Point | Where | targetType | targetId |
|-------|-------|-----------|----------|
| Signal | `signal-card.tsx` (under the source line) | `signal` | signal id |
| Discovery suggestion | `dashboard/candidates` (Track = useful, Dismiss = not useful) | `discovery_suggestion` | candidate id |
| Battle card | `battle-card-tab.tsx` (footer) | `battle_card` | battle card id |
| Digest | weekly email footer (signed link) | `digest` | digest id |
| Severity | `severity-feedback.tsx` (under the badge) | `severity_classification` | signal id |
| NPS | `nps-prompt.tsx` (modal, ≤ 1× / 30 days) | `nps` | `nps-YYYY-MM` |

## When to intervene (statistical thresholds)

- **Dashboard pattern** (`/admin/feedback-quality`): per type over 14 days, flagged
  when `total ≥ FEEDBACK_AGGREGATE_MIN_COUNT` (default 5) **and** `not_useful_rate > 60%`.
- **Critical (Slack ping)**: `not_useful_rate > 75%` **and** `count ≥ 10` over 14 days.
- Below the minimum sample → ignore; it's noise, not a trend.

## Recommended workflow

1. **Identify** — a pattern is flagged in the dashboard (or pinged on Slack Monday 9:00 UTC).
2. **See examples** — read the actual feedback (reasons + free text) for that type.
3. **Adjust** — change the relevant prompt / threshold (see below). One change at a time.
4. **Wait 7 days** — let new feedback accumulate under the change.
5. **Re-measure** — compare the not-useful rate for that type before / after.

## Types of adjustment by category

- **Signals** (`irrelevant`/`trivial` high) → tighten the relevance threshold
  (`ENRICHMENTS_RELEVANCE_MIN_SCORE`) or the classify prompt's significance bar.
- **Severity** (`too_high`/`too_low` high) → recalibrate the severity rubric in the
  classify prompt; the user overrides are the ground-truth signal.
- **Discovery** (`irrelevant`/`duplicate` high) → raise the overlap threshold or
  improve dedup in detection.
- **Battle cards** (`incorrect`/`outdated` high) → revise the battle-card prompt or
  the context it's given (reviews / signals freshness).
- **Digest** (`trivial`/`irrelevant` high) → revisit digest selection / temperature.

## Anti-patterns to avoid

- **No auto-adjustment.** Always a human in the loop — never wire feedback straight
  into a prompt or threshold change.
- **No overfitting.** Don't react to a handful of feedbacks; respect the minimum sample.
- **Never hide negative feedback.** A high not-useful rate is the product telling you
  the truth — surface it, don't filter it.
- **One change at a time**, then measure — otherwise you can't attribute the effect.
