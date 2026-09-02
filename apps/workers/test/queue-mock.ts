import { mock } from "bun:test";
import type { JobDef } from "@outrival/queue";

// The ONE mock of @outrival/queue for the whole test process, registered from the
// preloaded test/setup.ts. Same shape and the same two reasons as shared-mock.ts.
//
// Leak (`code:TES-23`). Twelve files each ran their own
// `mock.module("@outrival/queue", () => ({ ...real, generateSignal: mine }))`.
// mock.module is process-global and cannot be unregistered, so the file bun loaded
// last owned `generateSignal` for every file after it: an enqueue a later file meant
// to observe went into an earlier file's array, which by then nobody was reading.
// Nothing failed while the two files happened to agree on what a stub should do.
//
// Drift (`code:TES-64`). Those stubs were written `{ queue: "generate-signal",
// enqueue }` — a shape JobDef has never had (the field is `name`, not `queue`) that
// also dropped `queueOptions`, `workOptions` and `enqueueMany`. The compiler cannot
// see it: mock.module's factory return type is not checked against the module it
// replaces. The wrappers below spread the REAL def and override only the two methods,
// so the stub is a JobDef by construction and gains whatever the real one gains next.
//
// `real` is a snapshot taken BEFORE the mock lands: mock.module mutates the exports on
// the live namespace object in place, so delegating to that object would recurse.
const real: Record<string, unknown> = { ...(await import("@outrival/queue")) };

/** Jobs a test file may intercept. Add one here to observe something new. */
const STUBBABLE = [
  "backfillPricingHistory",
  "classifyChange",
  "detectReviewThemeShifts",
  "extractPricing",
  "generateSignal",
  "verifySignalDelta",
] as const;
type Stubbable = (typeof STUBBABLE)[number];

type AnyJob = JobDef<Record<string, unknown>>;
/** What a file may stand in for. Anything left out keeps the real implementation. */
export type JobOverride = Partial<Pick<AnyJob, "enqueue" | "enqueueMany">>;

let overrides: Partial<Record<Stubbable, JobOverride>> = {};

mock.module("@outrival/queue", () => ({
  ...real,
  ...Object.fromEntries(
    STUBBABLE.map((name) => {
      const def = real[name] as AnyJob;
      const wrapper: AnyJob = {
        ...def,
        enqueue: (data, options) => (overrides[name]?.enqueue ?? def.enqueue)(data, options),
        enqueueMany: (rows) => (overrides[name]?.enqueueMany ?? def.enqueueMany)(rows),
      };
      return [name, wrapper];
    }),
  ),
}));

/** Intercept the named jobs. Call from beforeAll/beforeEach so the file owns them while it runs. */
export function setQueueOverrides(next: Partial<Record<Stubbable, JobOverride>>): void {
  overrides = next;
}

/** Hand @outrival/queue back untouched. Call from afterAll. */
export function clearQueueOverrides(): void {
  overrides = {};
}

/**
 * The common case: record every payload the job receives and answer like the real
 * enqueue. `enqueueMany` records each row's `data`, so a caller that switches to the
 * batch API keeps the same assertions.
 *
 * Takes a GETTER, not the array: every caller clears with `enqueued = []` in a
 * beforeEach, which rebinds the variable. Holding the array captured at beforeAll
 * would record into the one the file has already thrown away.
 */
export function recordEnqueues<P>(into: () => P[]): JobOverride {
  return {
    enqueue: async (data) => {
      into().push(data as P);
      return "job-id";
    },
    enqueueMany: async (rows) => {
      for (const row of rows) into().push(row.data as P);
      return rows.map(() => "job-id");
    },
  };
}
