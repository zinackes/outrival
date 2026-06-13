import { afterEach, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";

// decideDispatch (patch-26) is the org-scoped moderation gate every freshly
// generated signal passes through. Its layered ordering — critical bypass →
// relevance threshold → channel-by-severity → quiet hours → frequency cap — and
// its midnight-wrapping / timezone-aware quiet-hours math are subtle and security
// /correctness relevant (they decide whether a user is emailed at all). These
// lock that behavior with the DB mocked and the clock frozen.

// Mutable fake-DB state, set per test before calling decideDispatch.
const state: { prefs: unknown; threshold: unknown; emailCount: number } = {
  prefs: null,
  threshold: null,
  emailCount: 0,
};

// Table objects are only fed to drizzle's eq/gte to build a WHERE our fake db
// discards, so an inert stub is enough.
const tableStub = new Proxy({}, { get: () => ({}) });

mock.module("@outrival/db", () => ({
  db: {
    query: {
      orgNotificationPreferences: { findFirst: async () => state.prefs },
      orgRelevanceThreshold: { findFirst: async () => state.threshold },
    },
    select: () => ({ from: () => ({ where: async () => [{ value: state.emailCount }] }) }),
  },
  orgNotificationPreferences: tableStub,
  orgRelevanceThreshold: tableStub,
  alerts: tableStub,
}));

type ChannelMode =
  | "email_immediate"
  | "digest_daily"
  | "digest_weekly"
  | "in_app_only"
  | "muted";

function prefsRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    channelCritical: "email_immediate" as ChannelMode,
    channelHigh: "email_immediate" as ChannelMode,
    channelMedium: "digest_weekly" as ChannelMode,
    channelLow: "in_app_only" as ChannelMode,
    timezone: "UTC",
    quietHoursStart: 22,
    quietHoursEnd: 8,
    weekendOff: false,
    dailyEmailCap: 10,
    ...over,
  };
}

let decideDispatch: typeof import("../src/lib/notification-dispatcher").decideDispatch;

// 2026-06-10 is a Wednesday → never tripped by weekendOff.
const QUIET = new Date("2026-06-10T23:00:00Z"); // 23:00, inside 22→8
const NOON = new Date("2026-06-10T12:00:00Z"); // outside quiet hours
const WRAP_QUIET = new Date("2026-06-10T03:00:00Z"); // pre-dawn, still inside 22→8

beforeAll(async () => {
  process.env.NOTIFICATION_CRITICAL_BYPASS = "true";
  process.env.RELEVANCE_THRESHOLD_DEFAULT = "0.5";
  ({ decideDispatch } = await import("../src/lib/notification-dispatcher"));
});

afterEach(() => {
  state.prefs = null;
  state.threshold = null;
  state.emailCount = 0;
  setSystemTime(); // unfreeze
});

describe("decideDispatch — critical bypass", () => {
  test("critical ignores threshold AND quiet hours, routes to its channel", async () => {
    setSystemTime(QUIET);
    state.prefs = prefsRow();
    const d = await decideDispatch("org-1", {
      severity: "critical",
      relevanceScore: 0.01, // below threshold
      competitorId: "c1",
    });
    expect(d).toEqual({ send: true, channel: "email_immediate" });
  });
});

describe("decideDispatch — layer 1 relevance threshold", () => {
  test("score below threshold is dropped (muted)", async () => {
    state.prefs = prefsRow();
    const d = await decideDispatch("org-1", {
      severity: "high",
      relevanceScore: 0.2,
      competitorId: "c1",
    });
    expect(d).toEqual({ send: false, channel: "muted", filteredReason: "below_threshold" });
  });

  test("null score skips the threshold entirely", async () => {
    state.prefs = prefsRow({ channelMedium: "digest_weekly" });
    const d = await decideDispatch("org-1", {
      severity: "medium",
      relevanceScore: null,
      competitorId: "c1",
    });
    expect(d.send).toBe(true);
    expect(d.channel).toBe("digest_weekly");
  });

  test("per-org threshold row overrides the env default", async () => {
    state.prefs = prefsRow();
    state.threshold = { threshold: 0.8 };
    const d = await decideDispatch("org-1", {
      severity: "high",
      relevanceScore: 0.7, // would pass the 0.5 default, fails the 0.8 override
      competitorId: "c1",
    });
    expect(d.filteredReason).toBe("below_threshold");
  });
});

describe("decideDispatch — layer 2 channel by severity", () => {
  test("a muted severity channel drops the signal", async () => {
    state.prefs = prefsRow({ channelLow: "muted" });
    const d = await decideDispatch("org-1", { severity: "low", competitorId: "c1" });
    expect(d).toEqual({ send: false, channel: "muted", filteredReason: "channel_muted" });
  });

  test("a non-immediate channel returns directly, skipping quiet hours + cap", async () => {
    setSystemTime(QUIET);
    state.prefs = prefsRow({ channelHigh: "digest_daily", dailyEmailCap: 0 });
    state.emailCount = 999; // over cap, but cap only gates immediate email
    const d = await decideDispatch("org-1", { severity: "high", competitorId: "c1" });
    expect(d).toEqual({ send: true, channel: "digest_daily" });
  });
});

describe("decideDispatch — layer 3 quiet hours (immediate email only)", () => {
  test("defers to the daily digest during quiet hours", async () => {
    setSystemTime(QUIET);
    state.prefs = prefsRow({ channelHigh: "email_immediate" });
    const d = await decideDispatch("org-1", { severity: "high", competitorId: "c1" });
    expect(d.channel).toBe("digest_daily");
    expect(d.filteredReason).toBe("quiet_hours");
    expect(d.scheduledFor).toBeInstanceOf(Date);
  });

  test("quiet window wraps midnight (03:00 is still quiet for 22→8)", async () => {
    setSystemTime(WRAP_QUIET);
    state.prefs = prefsRow({ channelHigh: "email_immediate" });
    const d = await decideDispatch("org-1", { severity: "high", competitorId: "c1" });
    expect(d.filteredReason).toBe("quiet_hours");
  });

  test("quiet hours are evaluated in the org timezone, not UTC", async () => {
    setSystemTime(NOON); // 12:00 UTC → NOT quiet in UTC
    // UTC+14 → local 02:00 next day → quiet. Same instant, different verdict.
    state.prefs = prefsRow({ timezone: "Pacific/Kiritimati", channelHigh: "email_immediate" });
    const d = await decideDispatch("org-1", { severity: "high", competitorId: "c1" });
    expect(d.filteredReason).toBe("quiet_hours");
  });
});

describe("decideDispatch — layer 4 frequency cap (immediate email only)", () => {
  test("at/over the daily cap defers to the daily digest", async () => {
    setSystemTime(NOON);
    state.prefs = prefsRow({ channelHigh: "email_immediate", dailyEmailCap: 2 });
    state.emailCount = 2;
    const d = await decideDispatch("org-1", { severity: "high", competitorId: "c1" });
    expect(d.channel).toBe("digest_daily");
    expect(d.filteredReason).toBe("frequency_cap");
  });
});

describe("decideDispatch — clean immediate path", () => {
  test("under cap, outside quiet hours, above threshold → email_immediate", async () => {
    setSystemTime(NOON);
    state.prefs = prefsRow({ channelHigh: "email_immediate", dailyEmailCap: 10 });
    state.emailCount = 1;
    const d = await decideDispatch("org-1", {
      severity: "high",
      relevanceScore: 0.9,
      competitorId: "c1",
    });
    expect(d).toEqual({ send: true, channel: "email_immediate" });
  });

  test("falls back to default prefs when the org has no preferences row", async () => {
    setSystemTime(NOON);
    state.prefs = null; // → defaultPrefs(): high = digest_daily
    const d = await decideDispatch("org-1", { severity: "high", competitorId: "c1" });
    expect(d).toEqual({ send: true, channel: "digest_daily" });
  });
});
