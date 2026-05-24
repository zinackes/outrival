# @outrival/scrapers — Sources de données

Stack : Crawlee, ScrapingBee, Exa.ai

## Conventions
- Lire @.claude/skills/crawlee-patterns/SKILL.md avant toute modification
- Un dossier par source : src/[source]/[source].scraper.ts
- Export obligatoire : scrape(competitorId, url): Promise<ScraperResult>
- Upload R2 géré HORS de ce package — retourner le résultat brut, uploader dans le job

## Sources disponibles
homepage | pricing | blog | changelog | jobs | g2_reviews | capterra_reviews

## Ajouter une source
Lire @.claude/skills/add-monitor-source/SKILL.md