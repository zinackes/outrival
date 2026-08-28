# @outrival/scrapers

Doctrine de collecte (2026-07-14) : on collecte ce qui est ouvert, on ne force
JAMAIS une porte fermée. Un blocage est un refus, donc un arrêt, jamais une
escalade.

## Non négociable

- **Jamais** instancier `chromium`/`firefox` directement dans un scraper de source.
  Passer par `scrapePage()` (cascade, `lib/crawler.ts`) ou `scrapeStatic()` (L0
  fetch) : c'est l'orchestrateur qui tient robots.txt, le rate-limit par eTLD+1,
  l'egress et l'apprentissage de niveau. Navigateur = Playwright Chromium vanilla
  (`lib/scrape-patchright.ts`), aucun spoofing d'automatisation.
- Un refus du site (`blocked_403/503`, `cloudflare_challenge`, `soft_block`,
  `robots_disallowed`) déclenche `markedUnscrapable` immédiat, zéro escalade, zéro
  retry. Seul `needs_render` justifie de monter L0 vers L1. L2 (egress datacenter)
  se choisit en amont sur le monitor (`egressTier`), jamais en réaction à un
  blocage. Tier résidentiel et fallback anti-fingerprint : SUPPRIMÉS.
- UA `OutrivalBot` identifiable (`lib/fingerprint.ts`) : pas de rotation, pas
  d'usurpation de navigateur. Un browser par tier d'egress, pool lazy par run.

## Cascade

```
L0 fetch HTTP direct    -> SSR/statique (blog, changelog)      gratuit
L1 render navigateur    -> exige du JS (needs_render)          gratuit
L2 render + datacenter  -> egress choisi EN AMONT              payant fixe
```

`robots.txt` vérifié AVANT toute requête (`isAllowed`) ; absent ou 404 = autorisé.
Rate-limit par eTLD+1 (2s par défaut, ou `Crawl-delay`). Apprentissage par monitor
via `monitors.requiresLevel` (0|1|2|null), re-probe depuis L0 tous les 14 jours.

## Structure

Un dossier par source : `src/[source]/[source].scraper.ts`, export
`scrape(competitorId, url, options?): Promise<ScrapeOutcome>` (`src/types.ts`) qui
rend `{ html, text, screenshotBuffer, metadata, statusCode?, etag?, lastModified?,
level, attempts }`. Remonter `level` et `attempts`, c'est ce qui alimente
`monitors.requiresLevel`.

Texte ET screenshot extraits dans la même passe (`capturePage`).

**L'upload R2 se fait hors de ce package** : le scraper retourne le résultat brut,
c'est le job qui uploade puis écrit en DB, jamais l'inverse. Clé obligatoire
`snapshots/{competitor_id}/{source_type}/{ISO_timestamp}.html` ; upload R2 en échec
= pas d'écriture DB.

La liste des sources est l'enum `source_type` (`docs/architecture/schema.md`). Ne
pas la dupliquer ici.

## Erreurs

L'orchestrateur ne throw pas par niveau ; `scrapePage` throw quand la cascade est
épuisée OU que le site refuse (`cascadeOutcome.refused`). Refus, échec et snapshot
vide restent trois choses distinctes : un refus remonte `refused: true` et marque la
source, jamais un diff fantôme. Échec transitoire (network, timeout, http_error) :
3 échecs consécutifs avant `markedUnscrapable`. Toujours loguer competitor_id,
source_type, failure_reason et `refused` dans `scrape_runs`.

## Tests

Colocalisés (`src/**/*.test.ts`) : `pnpm test:local --filter @outrival/scrapers`.
`test:probe` tape le réseau en vrai (`PROBE_LIVE_TESTS=1`) et n'est pas dans la
suite par défaut.

## Ajouter une source

Invoquer le skill `outrival-new-source` : enum, scraper, snapshot, diff, signal.
