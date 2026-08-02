import { describe, expect, it, beforeEach } from "bun:test";
import {
  shouldAttemptHeal,
  healPausedUntil,
  pauseHealsAfterPoolFailure,
  resetHealPause,
} from "../src/lib/heal-cooldown";

const HOUR = 3_600_000;
const COOLDOWN = 12 * HOUR;
const NOW = 1_760_000_000_000;

const attempt = (over: Partial<Parameters<typeof shouldAttemptHeal>[0]> = {}) =>
  shouldAttemptHeal({
    lastHealAttemptAt: null,
    now: NOW,
    cooldownMs: COOLDOWN,
    poolPausedUntil: 0,
    ...over,
  });

describe("shouldAttemptHeal", () => {
  beforeEach(resetHealPause);

  it("attempts when the page has never been healed", () => {
    expect(attempt()).toBe(true);
  });

  it("parks a page whose last attempt is inside the cooldown", () => {
    expect(attempt({ lastHealAttemptAt: new Date(NOW - HOUR) })).toBe(false);
  });

  it("releases a page once the cooldown has fully elapsed", () => {
    expect(attempt({ lastHealAttemptAt: new Date(NOW - COOLDOWN) })).toBe(true);
    expect(attempt({ lastHealAttemptAt: new Date(NOW - COOLDOWN - 1) })).toBe(true);
  });

  it("holds a page one millisecond short of the cooldown", () => {
    expect(attempt({ lastHealAttemptAt: new Date(NOW - COOLDOWN + 1) })).toBe(false);
  });

  // The whole point of the split: a pool outage must not be recorded as a fact
  // about a page, so an eligible page stays eligible and is merely deferred.
  it("defers every page while the pool is paused, even a never-healed one", () => {
    expect(attempt({ poolPausedUntil: NOW + 60_000 })).toBe(false);
  });

  it("resumes the moment the pause lapses", () => {
    expect(attempt({ poolPausedUntil: NOW })).toBe(true);
    expect(attempt({ poolPausedUntil: NOW - 1 })).toBe(true);
  });

  it("keeps a page parked after the pause lapses if its own cooldown still runs", () => {
    expect(
      attempt({ poolPausedUntil: NOW - 1, lastHealAttemptAt: new Date(NOW - HOUR) }),
    ).toBe(false);
  });
});

describe("pool heal pause", () => {
  beforeEach(resetHealPause);

  it("starts unpaused", () => {
    expect(healPausedUntil()).toBe(0);
  });

  it("pauses for the requested window", () => {
    pauseHealsAfterPoolFailure(NOW, 5 * 60_000);
    expect(healPausedUntil()).toBe(NOW + 5 * 60_000);
  });

  // A burst produces many failures in a row; the last one must not pull the
  // recovery time back towards the present.
  it("never shortens a pause that already reaches further out", () => {
    pauseHealsAfterPoolFailure(NOW, 10 * 60_000);
    pauseHealsAfterPoolFailure(NOW, 60_000);
    expect(healPausedUntil()).toBe(NOW + 10 * 60_000);
  });

  it("extends a pause when a later failure reaches further out", () => {
    pauseHealsAfterPoolFailure(NOW, 60_000);
    pauseHealsAfterPoolFailure(NOW + 30_000, 60_000);
    expect(healPausedUntil()).toBe(NOW + 90_000);
  });
});
