import { describe, expect, it, beforeEach } from "bun:test";
import {
  shouldAttemptHeal,
  healCooldownMs,
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

// R-E9: a page the generator cannot parse must stop costing two generate_extractor
// calls a day forever. 12 h → 48 h → 7 d, then flat.
describe("healCooldownMs", () => {
  it("gives the base cooldown to a page that has never failed a heal", () => {
    expect(healCooldownMs(COOLDOWN, 0)).toBe(12 * HOUR);
  });

  it("climbs 12 h → 48 h → 7 d over three consecutive failures", () => {
    expect(healCooldownMs(COOLDOWN, 1)).toBe(12 * HOUR);
    expect(healCooldownMs(COOLDOWN, 2)).toBe(48 * HOUR);
    expect(healCooldownMs(COOLDOWN, 3)).toBe(7 * 24 * HOUR);
  });

  it("caps at the last step instead of growing without bound", () => {
    expect(healCooldownMs(COOLDOWN, 9)).toBe(7 * 24 * HOUR);
    expect(healCooldownMs(COOLDOWN, 200)).toBe(7 * 24 * HOUR);
  });

  it("scales with the configured base, so the env knob still works", () => {
    expect(healCooldownMs(HOUR, 2)).toBe(4 * HOUR);
  });

  it("parks a repeatedly-failing page that a flat cooldown would have released", () => {
    const lastHealAttemptAt = new Date(NOW - 24 * HOUR);
    expect(
      shouldAttemptHeal({
        lastHealAttemptAt,
        now: NOW,
        cooldownMs: healCooldownMs(COOLDOWN, 1),
        poolPausedUntil: 0,
      }),
    ).toBe(true);
    expect(
      shouldAttemptHeal({
        lastHealAttemptAt,
        now: NOW,
        cooldownMs: healCooldownMs(COOLDOWN, 3),
        poolPausedUntil: 0,
      }),
    ).toBe(false);
  });
});
