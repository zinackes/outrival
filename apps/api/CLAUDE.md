# @outrival/api — Hono sur Bun

Stack : Hono, Bun, Better Auth, Drizzle, Zod

## Conventions
- Routes groupées par ressource dans src/routes/[resource].ts
- Validation Zod obligatoire sur tous les inputs (body, params, query)
- Middleware auth sur toutes les routes protégées : app.use('/api/*', authMiddleware)
- Réponses : toujours { data, error } — jamais de throw naked

## Structure src/
- index.ts         Point d'entrée Hono
- routes/          Un fichier par ressource (competitors.ts, monitors.ts, etc.)
- middleware/       auth.ts, ratelimit.ts, cors.ts
- lib/             db.ts, redis.ts, trigger.ts

## Patterns
- GET /api/competitors → liste paginée
- POST /api/competitors → créer (body validé avec Zod)
- GET /api/competitors/:id → détail
- DELETE /api/competitors/:id → soft delete (deleted_at)