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
