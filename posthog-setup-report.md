<wizard-report>
# PostHog post-wizard report

The wizard completed a second-pass integration of PostHog analytics into the Outrival API. The `posthog-node` SDK (v5.35.5) was already installed with a `lib/posthog.ts` singleton providing `captureServerEvent` and `identifyUser`. The wizard audited all existing events (13 already in place), identified 5 missing high-value events, added them across 5 route files, and updated environment variables `POSTHOG_API_KEY` and `POSTHOG_HOST` in `.env`. Typecheck passes clean.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | New user requests a sign-in OTP (pre-existing) | `apps/api/src/routes/auth.ts` |
| `user_logged_in` | Existing user requests a sign-in OTP (pre-existing) | `apps/api/src/routes/auth.ts` |
| `onboarding_completed` | User finishes onboarding and selects competitors (pre-existing) | `apps/api/src/routes/onboarding.ts` |
| `onboarding_skipped` | User skips onboarding entirely | `apps/api/src/routes/onboarding.ts` |
| `competitor_added` | User manually adds a competitor to track (pre-existing) | `apps/api/src/routes/competitors.ts` |
| `competitor_deleted` | User soft-deletes a competitor (pre-existing) | `apps/api/src/routes/competitors.ts` |
| `monitor_enabled` | User enables a new monitoring source (pre-existing) | `apps/api/src/routes/competitors.ts` |
| `competitor_signals_exported` | User downloads signals as CSV | `apps/api/src/routes/competitors.ts` |
| `checkout_initiated` | Stripe Checkout session created (pre-existing) | `apps/api/src/routes/billing.ts` |
| `plan_upgraded` | Stripe subscription activated/updated to paid plan (pre-existing) | `apps/api/src/routes/stripe-webhook.ts` |
| `subscription_cancelled` | Stripe subscription cancelled, org downgraded to free | `apps/api/src/routes/stripe-webhook.ts` |
| `battle_card_generated` | User triggers AI battle card generation (pre-existing) | `apps/api/src/routes/battle-cards.ts` |
| `battle_card_pdf_downloaded` | User downloads a battle card as PDF | `apps/api/src/routes/battle-cards.ts` |
| `signal_action_updated` | User sets triage action status on a signal (pre-existing) | `apps/api/src/routes/signals.ts` |
| `signal_comment_posted` | User posts a comment on a signal | `apps/api/src/routes/signals.ts` |
| `ask_query_submitted` | User submits a question to Ask Outrival (pre-existing) | `apps/api/src/routes/ask.ts` |
| `quality_feedback_given` | User rates an AI output (pre-existing) | `apps/api/src/routes/feedback-quality.ts` |
| `$exception` | Unhandled server error via global error handler (pre-existing) | `apps/api/src/index.ts` |

## Next steps

We've built a dashboard and five insights to track the metrics that matter most:

- **Dashboard**: [Analytics basics (wizard)](https://eu.posthog.com/project/201287/dashboard/746155)
- [Signup → Onboarding Funnel](https://eu.posthog.com/project/201287/insights/aEt6dzHx) — conversion from `user_signed_up` → `onboarding_completed` (14-day window)
- [New Signups & Plan Upgrades](https://eu.posthog.com/project/201287/insights/lWkkda6b) — weekly unique users for both events (90 days)
- [Churn — Subscription Cancellations](https://eu.posthog.com/project/201287/insights/xqbME0UJ) — weekly `subscription_cancelled` count (90 days)
- [Onboarding Completed vs Skipped](https://eu.posthog.com/project/201287/insights/P0233AYQ) — stacked bar of `onboarding_completed` vs `onboarding_skipped` per week
- [Core Feature Engagement](https://eu.posthog.com/project/201287/insights/YPXCaIY1) — daily `competitor_added`, `battle_card_generated`, `ask_query_submitted` (30 days)

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
