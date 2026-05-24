# @outrival/workers — Crawlee + Trigger.dev v3

Stack : Trigger.dev v3, Crawlee, Bun

## Conventions
- Lire @.claude/skills/trigger-jobs/SKILL.md avant de créer un job
- Lire @.claude/skills/crawlee-patterns/SKILL.md avant de créer un scraper
- Tous les jobs dans src/jobs/ — export nommé obligatoire
- trigger.config.ts doit lister tous les jobs

## Structure src/
- jobs/      Jobs Trigger.dev (*.job.ts)
- lib/       Utilitaires workers (r2.ts, db.ts)