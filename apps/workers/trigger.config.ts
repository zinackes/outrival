// Sentry MUST init before any task code runs. Side-effect import.
import "./src/lib/sentry";
import { defineConfig } from "@trigger.dev/sdk/v3";
import { Sentry } from "./src/lib/sentry";
import { playwright } from "@trigger.dev/build/extensions/playwright";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const enableSentrySourceMaps = Boolean(
  sentryAuthToken && sentryOrg && process.env.NODE_ENV === "production",
);

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
      "jsdom",
      "pino",
      "pino-pretty",
      "thread-stream",
    ],
    extensions: [
      playwright({ browsers: ["chromium"], headless: true }),
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
