# Règles scraping — cascade Patchright (patch-20)

S'applique aux fichiers **/*.scraper.ts

## Framework

- Navigateur = **Patchright** (drop-in stealth de Playwright, Chromium patché) via
  `packages/scrapers/src/lib/scrape-patchright.ts`. Plus de Crawlee, plus de
  Playwright vanilla, plus de ScrapingBee/Webshare.
- Ne JAMAIS instancier `chromium`/`firefox` directement dans un scraper de source :
  passer par l'orchestrateur cascade `scrapePage()` (adaptateur `lib/crawler.ts`) ou
  `scrapeStatic()` (L0 fetch) — c'est lui qui gère niveaux, proxies et pool.
- Contenu statique SSR (blog/changelog) → `scrapeStatic` (L0 `fetch`, pas de navigateur).
- Sites JS / SPA / protégés → `scrapePage` (cascade complète).

## Cascade 5 niveaux (fingerprint et réputation IP = axes découplés)

```
L0 fetch HTTP direct, sans proxy        → SSR/statique non protégé        (gratuit)
L1 Patchright, sans proxy (IP serveur)  → exige du JS, IP non bloquée     (gratuit)
L2 Patchright + datacenter ProxyScrape  → IP serveur bloquée              (payant fixe)
L3 Patchright + residential ProxyScrape → datacenter bloqué (pay-per-GB)  (payant variable)
L4 Camoufox + residential               → fingerprint Chromium démasqué (rare, dernier recours)
```

- Escalade UNIQUEMENT sur un blocage (`blocked_403/503`, `cloudflare_challenge`,
  `soft_block`, `needs_render`) — jamais sur timeout/network (laisser Trigger retry).
- `needs_render`/`soft_block` → besoin navigateur (L1), pas proxy. Blocage IP/challenge
  → sauter aux proxies (L2→L3). Fingerprint démasqué → L4.
- Apprentissage par monitor : `monitors.requiresLevel` (0|1|2|3|4|null) mémorise le
  niveau ; re-probe depuis L0 tous les 14 jours pour redescendre.
- NE JAMAIS utiliser l'Unlimited Residential ProxyScrape (offre enterprise).

## Fingerprint

- Headers + User-Agent réalistes via `lib/fingerprint.ts` — Patchright/Camoufox
  gèrent le fingerprint profond (CDP leaks, navigator.webdriver, canvas/WebGL).
- Un browser par tier de proxy (datacenter/residential), pool lazy réutilisé par run.

## Snapshots

- TOUJOURS extraire le texte ET le screenshot dans la même passe (capturePage).
- TOUJOURS uploader sur R2 AVANT d'écrire en DB.
- Clé R2 obligatoire : snapshots/{competitor_id}/{source_type}/{ISO_timestamp}.html
- En cas d'échec upload R2 → ne pas écrire en DB, retourner erreur.

## Structure d'un scraper de source

Chaque scraper exporte : `scrape(competitorId, url, options?): Promise<ScrapeOutcome>`
ScrapeOutcome : { html, text, screenshotBuffer, metadata, statusCode?, etag?,
lastModified?, level, attempts }. Le `level` est remonté pour l'apprentissage par monitor.

## Retry / erreurs

- L'orchestrateur ne throw pas par niveau ; l'adaptateur `scrapePage` throw quand
  tous les niveaux activés sont bloqués (message = `failureReason`).
- 3 échecs consécutifs (jusqu'à L4 inclus) → `monitors.markedUnscrapable`.
- En cas d'échec définitif → loguer competitor_id + source_type + failure_reason
  (table Postgres scrape_runs). Ne jamais silently swallow les erreurs de scraping.
