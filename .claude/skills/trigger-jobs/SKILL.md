---
name: trigger-jobs
description: >
  DEPRECATED. Trigger.dev a été entièrement retiré d'Outrival (Phase 7,
  2026-08-02) — les jobs tournent sur pg-boss self-hosted (`@outrival/queue`).
  Lire ce fichier si du vieux code, une spec ou un runbook mentionnent encore un
  wrapper Trigger, pour savoir où ça a migré.
allowed-tools: [Read, Write, Edit]
---

# trigger-jobs — DÉPRÉCIÉ

**Ne pas suivre l'ancien contenu de ce skill.** Il décrivait comment écrire un
`task()` Trigger.dev v3 dans `apps/workers/src/jobs/*.job.ts`. Ces fichiers, le
`trigger.config.ts` et le SDK ont tous été supprimés, et le package n'est plus une
dépendance. Un job écrit selon l'ancien modèle ne compilerait pas et ne tournerait
jamais.

## Où c'est passé

| Avant (Trigger.dev) | Maintenant (pg-boss) |
|---|---|
| `apps/workers/src/jobs/[name].job.ts` (`task({...})`) | `apps/workers/src/core/[name].ts`, export `run[Name]`, runtime-neutre |
| `trigger.config.ts` liste les jobs | `packages/queue/src/jobs.ts` (`defineJob<Payload>()`) : nom, payload, retry, expire, concurrence |
| `schedules.task({ cron })` | Cron posé par le worker `WORKER_ROLE=light`, qui le possède seul |
| `maxAttempts: 3` | `retryLimit` (= nombre de RETRIES, donc N-1) |
| `maxDuration` | `expireInSeconds` |
| `queue({ concurrencyLimit })` | `concurrency` sur le job |
| `throw new AbortTaskRunError(...)` | `throw new NonRetriable(...)` depuis `@outrival/queue` |
| Dashboard Trigger Cloud | Tables pg-boss + dead-letter `outrival-dlq` |

## Quoi lire à la place

`.claude/rules/jobs.md` — les règles à jour (structure, payloads, idempotence,
erreurs, cron, concurrence). Historique de la bascule et raisons du choix :
`docs/trigger-to-pgboss-migration.md`.

## Pourquoi le retrait a été fait

Après le cutover, les wrappers Trigger devaient survivre une semaine comme
rollback. Ils ont survécu plus longtemps, et comme leurs schedules sont
**déclaratifs** (le cron vit dans le code déployé, donc ni le dashboard ni l'API ne
peuvent le désactiver), Trigger Cloud a continué à exécuter toute la flotte en
parallèle de pg-boss, sur une version du 13/07. Chaque concurrent était scrapé deux
fois par deux flottes qui ne partagent pas le rate-limiter par domaine, l'IA et Exa
étaient payées deux fois, et du code périmé écrivait en base. Supprimer les wrappers
et redéployer est la seule façon de retirer un schedule déclaratif.
