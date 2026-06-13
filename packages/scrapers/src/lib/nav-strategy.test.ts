import { test, expect, afterEach } from "bun:test";
import { navWaitUntil, settleAfterNav } from "./nav-strategy";

const ORIG = process.env.SCRAPE_WAIT_NETWORKIDLE;
afterEach(() => {
  if (ORIG === undefined) delete process.env.SCRAPE_WAIT_NETWORKIDLE;
  else process.env.SCRAPE_WAIT_NETWORKIDLE = ORIG;
});

test("default nav strategy is domcontentloaded (networkidle dropped)", () => {
  delete process.env.SCRAPE_WAIT_NETWORKIDLE;
  expect(navWaitUntil()).toBe("domcontentloaded");
});

test("kill-switch restores legacy networkidle", () => {
  process.env.SCRAPE_WAIT_NETWORKIDLE = "true";
  expect(navWaitUntil()).toBe("networkidle");
});

test("settleAfterNav does a bounded best-effort wait by default", async () => {
  delete process.env.SCRAPE_WAIT_NETWORKIDLE;
  let calledWith: { timeout: number } | null = null;
  await settleAfterNav({
    waitForLoadState: async (_state, opts) => {
      calledWith = opts;
    },
  });
  expect(calledWith).not.toBeNull();
  expect(calledWith!.timeout).toBeGreaterThan(0);
});

test("settleAfterNav is a no-op in legacy networkidle mode", async () => {
  process.env.SCRAPE_WAIT_NETWORKIDLE = "true";
  let called = false;
  await settleAfterNav({
    waitForLoadState: async () => {
      called = true;
    },
  });
  expect(called).toBe(false);
});

test("settleAfterNav never throws when the wait rejects (busy page)", async () => {
  delete process.env.SCRAPE_WAIT_NETWORKIDLE;
  await expect(
    settleAfterNav({
      waitForLoadState: async () => {
        throw new Error("network never idled");
      },
    }),
  ).resolves.toBeUndefined();
});
