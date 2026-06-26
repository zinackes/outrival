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
  // Build memory: the prod build runs on an 8 GB shared VPS (web + api + Coolify
  // + the build container). Next's default parallel static-page generation
  // (cores-1 workers, 8 pages in flight each) OOM-killed the build mid-prerender
  // ("Generating static pages using 3 workers" → kernel SIGKILL at 46/62). Force
  // a single worker and lower per-worker concurrency so the prerender phase fits
  // in RAM — a slower build that completes. See docs/deployment.md.
  experimental: {
    cpus: 1,
    staticGenerationMinPagesPerWorker: 1000,
    staticGenerationMaxConcurrency: 4,
  },
  // Baseline security headers on every response. Deliberately NO full
  // Content-Security-Policy (default-src/script-src): the app loads Turnstile,
  // Stripe, PostHog and Sentry from third-party origins plus Next's own inline
  // bootstrap — a hand-rolled CSP would break them and needs its own audit. We
  // ship only zero-risk hardening here; `frame-ancestors 'none'` doubles the
  // anti-clickjacking guard for modern browsers without affecting page loads.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
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
