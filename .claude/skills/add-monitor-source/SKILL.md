---
name: add-monitor-source
description: >
  Utiliser quand on ajoute une nouvelle source de monitoring à Outrival
  (ex: linkedin, twitter, appstore). Checklist complète de bout en bout.
allowed-tools: [Read, Write, Edit, Bash]
---

# Ajouter une nouvelle source de monitoring

## Checklist complète (dans l'ordre)

### 1. Scraper — packages/scrapers/src/[source]/

- [ ] Créer [source].scraper.ts avec export `scrape(competitorId, url): Promise<ScraperResult>`
- [ ] Lire @.claude/skills/crawlee-patterns/SKILL.md pour le pattern exact
- [ ] Tester manuellement avec une URL réelle

### 2. Schema DB — packages/db/src/schema/

- [ ] Ajouter source_type au enum monitors.source_type si nouveau type
- [ ] Créer migration : pnpm db:push
- [ ] Vérifier que les relations sont correctes

### 3. Job Trigger.dev — apps/workers/src/jobs/

- [ ] Créer scrape-[source].job.ts (ou utiliser scrape-monitor.job.ts générique)
- [ ] Lire @.claude/skills/trigger-jobs/SKILL.md pour le pattern
- [ ] Ajouter le job dans trigger.config.ts
- [ ] Tester avec pnpm trigger:dev

### 4. Route API — apps/api/src/routes/

- [ ] Ajouter endpoint pour activer le monitor de cette source
- [ ] Valider les inputs avec Zod

### 5. UI — apps/web/src/

- [ ] Ajouter la source dans la liste de sélection de monitors
- [ ] Afficher les données spécifiques à cette source dans la fiche concurrent
- [ ] Icône Tabler appropriée

### 6. Types partagés — packages/shared/src/types/

- [ ] Exporter le type de résultat spécifique à cette source si nécessaire

### 7. Tests

- [ ] Test unitaire du scraper avec HTML mocké
- [ ] pnpm typecheck → 0 erreurs
- [ ] pnpm build → 0 erreurs

### 8. Documentation

- [ ] Mettre à jour findings.md avec les particularités de cette source
- [ ] Mettre à jour task_plan.md