# Règles scraping — collection doctrine (arrêt sur refus explicite)

S'applique aux fichiers **/*.scraper.ts. **Doctrine juridique (2026-07-14) : on
collecte ce qui est ouvert, on ne force JAMAIS une porte fermée.** Un blocage = un
refus = arrêt, pas une escalade.

## Framework

- Navigateur = **Playwright** (Chromium vanilla) via
  `packages/scrapers/src/lib/scrape-patchright.ts`. **Aucun spoofing d'automatisation** :
  on rend le JS en s'annonçant (UA OutrivalBot), on ne se déguise pas en humain. Plus
  de Crawlee, plus de fork anti-détection, plus de ScrapingBee/Webshare.
- Ne JAMAIS instancier `chromium`/`firefox` directement dans un scraper de source :
  passer par l'orchestrateur cascade `scrapePage()` (adaptateur `lib/crawler.ts`) ou
  `scrapeStatic()` (L0 fetch) — c'est lui qui gère niveaux, egress, robots + rate-limit.
- Contenu statique SSR (blog/changelog) → `scrapeStatic` (L0 `fetch`, pas de navigateur).
- Sites JS / SPA → `scrapePage` (rend le JS que le site nous sert).

## Cascade 3 niveaux (L0/L1/L2)

```
L0 fetch HTTP direct, sans proxy    → SSR/statique                          (gratuit)
L1 render navigateur, sans proxy    → exige du JS (needs_render)            (gratuit)
L2 render + egress datacenter       → egress choisi EN AMONT (stabilité/géo) (payant fixe)
```

- **Arrêt sur refus** : `blocked_403/503`, `cloudflare_challenge`, `soft_block`,
  `robots_disallowed` = REFUS du site → `markedUnscrapable` immédiat, ZÉRO escalade,
  ZÉRO retry. SEUL `needs_render` justifie l'escalade L0→L1.
- **Pas d'escalade sur blocage vers un proxy.** L2 (datacenter) est un egress choisi
  EN AMONT sur le monitor (`egressTier`), jamais déclenché par un blocage. Le tier IP
  résidentiel et le fallback anti-fingerprint (Camoufox) ont été SUPPRIMÉS
  (contournement caractérisé).
- `robots.txt` respecté AVANT toute requête sur la page (`isAllowed`) ; absent/404 =
  autorisé. Rate-limit par eTLD+1 (défaut 2s, ou `Crawl-delay`).
- Apprentissage par monitor : `monitors.requiresLevel` (0|1|2|null) ; re-probe depuis
  L0 tous les 14 jours pour redescendre.

## Fingerprint / identité

- **UA unique et identifiable** (`OUTRIVAL_UA`, `lib/fingerprint.ts`) qui nomme le bot
  et pointe vers `/bot`. Plus de rotation, plus d'usurpation de navigateur. Les headers
  normaux (Accept, Accept-Language) restent — ce ne sont pas une usurpation.
- Un browser par tier d'egress (direct/datacenter), pool lazy réutilisé par run.

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

- L'orchestrateur ne throw pas par niveau ; l'adaptateur `scrapePage` throw quand la
  cascade est épuisée OU que le site nous refuse (`cascadeOutcome.refused`).
- Un REFUS → `markedUnscrapable` IMMÉDIAT (pas de 3-strike, pas de retry). Un échec
  transitoire (network/timeout/http_error) → 3 échecs consécutifs → `markedUnscrapable`.
- Refus ≠ échec ≠ snapshot vide (anti-échec-silencieux) : un refus remonte
  distinctement (`refused: true`) et marque la source, jamais un diff fantôme.
- En cas d'échec/refus → loguer competitor_id + source_type + failure_reason (+ `refused`)
  dans scrape_runs. Ne jamais silently swallow les erreurs de scraping.
