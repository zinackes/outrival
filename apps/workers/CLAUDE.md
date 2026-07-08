# @outrival/workers — Bun + Trigger.dev v4

Stack : Bun, Trigger.dev v4 (jobs écrits comme `task()`) — exécution en cours de
migration vers pg-boss self-hosted (`@outrival/queue`, `src/queue/`), cf.
`docs/trigger-to-pgboss-migration.md`. Scraping via la cascade Patchright
(`.claude/rules/scraping.md`), plus de Crawlee.

## Conventions
- Lire @.claude/skills/trigger-jobs/SKILL.md avant de créer un job
- Tous les jobs dans src/jobs/ — export nommé obligatoire
- trigger.config.ts doit lister tous les jobs

## Structure src/
- jobs/      Jobs Trigger.dev (*.job.ts)
- lib/       Utilitaires workers (r2.ts, db.ts)