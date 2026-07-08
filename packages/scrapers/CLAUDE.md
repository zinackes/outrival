# @outrival/scrapers — Sources de données

Stack : Patchright (stealth Chromium) + ProxyScrape (datacenter→residential) +
Camoufox (dernier recours), Exa.ai — cascade 5 niveaux, cf. .claude/rules/scraping.md (patch-20)

## Conventions
- Lire .claude/rules/scraping.md avant toute modification (cascade Patchright,
  pas de Crawlee)
- Un dossier par source : src/[source]/[source].scraper.ts
- Export obligatoire : scrape(competitorId, url): Promise<ScraperResult>
- Upload R2 géré HORS de ce package — retourner le résultat brut, uploader dans le job

## Sources disponibles
Cf. l'enum `source_type` dans docs/architecture.md (source de vérité — la liste
évolue, ne pas la dupliquer ici).

## Ajouter une source
Lire @.claude/skills/add-monitor-source/SKILL.md