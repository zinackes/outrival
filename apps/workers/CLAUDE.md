# @outrival/workers — Bun + pg-boss

Stack : Bun, pg-boss self-hosted (`@outrival/queue`, `src/queue/`). Trigger.dev a
été entièrement retiré (Phase 7) — plus de `*.job.ts`, plus de `trigger.config.ts`.
Historique de la bascule : `docs/trigger-to-pgboss-migration.md`. Scraping via la
cascade Patchright (`.claude/rules/scraping.md`), plus de Crawlee.

## Conventions
- Lire @.claude/rules/jobs.md avant de créer ou modifier un job
- Le corps du job vit dans src/core/[name].ts, export nommé `run[Name]`, sans
  aucun import de queue : c'est ce qui le garde testable directement
- Le job est déclaré dans packages/queue/src/jobs.ts (nom, payload, retry,
  expire, concurrence) et câblé dans src/queue/worker.ts

## Structure src/
- core/      Corps des jobs, runtime-neutres
- queue/     Worker pg-boss (worker.ts) — WORKER_ROLE=light | browser
- lib/       Utilitaires workers (r2.ts, db.ts, analytics.ts)
