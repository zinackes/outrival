# Règles scraping — Crawlee

S'applique aux fichiers **/*.scraper.ts

## Framework

- TOUJOURS Crawlee — jamais Playwright ou Puppeteer bruts
- PlaywrightCrawler pour sites JS-heavy (pricing, dashboards, SPAs)
- CheerioCrawler pour sites statiques (blogs, changelogs, landing pages simples)
- Doute → PlaywrightCrawler

## Anti-bot

- TOUJOURS passer par ScrapingBee pour les sites avec protection (Cloudflare, etc.)
- Ne jamais hardcoder de User-Agent — laisser Crawlee gérer le fingerprinting
- Délai minimum entre requêtes : 2s sur le même domaine
- maxConcurrency: 1 par domaine par défaut

## Snapshots

- TOUJOURS extraire le texte ET le screenshot dans le même crawl
- TOUJOURS uploader sur R2 AVANT d'écrire en DB
- Clé R2 obligatoire : snapshots/{competitor_id}/{source_type}/{ISO_timestamp}.html
- En cas d'échec upload R2 → ne pas écrire en DB, retourner erreur

## Structure d'un scraper

Chaque scraper exporte une fonction : scrape(competitorUrl: string): Promise<ScraperResult>
ScraperResult : { html: string, text: string, screenshotBuffer: Buffer, metadata: Record<string, unknown> }

## Retry

- maxRequestRetries: 3 dans la config Crawlee
- En cas d'échec définitif → loguer avec competitor_id + source_type + error
- Ne jamais silently swallow les erreurs de scraping