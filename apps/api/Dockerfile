# @outrival/api — Hono on Bun. Built from the MONOREPO ROOT:
#   docker build -f apps/api/Dockerfile .
# In Coolify: Build Pack = Dockerfile, Base Directory = / (repo root),
# Dockerfile Location = apps/api/Dockerfile.
# syntax=docker/dockerfile:1

# --- build: install the whole pnpm workspace, then carve out a self-contained,
#     prod-only @outrival/api tree (workspace:* deps resolved in) via pnpm deploy.
FROM node:22-slim AS build
WORKDIR /repo
# The API only uses @outrival/scrapers' discovery/quick-fetch subpaths — it never
# launches a browser. Skip the multi-hundred-MB patchright/playwright browser
# downloads their postinstall would otherwise trigger here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PATCHRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@outrival/api deploy --prod /app

# --- runtime: Bun serves the Hono app (Bun.serve, via `export default { port, fetch }`).
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
# DB migrations are NOT run here — set Coolify's Pre-deployment Command to:
#   bun run node_modules/@outrival/db/src/migrate.ts
# (see docs/deployment.md). The container only serves once migrations succeeded.
CMD ["bun", "run", "src/index.ts"]
