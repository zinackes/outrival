# Production

Prod = OVH VPS + Coolify (web, api) et Netcup (workers, queue pg-boss), DB Neon.
Détail dans `docs/deployment.md` (matrice d'env, pré-requis, smoke test).

## 1. Branches

`main` = SOURCE DE PROD, Coolify auto-déploie : toujours releasable, typecheck +
test + build verts avant tout merge. `staging` = miroir pré-prod (cible, pas encore
provisionné) avec sa branche Neon, sa queue et ses clés Stripe test. Les features
partent de `main`, jamais d'une branche `patch-*`, et se mergent par PR.

## 2. Actions outward-facing : go explicite obligatoire

Jamais sans validation de l'utilisateur : `git push origin main`/`staging`, deploy
Coolify, restart d'un worker, migration sur un env partagé, changement
Stripe/webhook. L'assistant propose, l'utilisateur valide.

La frontière est le déploiement, pas la visibilité. Se font donc directement, sans
gate : push d'une branche de travail (`OUT-NN`, `feat/*`, `fix/*`, `chore/*`,
`zinacke/*`) y compris `--force-with-lease` sur la sienne ; ouvrir, mettre à jour ou
commenter une PR vers `main` ; les écritures Linear du workflow ticket.

Un « go » couvre toute la chaîne de publication qui suit (push, PR, Linear), pas
seulement la commande proposée juste avant.

## 3. DB et migrations

Versionnées uniquement (`db:generate` puis `db:migrate`) ; `db:push` INTERDIT sur un
env partagé. Nouvelle migration : staging d'abord, backup prod avant toute migration
non triviale. Prod = pré-deploy `db:migrate:deploy` (migrator runtime), jamais
drizzle-kit dans l'image prod.

## 4. Secrets et env

Jamais de secret committé. Nouvelle var : `.env.example` +
`docs/architecture/env.md`. Les `NEXT_PUBLIC_*` sont build-time, donc passés en
build args Docker. Isolation par env : clés Stripe distinctes, branche Neon,
`QUEUE_DATABASE_URL` dédiée, bucket R2. Les env boot-bloquants en prod (Upstash via
le superRefine de `env.ts`) le restent.

## 5. Invariants à ne pas régresser

Cookie cross-sous-domaine (`AUTH_COOKIE_DOMAIN`) et liste d'origines CORS
(`apps/api/src/index.ts`) couvrant toute origine web prod. `/health` sans auth
(sonde Coolify). Routes SSE avec `X-Accel-Buffering: no`. Binaire Playwright
Chromium vérifié sur le worker `WORKER_ROLE=browser` après chaque deploy.

Avant un go-live : dérouler le smoke test de `docs/deployment.md`.
