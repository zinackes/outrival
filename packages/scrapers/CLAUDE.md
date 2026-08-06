# @outrival/scrapers

Lire `.claude/rules/scraping.md` avant toute modification : c'est la doctrine de
collecte (arrêt sur refus), pas un détail d'implémentation.

## Non négociable

- **Jamais** instancier `chromium`/`firefox` directement dans un scraper de source.
  Passer par `scrapePage()` (cascade, `lib/crawler.ts`) ou `scrapeStatic()` (L0
  fetch) : c'est l'orchestrateur qui tient robots.txt, le rate-limit par eTLD+1,
  l'egress et l'apprentissage de niveau.
- Un refus du site (`blocked_403/503`, `cloudflare_challenge`, `soft_block`,
  `robots_disallowed`) déclenche un arrêt immédiat, zéro escalade, zéro retry. Seul
  `needs_render` justifie de monter L0 vers L1. L2 (egress datacenter) se choisit en
  amont sur le monitor, jamais en réaction à un blocage.
- UA `OutrivalBot` identifiable (`lib/fingerprint.ts`) : pas de rotation, pas
  d'usurpation de navigateur.

## Structure

Un dossier par source : `src/[source]/[source].scraper.ts`, export
`scrape(competitorId, url, options?): Promise<ScrapeOutcome>` (`src/types.ts`).
Remonter `level` et `attempts`, c'est ce qui alimente `monitors.requiresLevel`.

**L'upload R2 se fait hors de ce package** : le scraper retourne le résultat brut,
c'est le job qui uploade puis écrit en DB, jamais l'inverse.

La liste des sources est l'enum `source_type` (`docs/architecture/schema.md`). Ne
pas la dupliquer ici.

## Tests

Colocalisés (`src/**/*.test.ts`) : `pnpm test:local --filter @outrival/scrapers`.
`test:probe` tape le réseau en vrai (`PROBE_LIVE_TESTS=1`) et n'est pas dans la
suite par défaut.

## Ajouter une source

Invoquer le skill `outrival-new-source` : enum, scraper, snapshot, diff, signal.
