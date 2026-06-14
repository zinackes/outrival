// Sentry MUST init before any task code runs. Side-effect import.
import "./src/lib/sentry";
import { defineConfig } from "@trigger.dev/sdk/v3";
import { Sentry } from "./src/lib/sentry";
import { validateWorkerEnv } from "./src/env";
import {
  esbuildPlugin,
  type BuildContext,
  type BuildExtension,
} from "@trigger.dev/build/extensions";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const enableSentrySourceMaps = Boolean(
  sentryAuthToken && sentryOrg && process.env.NODE_ENV === "production",
);

// The patch-20 cascade + battle-card PDF need three browser engines baked into
// the deploy image. The built-in playwright() extension installs only Playwright
// Chromium AND currently fails on a `chromium-headless-shell` grep bug, so we
// drive all installs ourselves into a shared, fixed browsers path:
//   - Playwright Chromium → battle-card PDF (`playwright`)
//   - Patchright Chromium → L1-L3 stealth scrape (`patchright`)
//   - Camoufox (Firefox)  → L4 last resort (`camoufox-js`, best-effort)
// Versions pinned to the workspace's resolved ones so the installed binary
// matches the revision each launcher expects at runtime.
const BROWSERS_PATH = "/ms-playwright";
function installBrowsers(): BuildExtension {
  return {
    name: "install-browsers",
    onBuildComplete(context: BuildContext) {
      if (context.target === "dev") return; // dev uses the local machine's browsers
      context.addLayer({
        id: "browsers",
        image: {
          instructions: [
            "RUN apt-get update && apt-get install -y --no-install-recommends curl unzip && rm -rf /var/lib/apt/lists/*",
            // CLIs used only at build time to download the browser binaries.
            // --ignore-scripts: these packages ship an `only-allow pnpm`
            // preinstall guard that aborts a plain `npm install`; we just need
            // their bins, the browser downloads are triggered explicitly below.
            "RUN npm install -g --ignore-scripts playwright@1.60.0 patchright@1.60.2 camoufox-js@0.10.2",
            `RUN mkdir -p ${BROWSERS_PATH}`,
            // Chromium + its apt deps (battle-card PDF via `playwright`).
            `RUN PLAYWRIGHT_BROWSERS_PATH=${BROWSERS_PATH} playwright install --with-deps chromium`,
            // Firefox runtime libs for Camoufox (a Firefox fork).
            "RUN playwright install-deps firefox",
            // Patchright's Chromium into the same store (L1-L3 stealth).
            `RUN PLAYWRIGHT_BROWSERS_PATH=${BROWSERS_PATH} patchright install chromium`,
            // Camoufox browser binary (L4). Best-effort: a fetch hiccup must not
            // fail the whole deploy — L1-L3 already cover the bulk of blocks.
            "RUN camoufox-js fetch || echo 'camoufox fetch failed — L4 unavailable until fixed'",
          ],
        },
        deploy: {
          env: {
            PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH,
            // Browsers are baked into the image; never re-download at runtime.
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
            PLAYWRIGHT_SKIP_BROWSER_VALIDATION: "1",
          },
          override: true,
        },
      });
    },
  };
}

export default defineConfig({
  project: "proj_syxlttkfpjwsjmkdnmhp",
  runtime: "node",
  logLevel: "log",
  maxDuration: 300,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
  dirs: ["./src/jobs"],
  // Fail fast on misconfigured environment before any job logic runs, so a
  // missing DB/R2 secret surfaces as one clear error instead of a cryptic
  // failure deep inside a task after retries.
  init: async () => {
    validateWorkerEnv();
  },
  // Capture every unhandled task failure into Sentry. Hook runs once the task
  // has exhausted its retries — payload trimmed to id + run id, no PII.
  onFailure: async ({ error, ctx }) => {
    Sentry.captureException(error, {
      tags: { taskId: ctx.task.id, runId: ctx.run.id },
    });
  },
  build: {
    external: [
      "crawlee",
      "playwright",
      "playwright-core",
      // patch-20 cascade: stealth browsers must not be bundled (like playwright
      // above). patchright-core lazy-requires chromium-bidi, camoufox-js
      // lazy-imports bun:sqlite under Bun — both unresolvable at bundle time.
      "patchright",
      "patchright-core",
      "camoufox-js",
      "chromium-bidi",
      "bun:sqlite",
      "jsdom",
      "pino",
      "pino-pretty",
      "thread-stream",
    ],
    extensions: [
      installBrowsers(),
      ...(enableSentrySourceMaps
        ? [
            esbuildPlugin(
              sentryEsbuildPlugin({
                authToken: sentryAuthToken,
                org: sentryOrg,
                project: "outrival-workers",
                sourcemaps: { assets: "./**" },
              }),
              { placement: "last", target: "deploy" },
            ),
          ]
        : []),
    ],
  },
});
