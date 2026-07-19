import { queue, type Queue } from "@trigger.dev/sdk/v3";

// Shared throttle for jobs that call Groq. Free tier is 12k TPM on
// llama-3.3-70b — fanning out classify/insight in parallel blows the budget
// and 429s. Serializing them (+ provider maxRetries honoring retry-after)
// keeps the pipeline under the limit.
export const groqQueue: Queue = queue({
  name: "groq-ai",
  concurrencyLimit: 1,
});

// L2 archive backfill hits the Internet Archive (a shared free resource). Keep a
// low ceiling so a batch of onboarding backfills (one per competitor × source)
// can't hammer it — each job is already sequential + ~1 req/s internally.
export const backfillQueue: Queue = queue({
  name: "backfill",
  concurrencyLimit: 2,
});

// Onboarding /complete fires every competitor's homepage scrape at once, so this
// job fans out N-wide within seconds. Hitting the free AI provider tier all at
// once throttles it (429) → slow failover to the PAID tier: those runs take ~1-2min
// (near maxDuration) and cost ~40× the ~3s/$0.0001 happy path. Serialising the
// burst (limit 1) keeps each call alone on the fast free tier. This is a cost/
// latency mitigation — NOT the "1/N stuck" fix (that was parse_failed → null →
// no-retry, handled in refresh-competitor-summary's core body + grounding dropped
// for summarize_competitor). Env-tunable up for paid AI tiers.
export const summaryQueue: Queue = queue({
  name: "competitor-summary",
  concurrencyLimit: Number(process.env.SUMMARY_CONCURRENCY ?? 1),
});
