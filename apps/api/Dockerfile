# @outrival/api — Hono on Bun (Bun.serve via `export default { port, fetch }`).
# Build from the MONOREPO ROOT:
#   docker build -f apps/api/Dockerfile .
# In Coolify: Build Pack = Dockerfile, Base Directory = / , Dockerfile = apps/api/Dockerfile.
# See docs/deployment.md.
# syntax=docker/dockerfile:1

# --- build: deps cached on the lockfile (pnpm fetch), API-only install, then a
#     self-contained prod-only deploy tree (workspace:* deps resolved in).
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
# The API only uses @outrival/scrapers' discovery/quick-fetch subpaths — never a
# browser. Block the heavy patchright/camoufox/playwright browser downloads.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PATCHRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1
RUN corepack enable
WORKDIR /repo
# Copy package.json too (not just the lockfile) so corepack reads its
# `packageManager` field and pins the SAME pnpm for fetch as for install —
# a version drift fills the store in one format and reinstalls in another,
# which triggers an interactive purge prompt that hangs the non-TTY build.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @outrival/api...
# --legacy: pnpm v10 defaults `deploy` to injected workspace deps; we want the
# classic self-contained copy (workspace:* resolved into node_modules).
RUN pnpm --filter=@outrival/api --prod deploy --legacy /app

# --- runtime: Bun serves Hono (Bun.serve binds 0.0.0.0 by default), non-root.
#     bookworm-based slim image (glibc) so sharp's prebuilt binary loads.
FROM oven/bun:1-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=bun:bun /app /app
USER bun
EXPOSE 3001
# DB migrations run from Coolify's Pre-deployment Command, not here:
#   bun run node_modules/@outrival/db/src/migrate.ts
CMD ["bun", "run", "src/index.ts"]
