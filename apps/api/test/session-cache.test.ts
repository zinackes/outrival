import { describe, expect, test } from "bun:test";
import {
  evictUserSessions,
  readCachedSession,
  writeCachedSession,
} from "../src/lib/session-cache";

// Audit 2026-09-02, S-08. authMiddleware keeps a resolved session in process for 30s
// to spare three DB round-trips per request. Two properties were wrong: the map was
// keyed by the raw session token (a heap dump handed over 5000 replayable cookies),
// and revocation had no way to reach it — suspending an account or signing out left
// the holder with up to 30 more seconds of authenticated access.
//
// The digest keying is structural (`keyOf` is the only path into `cache.set`, and the
// map is deliberately not exported), so what is locked here is the eviction contract:
// dropping one user's sessions must drop all of them and nobody else's.

type CacheValue = Parameters<typeof writeCachedSession>[1];

/** Only `session.user.id` is read by the code under test. */
function resolved(userId: string): CacheValue {
  return { session: { user: { id: userId } }, orgId: "org-1" } as unknown as CacheValue;
}

let seq = 0;
function store(userId: string): string {
  const token = `tok-${++seq}`;
  writeCachedSession(token, resolved(userId));
  return token;
}

describe("session cache", () => {
  test("1. a written session reads back", () => {
    const token = store("u-read");
    expect(readCachedSession(token)?.session.user.id).toBe("u-read");
  });

  test("2. an unknown token is a miss, not an empty hit", () => {
    expect(readCachedSession("tok-never-written")).toBeNull();
  });

  test("3. regression: revoking a user drops EVERY session they hold", () => {
    // Two devices, two tokens. Evicting one of them would leave the other logged in,
    // which is the bug: a suspended abuser just keeps using their other tab.
    const laptop = store("u-multi");
    const phone = store("u-multi");

    evictUserSessions("u-multi");

    expect(readCachedSession(laptop)).toBeNull();
    expect(readCachedSession(phone)).toBeNull();
  });

  test("4. eviction is scoped to one user: the neighbours stay signed in", () => {
    const mine = store("u-target");
    const theirs = store("u-bystander");

    evictUserSessions("u-target");

    expect(readCachedSession(mine)).toBeNull();
    expect(readCachedSession(theirs)?.session.user.id).toBe("u-bystander");
  });

  test("5. evicting a user with nothing cached is a no-op", () => {
    const other = store("u-keep");
    evictUserSessions("u-absent");
    expect(readCachedSession(other)).not.toBeNull();
  });
});
