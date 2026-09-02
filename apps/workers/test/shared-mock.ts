import { mock } from "bun:test";

// The ONE mock of @outrival/shared for the whole test process.
//
// Three files stub a different corner of it and each used to register its own
// `{ ...real, mine }`. mock.module is process-global and cannot be unregistered, so
// whichever file bun loaded last put the real function back for the other two — a
// failure that only appeared once file order changed.
//
// Registered here instead, from the preloaded test/setup.ts. The stubbable exports are
// permanent wrapper functions that read the override at CALL time: bun snapshots a
// mocked module's namespace when it links it, so swapping the property later (or
// proxying the namespace) is not observed by an importer, but swapping what the
// wrapper delegates to is.
//
// `real` is a plain snapshot taken BEFORE the mock lands: mock.module mutates the
// exports on the live namespace object in place, so delegating to that object later
// would resolve back to the wrapper and recurse forever.
const real: Record<string, unknown> = { ...(await import("@outrival/shared")) };

/** Exports a test file may stand in for. Add here to stub something new. */
const STUBBABLE = ["sendWebhook", "uploadToR2", "getFromR2", "deleteManyFromR2"] as const;
type Stubbable = (typeof STUBBABLE)[number];

type AnyFn = (...args: never[]) => unknown;
let overrides: Partial<Record<Stubbable, AnyFn>> = {};

mock.module("@outrival/shared", () => ({
  ...real,
  ...Object.fromEntries(
    STUBBABLE.map((name) => [
      name,
      (...args: never[]) => (overrides[name] ?? (real[name] as AnyFn))(...args),
    ]),
  ),
}));

/** Stand in for the named exports. Call from beforeEach so the file owns them while it runs. */
export function setSharedOverrides(next: Partial<Record<Stubbable, AnyFn>>): void {
  overrides = next;
}

/** Hand @outrival/shared back untouched. Call from afterAll. */
export function clearSharedOverrides(): void {
  overrides = {};
}
