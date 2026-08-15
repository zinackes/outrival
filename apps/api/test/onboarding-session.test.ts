import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// OUT-225: the "Product name" typed on the profile step is a draft — the wizard
// saves it while the user types so that leaving the screen (the dashboard gate
// bounces straight back to onboarding) no longer loses it. The session row is what
// carries it back on resume.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  installQueueMock();
  const { onboardingSessionRouter } = await import("../src/routes/onboarding-session");
  app = mountApp("/api/onboarding-session", onboardingSessionRouter);
}, 30_000);

beforeEach(() => resetDb());

async function startSession(userId: string, email: string): Promise<string> {
  const res = await app.request(
    "/api/onboarding-session",
    asUser(userId, email, { method: "POST", body: "{}" }),
  );
  expect(res.status).toBe(200);
  const { session } = (await res.json()) as { session: { id: string } };
  return session.id;
}

describe("PATCH /onboarding-session/:id — product name draft", () => {
  test("the typed name is persisted and comes back on resume", async () => {
    const { userId, email } = await seedOrg(testDb);
    const id = await startSession(userId, email);

    const patched = await app.request(
      `/api/onboarding-session/${id}`,
      asUser(userId, email, {
        method: "PATCH",
        body: JSON.stringify({ stage: "profile", productName: "Kestrel" }),
      }),
    );
    expect(patched.status).toBe(200);

    const resumed = await app.request("/api/onboarding-session/current", asUser(userId, email));
    const { session } = (await resumed.json()) as {
      session: { productName: string | null; stage: string };
    };
    expect(session.stage).toBe("profile");
    expect(session.productName).toBe("Kestrel");
  });

  test("null clears the draft, and an untouched draft survives another patch", async () => {
    const { userId, email } = await seedOrg(testDb);
    const id = await startSession(userId, email);
    const patch = (body: unknown) =>
      app.request(
        `/api/onboarding-session/${id}`,
        asUser(userId, email, { method: "PATCH", body: JSON.stringify(body) }),
      );

    await patch({ productName: "Kestrel" });
    // A patch that says nothing about the name must not wipe it: the wizard writes
    // the step and the name from two different effects.
    const kept = await patch({ stage: "discover" });
    expect(((await kept.json()) as { session: { productName: string | null } }).session.productName)
      .toBe("Kestrel");

    const cleared = await patch({ productName: null });
    expect(
      ((await cleared.json()) as { session: { productName: string | null } }).session.productName,
    ).toBeNull();
  });

  test("a name past the field's 80-char cap is rejected", async () => {
    const { userId, email } = await seedOrg(testDb);
    const id = await startSession(userId, email);

    const res = await app.request(
      `/api/onboarding-session/${id}`,
      asUser(userId, email, {
        method: "PATCH",
        body: JSON.stringify({ productName: "x".repeat(81) }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
