import { test, expect, mock, afterAll } from "bun:test";

// The pooled Chromium is process-global, and since the pg-boss cutover the process
// runs SCRAPE_CONCURRENCY scrapes at once. These tests pin the two things that
// broke when the old "one run = one machine" assumption stopped holding.
//
// `playwright` is mocked here rather than launched: the behaviour under test is the
// pool's bookkeeping, not Chromium. Nothing else in this package imports playwright,
// so the module mock has no other reader.

let launches = 0;
let closes = 0;
// Held open by a test to keep a render in flight for as long as it needs.
let gate: Promise<void> = Promise.resolve();
// Reproduces the production wedge: a pooled browser that is still "connected" but
// never answers, so opening a context hangs instead of failing.
let hangNewContext = false;

function fakeBrowser() {
  return {
    isConnected: () => true,
    close: async () => {
      closes++;
    },
    newContext: async () => {
      if (hangNewContext) await new Promise(() => {});
      return {
        close: async () => {},
        route: async () => {},
        newPage: async () => ({
          on: () => {},
          // Fails AFTER the gate, so the render lasts as long as the test wants and
          // still leaves through the same finally a real failure would.
          goto: async () => {
            await gate;
            throw new Error("nav failed");
          },
        }),
      };
    },
  };
}

mock.module("playwright", () => ({
  chromium: {
    launch: async () => {
      launches++;
      return fakeBrowser();
    },
  },
}));

const {
  scrapeWithPatchright,
  closePatchrightPool,
  closeTierBrowser,
  __setPoolCeilingsForTest,
} = await import("./scrape-patchright");

/** A gate the test opens by hand, to hold a render open. */
function openGate(): () => void {
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  return release;
}

afterAll(() => {
  gate = Promise.resolve();
  hangNewContext = false;
  __setPoolCeilingsForTest(null);
  mock.restore();
});

test("concurrent renders share ONE launched browser, not one each", async () => {
  await closePatchrightPool();
  launches = 0;
  const release = openGate();
  const renders = Promise.all([
    scrapeWithPatchright("https://a.example/", "direct"),
    scrapeWithPatchright("https://b.example/", "direct"),
    scrapeWithPatchright("https://c.example/", "direct"),
  ]);
  release();
  await renders;
  // Before the in-flight launch was memoised, each of the three launched its own
  // Chromium and two were left unreachable — resident until the box ran out.
  expect(launches).toBe(1);
});

test("a teardown mid-render is deferred, not applied under the live render", async () => {
  await closePatchrightPool();
  closes = 0;
  gate = Promise.resolve();
  // Populate the pool, then hold a second render open across a sibling's teardown.
  await scrapeWithPatchright("https://warm.example/", "direct");
  const release = openGate();
  const render = scrapeWithPatchright("https://slow.example/", "direct");
  await Promise.resolve(); // let the render reach its goto and park on the gate

  await closePatchrightPool(); // a sibling job's finally fires
  // The whole point: while a render holds the browser, nothing is pulled from
  // under it. This assertion is what used to fail in production as "Target page,
  // context or browser has been closed".
  expect(closes).toBe(0);

  release();
  await render;
  expect(closes).toBe(1); // last one out honoured the deferred request
});

test("closeTierBrowser leaves a browser a concurrent render is using", async () => {
  await closePatchrightPool();
  closes = 0;
  gate = Promise.resolve();
  await scrapeWithPatchright("https://warm.example/", "direct");
  const release = openGate();
  const render = scrapeWithPatchright("https://slow.example/", "direct");
  await Promise.resolve();

  // A cascade escalation in another job frees "its" tier — which is this one.
  await closeTierBrowser("direct");
  expect(closes).toBe(0);

  release();
  await render;
});

test("a render whose context never opens fails instead of parking forever", async () => {
  await closePatchrightPool();
  closes = 0;
  gate = Promise.resolve();
  __setPoolCeilingsForTest({ poolOp: 20, leaseMax: 60_000 });
  hangNewContext = true;

  const result = await scrapeWithPatchright("https://wedged.example/", "direct");
  expect(result.ok).toBe(false);
  expect(result.failureReason).toBe("timeout");

  // The whole outage in one assertion: this render used to never return, so its
  // lease was never released, so the guard below never let the dead browser go and
  // every later render parked on it too. Only a process restart cleared it.
  hangNewContext = false;
  await closePatchrightPool();
  expect(closes).toBe(1);
});

test("an abandoned lease stops blocking teardown once it goes stale", async () => {
  await closePatchrightPool();
  closes = 0;
  gate = Promise.resolve();
  __setPoolCeilingsForTest({ poolOp: 5_000, leaseMax: 20 });
  await scrapeWithPatchright("https://warm.example/", "direct");

  const release = openGate();
  const render = scrapeWithPatchright("https://parked.example/", "direct");

  await closePatchrightPool(); // lease still fresh → correctly deferred
  expect(closes).toBe(0);

  await new Promise((r) => setTimeout(r, 40)); // lease outlives any real render
  // Belt and braces for a hang the ceilings above don't yet know about: the guard
  // honours live renders, never an abandoned one.
  await closePatchrightPool();
  expect(closes).toBe(1);

  release();
  await render;
});
