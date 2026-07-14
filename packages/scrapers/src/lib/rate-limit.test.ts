import { test, expect } from "bun:test";
import { computeFireAt } from "./rate-limit";

const GAP = 2000;

test("an idle domain (no prior request) fires immediately", () => {
  const now = 1_000_000;
  expect(computeFireAt(0, GAP, now)).toBe(now);
});

test("a request within the gap is pushed to last + gap", () => {
  const last = 1_000_000;
  const now = last + 500; // only 500ms since the last request
  expect(computeFireAt(last, GAP, now)).toBe(last + GAP);
});

test("a request after the gap fires immediately", () => {
  const last = 1_000_000;
  const now = last + GAP + 5000; // well past the gap
  expect(computeFireAt(last, GAP, now)).toBe(now);
});

test("consecutive reservations stack by the gap", () => {
  const now = 1_000_000;
  const first = computeFireAt(0, GAP, now);
  const second = computeFireAt(first, GAP, now); // both scheduled at ~now
  expect(second).toBe(first + GAP);
});

test("a longer crawl-delay overrides the default gap", () => {
  const last = 1_000_000;
  const now = last + 100;
  const crawlDelay = 10_000;
  expect(computeFireAt(last, crawlDelay, now)).toBe(last + crawlDelay);
});
