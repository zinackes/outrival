import { afterAll, mock } from "bun:test";
import { closeSharedDb, sharedDbProxy } from "./db-harness";
// Side effect: registers the single @outrival/shared mock, before any test file loads.
import "./shared-mock";

// Preloaded once per `bun test` process (bunfig.toml -> [test] preload).

// The ONE mock of @outrival/db. Registered here so it is the only registration in the
// process: `db` is a stable proxy onto the shared PGlite instance, so a file that wants
// the test database just calls makeTestDb() and imports @outrival/db normally.
const real = { ...(await import("@outrival/db")) };
mock.module("@outrival/db", () => ({ ...real, db: sharedDbProxy }));

// A lifecycle hook registered here is run-scoped, not file-scoped: this afterAll fires
// after the LAST test file, which is the only moment the process-wide PGlite may be
// closed (an open WASM client makes bun exit 99 on a fully green suite).
afterAll(closeSharedDb);
