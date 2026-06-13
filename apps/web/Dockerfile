# @outrival/web — Next.js 16 standalone. Built from the MONOREPO ROOT:
#   docker build -f apps/web/Dockerfile .
# In Coolify: Build Pack = Dockerfile, Base Directory = / (repo root),
# Dockerfile Location = apps/web/Dockerfile.
# syntax=docker/dockerfile:1

# --- build: NEXT_PUBLIC_* are inlined at BUILD time → they MUST be passed as
#     build args here, not just as runtime env, or the client bundle ships with
#     localhost defaults. See docs/deployment.md for the full list.
FROM node:22-slim AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY
ARG NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS
# Optional — enables Sentry source-map upload during the build (no-op if unset).
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT_WEB
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@outrival/web build

# --- runtime: the standalone server traces its own minimal node_modules. In a
#     monorepo the entrypoint is .next/standalone/apps/web/server.js, with static
#     assets and public/ copied alongside.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
