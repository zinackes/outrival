import { afterAll, describe, expect, test } from "bun:test";
import type { Queue, QueueResult } from "pg-boss";
import { planQueueReconciliation, queueErrorAlert } from "./boss";
import * as jobs from "./jobs";

// The two pieces of boss.ts that decide something without a live pg-boss in front
// of them, and that both fail silently when they are wrong: the reconciliation that
// makes jobs.ts the real source of truth for queue options, and the throttle that
// keeps a queue outage from turning into hundreds of Slack messages an hour.

// --- planQueueReconciliation ------------------------------------------------

type Def = { name: string; queueOptions: Omit<Queue, "name"> };

/** The options defineJob() actually produces, minus the per-job overrides. */
function opts(over: Partial<Omit<Queue, "name">> = {}): Omit<Queue, "name"> {
  return {
    policy: "standard",
    retryLimit: 2,
    retryDelay: 1,
    retryBackoff: true,
    retryDelayMax: 10,
    expireInSeconds: 300,
    deleteAfterSeconds: 7 * 24 * 3600,
    notify: true,
    ...over,
  } as Omit<Queue, "name">;
}

/** A `getQueues()` row that agrees with the declared options, before drift. */
function liveRow(name: string, o: Omit<Queue, "name">, over: Record<string, unknown> = {}) {
  return { name, ...o, ...over } as unknown as QueueResult;
}

describe("planQueueReconciliation", () => {
  test("a queue whose row already matches is left alone", () => {
    const def: Def = { name: "scrape-monitor", queueOptions: opts() };
    expect(planQueueReconciliation([def], [liveRow(def.name, def.queueOptions)])).toEqual([]);
  });

  // The exact drift the reconciliation exists for: jobs.ts was raised to 900s after
  // a run measured at 302.7s, and createQueue's create-IF-NOT-EXISTS left prod on
  // the 300 it was born with.
  test("it reports only the keys that differ, with both values", () => {
    const def: Def = { name: "scrape-monitor", queueOptions: opts({ expireInSeconds: 900 }) };
    const plan = planQueueReconciliation([def], [liveRow(def.name, opts({ expireInSeconds: 300 }))]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.name).toBe("scrape-monitor");
    expect(plan[0]!.changed).toEqual({ expireInSeconds: { was: 300, now: 900 } });
  });

  // pg-boss refuses to change `policy` after creation (it decides the queue's table
  // shape), so it must not reach updateQueue AND must not count as drift — otherwise
  // a queue created as `standard` and later declared `singleton` would be "repaired"
  // on every single boot, forever, with a failing write each time.
  test("policy is neither compared nor sent", () => {
    const def: Def = { name: "heartbeat", queueOptions: opts({ policy: "singleton" }) };
    const plan = planQueueReconciliation([def], [liveRow(def.name, opts({ policy: "standard" }))]);
    expect(plan).toEqual([]);
  });

  test("policy is stripped from the payload even when something else drifted", () => {
    const def: Def = {
      name: "heartbeat",
      queueOptions: opts({ policy: "singleton", retryLimit: 5 }),
    };
    const plan = planQueueReconciliation([def], [liveRow(def.name, opts({ policy: "singleton" }))]);
    expect(plan[0]!.changed).toEqual({ retryLimit: { was: 2, now: 5 } });
    expect(plan[0]!.desired).not.toHaveProperty("policy");
  });

  // getQueues() answering short means the row is not there to update. Skipping it is
  // the whole reason the boot survives: updateQueue on a missing queue throws, and
  // createQueue will make it on the next boot anyway.
  test("a queue missing from the live rows is skipped, not updated", () => {
    const defs: Def[] = [
      { name: "scrape-monitor", queueOptions: opts({ retryLimit: 5 }) },
      { name: "brand-new-job", queueOptions: opts({ retryLimit: 5 }) },
    ];
    const plan = planQueueReconciliation(defs, [liveRow("scrape-monitor", opts())]);
    expect(plan.map((p) => p.name)).toEqual(["scrape-monitor"]);
  });

  test("a newly declared deadLetter counts as drift", () => {
    const def: Def = { name: "classify-change", queueOptions: opts({ deadLetter: "outrival-dlq" }) };
    const plan = planQueueReconciliation([def], [liveRow(def.name, opts(), { deadLetter: null })]);
    expect(plan[0]!.changed).toEqual({ deadLetter: { was: null, now: "outrival-dlq" } });
  });

  // The comparison is `!==`, so any option whose value is an object or an array would
  // never equal the row read back and would be "repaired" on every boot of every
  // worker — a write and a warn per queue, forever, saying nothing changed. Run the
  // REAL registry against rows built from its own options: the plan must be empty.
  test("no declared job carries an option that can never compare equal", () => {
    const defs = Object.values(jobs).filter(
      (v): v is Def =>
        typeof v === "object" && v !== null && "name" in v && "queueOptions" in v,
    );
    expect(defs.length).toBeGreaterThan(40);
    const live = defs.map((d) => liveRow(d.name, d.queueOptions));
    expect(planQueueReconciliation(defs, live)).toEqual([]);
  });
});

// --- queueErrorAlert --------------------------------------------------------

// The throttle window lives in module state, so every test takes its timestamps from
// this clock, which only ever moves forward. That keeps the file order-independent:
// `bun test --randomize` must give the same result.
const WINDOW_MS = 5 * 60_000;
let clock = Date.now();
const nextWindow = () => (clock += WINDOW_MS * 10);

const REAL_ROLE = process.env.WORKER_ROLE;
afterAll(() => {
  if (REAL_ROLE === undefined) delete process.env.WORKER_ROLE;
  else process.env.WORKER_ROLE = REAL_ROLE;
});

describe("queueErrorAlert", () => {
  test("names the failing role and the error", () => {
    process.env.WORKER_ROLE = "browser";
    const text = queueErrorAlert(new Error("connection terminated unexpectedly"), nextWindow());
    expect(text).toContain("`browser`");
    expect(text).toContain("connection terminated unexpectedly");
  });

  test("with no WORKER_ROLE the sender reads as the api", () => {
    delete process.env.WORKER_ROLE;
    expect(queueErrorAlert(new Error("boom"), nextWindow())).toContain("`api`");
  });

  test("a thrown non-Error is still reported", () => {
    expect(queueErrorAlert("ECONNRESET", nextWindow())).toContain("ECONNRESET");
  });

  // pg-boss emits `error` per failed operation, so a queue-Postgres outage fires it
  // on every poll of every worker. Without this, the alert IS the outage.
  test("the second error in the window is suppressed", () => {
    const first = nextWindow();
    expect(queueErrorAlert(new Error("first"), first)).not.toBeNull();
    expect(queueErrorAlert(new Error("second"), first + 1)).toBeNull();
    expect(queueErrorAlert(new Error("third"), first + WINDOW_MS - 1)).toBeNull();
  });

  test("it speaks again once the window has passed", () => {
    const first = nextWindow();
    expect(queueErrorAlert(new Error("first"), first)).not.toBeNull();
    expect(queueErrorAlert(new Error("later"), first + WINDOW_MS)).toContain("later");
  });

  // A suppressed call must not extend the window: otherwise a fault firing every
  // second would hold the gate shut forever and the outage would go unannounced
  // after its very first message.
  test("a suppressed call does not push the window back", () => {
    const first = nextWindow();
    queueErrorAlert(new Error("first"), first);
    for (let t = first + 1; t < first + WINDOW_MS; t += 30_000) {
      queueErrorAlert(new Error("noise"), t);
    }
    expect(queueErrorAlert(new Error("finally"), first + WINDOW_MS)).toContain("finally");
  });
});
