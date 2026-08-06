# @outrival/api

Hono sur Bun. L'api **enqueue** via `@outrival/queue` : jamais un handler de job,
jamais le cron. `QUEUE_DATABASE_URL` pointe vers la box workers, pas vers Neon.

## Réponses HTTP

- Toujours `{ data }` ou `{ error }`. Jamais de throw naked qui remonte au client.
- Erreur = `errorBody(code, message, { userAction, retryAfterSeconds })` de
  `src/lib/errors.ts`. `error` reste le **code machine** que le web parse
  (`ApiError.code`, `paywallFromError`) ; `message` est écrit pour un humain, en
  anglais, et ne fuit jamais un stack trace, une erreur SQL ou un chemin de fichier.
- Gating de plan : codes structurés (`plan_limit_competitors`, `plan_locked_feature`,
  `plan_locked_source`, `plan_locked_frequency`, `plan_locked_channel`) que le web
  transforme en `<PaywallDialog>`. Les limites viennent de `PLAN_LIMITS`
  (`@outrival/shared`), jamais d'une constante locale.
- Zod sur **tout** input : body, params, query.

## Invariants prod à ne pas régresser

- `/health` reste sans auth : c'est la sonde Coolify.
- Les routes SSE gardent `X-Accel-Buffering: no`.
- Le mount Better Auth est `/api/auth/*`. Sans l'étoile, les sous-chemins font 404.
- La liste d'origines CORS de `src/index.ts` inclut toute origine web de prod.

## SQL brut

Toute date issue d'un `sql` tag et destinée au client se wrappe en `(col AT TIME
ZONE 'UTC')`, sinon la valeur rendue dépend du TZ du process.

## Tests

`pnpm test:local --filter @outrival/api` (ou `cd apps/api && bun test test/`).

- `test/db-harness.ts` : **une seule** PGlite migrée par process, truncate à
  l'acquire. Ne pas en instancier une par fichier, c'est ce qui faisait passer la
  suite de 1,76 Go à 7,28 Go et faisait swapper la VM.
- `test/app-harness.ts` monte l'app Hono réelle pour les tests de route.
- Le teardown est préchargé par `apps/api/bunfig.toml`. Sans lui, bun sort en 99
  sur une suite verte : un client WASM ouvert est un handle vivant.
