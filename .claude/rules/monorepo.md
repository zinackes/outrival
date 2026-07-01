# Règles monorepo — Turborepo + pnpm workspaces

S'applique à tous les fichiers du projet.

## Dépendances

- TOUJOURS : pnpm add [pkg] --filter @outrival/[app]
- JAMAIS : pnpm add [pkg] (sans --filter) sauf devDependencies racine
- Devdeps racine autorisées : typescript, eslint, prettier, turbo, @types/*
- Vérifier si le package existe déjà dans @outrival/shared avant d'en ajouter un nouveau

## Structure des packages

- apps/web       → @outrival/web       (Next.js frontend)
- apps/api       → @outrival/api       (Hono API)
- apps/workers   → @outrival/workers   (Crawlee + Trigger.dev)
- packages/db    → @outrival/db        (Drizzle + schema + migrations)
- packages/ai    → @outrival/ai        (prompts + pipeline Claude/Groq)
- packages/scrapers → @outrival/scrapers (scrapers par source)
- packages/shared   → @outrival/shared  (types, utils, constantes partagés)
- packages/queue    → @outrival/queue   (pg-boss : jobs registry + client, remplace Trigger.dev)

## Imports cross-packages

- web peut importer : @outrival/shared
- api peut importer : @outrival/db, @outrival/ai, @outrival/shared, @outrival/queue (enqueue only)
- workers peut importer : @outrival/db, @outrival/ai, @outrival/scrapers, @outrival/shared, @outrival/queue
- scrapers peut importer : @outrival/shared
- JAMAIS : web → api, api → workers, workers → web, web → queue

## Scripts turbo

- pnpm dev   → turbo dev (tous en parallèle)
- pnpm build → turbo build (respecte le dependency graph)
- Ajouter les nouveaux scripts dans turbo.json avant de les utiliser