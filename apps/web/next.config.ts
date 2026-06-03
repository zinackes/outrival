import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
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
