import { afterAll } from "bun:test";
import { closeSharedDb } from "./db-harness";

// Preloaded once per `bun test` process (bunfig.toml -> [test] preload). A lifecycle
// hook registered here is run-scoped, not file-scoped: this afterAll fires after the
// LAST test file, which is the only moment the process-wide PGlite may be closed.
afterAll(closeSharedDb);
