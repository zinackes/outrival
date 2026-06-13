# @outrival/web — Next.js 16 standalone server. Build from the MONOREPO ROOT:
#   docker build -f apps/web/Dockerfile .
# In Coolify: Build Pack = Dockerfile, Base Directory = / , Dockerfile = apps/web/Dockerfile.
# Next 16 requires Node >= 20.9 — 22 is the current LTS. See docs/deployment.md.
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" NEXT_TELEMETRY_DISABLED=1
# The web build never launches a browser; stop the workspace's playwright /
# patchright / camoufox postinstall from downloading ~400MB of browser binaries.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PATCHRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1
RUN corepack enable
WORKDIR /repo

# --- build: deps cached on the lockfile alone (pnpm fetch), then a WEB-ONLY
#     install (skips api/workers/scrapers deps entirely). NEXT_PUBLIC_* are
#     inlined at build time → they must arrive here as build args.
FROM base AS build
ENV NODE_ENV=production
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY
ARG NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT_WEB
# Copy package.json too (not just the lockfile) so corepack pins the SAME
# pnpm for fetch as for install — a version drift triggers an interactive
# store-purge prompt that hangs the non-TTY build.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @outrival/web...
RUN pnpm --filter @outrival/web build

# --- runtime: minimal standalone server, non-root. HOSTNAME=0.0.0.0 so it binds
#     all interfaces (reachable behind Traefik), not just localhost.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
