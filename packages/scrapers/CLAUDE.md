# @outrival/scrapers — Sources de données

Stack : Patchright (stealth Chromium) + ProxyScrape (datacenter→residential) +
Camoufox (dernier recours), Exa.ai — cascade 5 niveaux, cf. .claude/rules/scraping.md (patch-20)

## Conventions
- Lire @.claude/skills/crawlee-patterns/SKILL.md avant toute modification
- Un dossier par source : src/[source]/[source].scraper.ts
- Export obligatoire : scrape(competitorId, url): Promise<ScraperResult>
- Upload R2 géré HORS de ce package — retourner le résultat brut, uploader dans le job

## Sources disponibles
homepage | pricing | blog | changelog | jobs | g2_reviews | capterra_reviews

## Ajouter une source
Lire @.claude/skills/add-monitor-source/SKILL.md