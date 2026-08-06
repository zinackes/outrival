# @outrival/workers

Bun + pg-boss. Lire `.claude/rules/jobs.md` avant de créer ou modifier un job.

## Anatomie d'un job : trois fichiers, jamais un seul

1. Le **corps** vit dans `src/core/[name].ts`, export nommé `run[NameCamelCase]`,
   **runtime-neutre** : aucun import de `@outrival/queue` dedans. C'est ce qui le
   rend testable en appel direct.
2. La **déclaration** vit dans `packages/queue/src/jobs.ts` : nom, payload, retry,
   expire, concurrence, dead-letter.
3. Le **câblage** vit dans `src/queue/worker.ts`.

Changer l'`InputSchema` zod d'un handler oblige à changer le type de payload de
`jobs.ts` dans le même commit : voir `packages/queue/CLAUDE.md` pour pourquoi la
compilation ne rattrape pas la dérive.

## Rôles de worker

`WORKER_ROLE=light` (1 Go) : crons, IA, extractions, alertes. Il **possède seul le
cron et la maintenance**. `WORKER_ROLE=browser` (4 Go, shm 1 Go) : scrapes, platform
detection, PDF. Un job routé au mauvais rôle n'est jamais consommé, sans erreur.

## Logging IA

Les tâches de `@outrival/ai` sont pures : c'est ici qu'on les enveloppe. `loggedAi()`
(`src/lib/analytics.ts`) écrit `ai_runs` et **rethrow**, contrairement au reste
d'`analytics.ts` qui est best-effort et n'échoue jamais bruyamment. Un appel IA posé
hors de `loggedAi` n'apparaît nulle part dans les coûts.

## Tests

`pnpm test:local --filter @outrival/workers`. `test/db-harness.ts` : une seule
PGlite par process, truncate à l'acquire. Ne pas en instancier une par fichier, la
suite est passée de 3,35 Go à 1,09 Go grâce à ça. Le teardown est préchargé par
`apps/workers/bunfig.toml` ; sans lui, bun sort en 99 sur une suite verte.
