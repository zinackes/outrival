# @outrival/scrapers — Sources de données

Stack : Playwright (Chromium, rendu honnête — UA OutrivalBot, respect robots.txt) +
ProxyScrape datacenter (egress amont), Exa.ai — cascade 3 niveaux (L0/L1/L2), collection
doctrine (arrêt sur refus). Cf. .claude/rules/scraping.md

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