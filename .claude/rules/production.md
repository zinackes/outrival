# Règles production — Outrival

Prod = OVH VPS + Coolify, jobs sur Trigger.dev Cloud, DB Neon.
Voir `docs/deployment.md` (matrice d'env, pré-requis, smoke test).

## 1. Modèle de branches
- `main` = SOURCE DE PROD (Coolify auto-déploie `main`). Toujours releasable :
  typecheck + test + build verts avant tout merge.
- `staging` = miroir pré-prod (cible — pas encore provisionné) : sa propre branche
  Neon + env Trigger staging + clés Stripe test. On teste là avant `main`.
- Les features partent de `main`, jamais d'une branche `patch-*`. Merge par PR.
  Fini l'empilement patch-sur-patch.

## 2. Actions outward-facing = TOUJOURS confirmation explicite
L'assistant ne lance JAMAIS sans go explicite de l'utilisateur : `git push origin
main`/`staging`, (re)deploy Coolify, `trigger deploy`, migration sur un env
partagé, changement Stripe/webhook. Il propose, l'utilisateur valide.

## 3. DB & migrations
- Versionnées uniquement (`db:generate` → `db:migrate`). `db:push` INTERDIT sur un
  env partagé (drift + colonnes manquantes en prod).
- Nouvelle migration : appliquée sur staging (branche Neon) d'abord ; backup prod
  avant toute migration non triviale.
- Prod = pré-deploy `db:migrate:deploy` (migrator runtime), jamais drizzle-kit
  dans l'image prod.

## 4. Secrets & env
- Jamais de secret committé. Nouvelle var → `.env.example` + `docs/architecture.md`.
- `NEXT_PUBLIC_*` = build-time → passés en build args Docker (pas runtime).
- Isolation par env : clés distinctes Stripe (test/live), branche Neon, env
  Trigger, bucket R2.
- Les env boot-bloquants en prod (Upstash via `env.ts` superRefine) le restent —
  ne pas relâcher.

## 5. Invariants prod à ne pas régresser
- Cookie cross-sous-domaine (`AUTH_COOKIE_DOMAIN`) + liste d'origines CORS
  (`apps/api/src/index.ts`) = toute origine web prod incluse.
- `/health` reste sans auth (sonde Coolify).
- Routes SSE gardent `X-Accel-Buffering: no`.
- Cascade scraping : binaires browser (patchright/camoufox) vérifiés sur le
  runtime jobs après chaque `trigger deploy`.

## 6. Avant un go-live
Dérouler le smoke test de `docs/deployment.md` (login OTP → dashboard, OAuth,
SSE, scrape → signal, webhook Stripe, Sentry/uptime).
