# Règles jobs — pg-boss (`@outrival/queue`)

S'applique aux handlers de `apps/workers/src/core/*.ts` et au registre
`packages/queue/src/jobs.ts`.

> Trigger.dev a été **entièrement retiré** (Phase 7). Plus de `*.job.ts`, plus de
> `trigger.config.ts`, plus de `schedules.task`. Si du vieux code ou une spec
> mentionne encore un wrapper Trigger, c'est périmé.

## Structure obligatoire

- Le corps du job vit dans `apps/workers/src/core/[name].ts`, export nommé
  `run[NameCamelCase]`. Runtime-neutre : aucun import de queue dedans.
- Le job est **déclaré** dans `packages/queue/src/jobs.ts` via `defineJob<Payload>()` :
  nom, type de payload, politique (retry, `expireInSeconds`, concurrence,
  dead-letter). C'est la source unique de vérité, importée par l'API (enqueue seul)
  et par les workers (enqueue + work + cron).
- Le handler est câblé au registre dans `apps/workers/src/queue/worker.ts`.
- Nom de job : kebab-case descriptif (`scrape-monitor`, `generate-weekly-digest`).

## Payloads

- Le type exporté dans `jobs.ts` doit refléter le `InputSchema` zod du handler.
  Une dérive entre les deux est une erreur de parse **au runtime sur le worker**,
  pas à la compilation : les tenir synchrones fait partie du changement.

## Idempotence

- TOUJOURS concevoir les jobs pour être idempotents (relancé = pas de doublon).
- `content_hash` pour détecter qu'un snapshot est déjà identique.
- Contrainte d'unicité côté DB quand elle existe (`signals.change_id`), plutôt
  qu'un check applicatif seul : deux workers peuvent courir en parallèle.

## Erreurs

- Échec **transitoire** → `throw` normal : pg-boss réessaie selon `retryLimit`.
- Échec **métier / terminal** → `throw new NonRetriable("raison")` : complété sans
  retry. C'est la distinction que le wrapper `work` lit par `instanceof`, donc une
  erreur maison qui n'en hérite pas sera réessayée trois fois.
- Ne jamais catch-and-ignore : les épuisements de retry atterrissent dans
  `outrival-dlq` pour inspection.

## Cron

- Les schedules sont posés par le worker `WORKER_ROLE=light`, qui possède seul le
  cron et la maintenance. Ils ne vivent PAS dans le code du handler.
- Le worker `browser` ne fait que consommer (scrapes, platform, PDF).

## Concurrence

- La concurrence est une propriété du job dans `jobs.ts`, pas du handler.
- Max 1 scrape par domaine simultané : c'est le rate-limit par eTLD+1 de la
  cascade qui le tient (`.claude/rules/scraping.md`), pas la queue.
