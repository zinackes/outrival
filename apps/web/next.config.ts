import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

// Monorepo root (two levels up from apps/web). Standalone file-tracing must be
// rooted here, not at apps/web, or the pnpm workspace deps (incl. the hoisted
// node_modules and @outrival/shared) are missed and the runtime image breaks.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const nextConfig: NextConfig = {
  // Self-contained server build for Docker/Coolify: emits .next/standalone with
  // only the traced runtime deps (incl. the transpiled @outrival/shared), so the
  // image ships without the full monorepo node_modules. See docs/deployment.md.
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@outrival/shared"],
  async redirects() {
    return [
      // patch-19: /login and /register were consolidated into the single /auth page.
      { source: "/login", destination: "/auth", permanent: true },
      { source: "/register", destination: "/auth", permanent: true },
      // patch-29: main sidebar renames (My product → Products, Detections → Discovery).
      {
        source: "/dashboard/my-product",
        destination: "/dashboard/products",
        permanent: true,
      },
      {
        source: "/dashboard/candidates",
        destination: "/dashboard/discovery",
        permanent: true,
      },
      // patch-29: settings General was renamed from Workspace.
      {
        source: "/dashboard/settings/workspace",
        destination: "/dashboard/settings/general",
        permanent: true,
      },
      // patch-29: the standalone Alerts page (outbound channel config) folded into
      // notification settings; the urgent feed now lives in the Signals "Alerts" tab.
      {
        source: "/dashboard/alerts",
        destination: "/dashboard/settings/notifications",
        permanent: true,
      },
    ];
  },
};

export default process.env.NODE_ENV === "development"
  ? nextConfig
  : withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT_WEB ?? "outrival-web",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      disableLogger: true,
      hideSourceMaps: true,
    });
