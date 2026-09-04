import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { withAiSlot, aiSlotStats, consumeAiSlotPeak, resetAiSlots } from "./semaphore";

const original = process.env.AI_MAX_CONCURRENT_CALLS;

/** A promise plus the handle that settles it, so a test can hold a slot open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withAiSlot", () => {
  beforeEach(() => {
    resetAiSlots();
    process.env.AI_MAX_CONCURRENT_CALLS = "2";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AI_MAX_CONCURRENT_CALLS;
    else process.env.AI_MAX_CONCURRENT_CALLS = original;
  });

  it("never lets more than the limit run at once", async () => {
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        withAiSlot(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(aiSlotStats()).toEqual({ inFlight: 0, waiting: 0, peak: 2 });
  });

  it("makes the third caller wait for a slot, then run it", async () => {
    const held = deferred();
    let thirdRan = false;
    const a = withAiSlot(() => held.promise);
    const b = withAiSlot(() => held.promise);
    const c = withAiSlot(async () => {
      thirdRan = true;
    });
    await tick();
    expect(thirdRan).toBe(false);
    expect(aiSlotStats().waiting).toBe(1);
    held.resolve();
    await Promise.all([a, b, c]);
    expect(thirdRan).toBe(true);
  });

  it("hands the slot over in arrival order", async () => {
    const held = deferred();
    const order: number[] = [];
    const running = [
      withAiSlot(() => held.promise),
      withAiSlot(() => held.promise),
      ...[1, 2, 3].map((n) =>
        withAiSlot(async () => {
          order.push(n);
        }),
      ),
    ];
    held.resolve();
    await Promise.all(running);
    expect(order).toEqual([1, 2, 3]);
  });

  // A throw is the common case here — the pool exhausts and rethrows — so a slot
  // leaked on the error path would wedge the whole process after a few outages.
  it("releases the slot when the call throws", async () => {
    await expect(
      withAiSlot(async () => {
        throw new Error("all_providers_failed");
      }),
    ).rejects.toThrow("all_providers_failed");
    expect(aiSlotStats().inFlight).toBe(0);
    await withAiSlot(async () => {});
    expect(aiSlotStats().inFlight).toBe(0);
  });

  it("is disabled by 0, so a bad value cannot wedge the fleet", async () => {
    process.env.AI_MAX_CONCURRENT_CALLS = "0";
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withAiSlot(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(8);
  });

  // The mark is seeded with what is STILL in flight rather than with zero: a sample
  // taken mid-burst would otherwise report an idle pool for the interval that carried
  // the burst's tail.
  it("reports a high-water mark and reseeds it from the live occupancy on read", async () => {
    const held = deferred();
    const running = [withAiSlot(() => held.promise), withAiSlot(() => held.promise)];
    await tick();
    expect(consumeAiSlotPeak()).toBe(2);
    held.resolve();
    await Promise.all(running);
    expect(consumeAiSlotPeak()).toBe(2); // the tail of the interval just read
    expect(consumeAiSlotPeak()).toBe(0); // now genuinely idle
  });
});
