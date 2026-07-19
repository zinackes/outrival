// Shim for Trigger.dev's durable `wait.for({ seconds })`. Trigger checkpoints the run
// on a wait >5 s (~no compute while parked); pg-boss has no durable checkpoint, so the
// handler simply sleeps in-process, holding its worker slot for the duration. The only
// caller (notify-onboarding-analysis) is a rare, per-onboarding job that polls at most
// ~8 min, so occupying one light slot is acceptable. Keeps the core body's `wait.for`
// calls unchanged across both runtimes.
export const wait = {
  for: ({ seconds }: { seconds: number }): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
};
