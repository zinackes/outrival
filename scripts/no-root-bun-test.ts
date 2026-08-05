// Preloaded by the root bunfig.toml for `bun test` only.
//
// `bun test` from the repo root discovers EVERY package's test files and loads them
// into one process, which both skips each app's own bunfig (so the shared-PGlite
// teardown never registers) and stacks every module graph in a single heap. Tests are
// per-package here; fail loudly instead of quietly eating the VM.
console.error(
  [
    "bun test was run from the repo root, which loads every package into one process.",
    "",
    "  pnpm test:local                          all packages, one at a time",
    "  pnpm test:local --filter @outrival/api   one package",
    "  pnpm test:fast                           only packages changed vs origin/main",
    "",
    "To run bun directly, do it from the package: cd apps/api && bun test test/",
  ].join("\n"),
);
process.exit(1);
