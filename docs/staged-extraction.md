# Patch-30 — Pipeline d'extraction étagé

> Réduire l'IA au strict minimum sans perdre en robustesse. L'IA ne tourne plus
> à **chaque scrape** (chemin chaud) mais seulement à la **création** d'un
> extracteur et à ses **réparations** rares (chemin froid). Socle qui sert aussi
> la couverture mondiale : les sources structurées sont geo/langue-agnostiques.
>
> Source Notion : 🎯 Roadmap → « Patch — Pipeline d'extraction étagé ».
> Branche : `patch-30-staged-extraction` (à brancher depuis `patch-29`).

## 1. Les 5 étages, du moins cher au plus cher

| Étage | Quoi | IA ? | Statut actuel |
|---|---|---|---|
| **Structured-first** | JSON-LD, microdata, OpenGraph, meta, RSS, sitemap | Aucune | ❌ à créer |
| **Cache de parser** | Sélecteurs/règles générés une fois, rejoués déterministe | Aucune au run | ❌ à créer |
| **Validation** | Champs requis non vides, types, enums, prix numérique, date parseable | Aucune | 🟡 Zod existe (sur sortie IA) |
| **Self-heal IA** | Régénère l'extracteur si validation casse ou pas de cache | Oui (rare) | ❌ à créer |
| **IA-juge** | Juge la significativité d'un diff et l'explique | Oui (léger) | ✅ existe (homepage + lexical) |

## 2. Ce qui existe déjà (on ne le refait pas)

- **Court-circuit content-hash + ETag/304** (patch-07) :
  `lib/conditional-fetch.ts` (GET conditionnel → 304 → skip scrape) +
  `lastSnapshot.contentHash === newHash` dans `scrape-monitor.job.ts`. → l'optim
  « page inchangée = zéro travail » est faite.
- **Pruning visible-content** : `lib/extract-content.ts` (`extractContent`) strip
  script/style/svg/noise → texte diff-friendly. Sert au hash + au diff. Mais les
  extractions list (pricing/jobs/reviews) passent par `htmlToText()` (plus
  grossier) + slice 10–12 KB, pas du markdown structuré.
- **IA-juge** : `classifyStructuredChanges` (homepage, 70b, caché) +
  `classifyChange` (lexical) jugent déjà significativité + `reason` + per-change
  significance **sans ré-extraire**. → l'étage IA-juge est fait.
- **Cache de sortie IA** (patch-09) : `withAiCache` (Redis, hash de l'input).
  ⚠️ cache la **sortie** par contenu de page → un prix qui change = cache miss =
  l'IA re-tourne. Ce **n'est pas** le cache de parser visé (qui doit survivre à un
  changement de valeurs). On le garde pour les tâches génératives, pas pour
  remplacer l'étage cache.
- **Parse structuré homepage** : `parsers/homepage-structure.ts`
  (`parseHomepageStructure`) — DOM → sections, déterministe, 0 IA. Bespoke
  homepage, pas le structured-first générique.
- **Observabilité** : `scrape_runs` / `ai_runs` (ClickHouse) + dashboards
  `/admin/scraping` et `/admin/ai`.

## 3. Cibles (où l'IA tourne au chemin chaud aujourd'hui)

`extract-pricing.job.ts`, `extract-jobs.job.ts`, `extract-reviews.job.ts` lancent
`complete(AI_CONFIG.classification, …)` à **chaque change détecté**. Ce sont les
cibles du pipeline complet. La homepage est déjà déterministe (structure + diff +
IA-juge) → elle ne reçoit que l'étage structured-first (additif).

| Source | Structured-first | Cache parser + self-heal | Gain |
|---|---|---|---|
| **pricing** | ✅ schema.org `Product`/`Offer` | ✅ sélecteurs (plan_name, price, currency, period) | **plein** (0 IA après création) |
| **jobs** | ✅ schema.org `JobPosting` | ✅ sélecteurs (title, department, location) | **plein** |
| **reviews** | ✅ `AggregateRating` (score, count) | ✅ partiel (scores seulement) | **partiel** — voir §8 |
| **homepage** | ✅ `Organization`/`Product` (enrichit la structure) | ❌ (déjà déterministe) | enrichissement |
| **self-profile** | ✅ `Organization`/`Product` (seed category/description) | ❌ (freeform) | seed |

## 4. Principe non négociable : « sans tout casser »

Le comportement **actuel reste le plancher**. Les nouveaux étages n'ajoutent que
des **court-circuits** en amont ; si tout échoue, on retombe sur l'extraction IA
directe d'aujourd'hui (`ai_fallback`). Tout le pipeline est derrière un
kill-switch `STAGED_EXTRACTION_ENABLED` — à `false`, on a exactement le code
actuel. Aucune régression possible par construction.

```
structured-first ──hit─▶ done (0 IA)
       │ miss
cache parser (replay) ──hit─▶ done (0 IA)
       │ miss / validation KO
self-heal IA (génère + cache) ──valide─▶ done (1 IA, rare)
       │ toujours KO
ai_fallback = extraction IA directe ACTUELLE  ◀── plancher, jamais de régression
```

## 5. Architecture des packages (respect des dep rules)

| Package | Rôle | Importe |
|---|---|---|
| `@outrival/shared` | `ExtractorSpec` (type + zod), `validateExtraction`, `normalizeDomain` (remonté depuis candidates.ts) | — |
| `@outrival/scrapers` | structured-first parsers (cheerio, purs) + `replayExtractor` + `pruneHtmlForSelectors` | shared |
| `@outrival/ai` | `generateExtractor` (self-heal, LLM → `ExtractorSpec`) | shared |
| `@outrival/workers` | orchestrateur `stagedExtract`, persistance `parser_extractors`, log `extraction_runs` | db, ai, scrapers, shared |

`scrapers` ne peut pas importer `ai` (dep rule) → le replay déterministe vit dans
`scrapers`, la génération IA dans `ai`, le type partagé dans `shared`, le worker
colle. Validation = le worker fait tourner les schémas Zod existants
(`PricingSchema`/`JobsSchema`/`ReviewsSchema` de `@outrival/ai`) sur la sortie du
replay + un helper plausibilité (`@outrival/shared`).

### Format de l'extracteur (`ExtractorSpec`, dans shared)

JSON contraint, **pas de code arbitraire** — uniquement des opérations cheerio
whitelistées (`.find`/`.text`/`.attr` + transforms nommées). Exemple jobs :

```jsonc
{
  "version": 1,
  "list": "ul.openings li.opening",        // conteneur répété (omis = objet unique)
  "fields": {
    "title":      { "selector": "h3.title", "attr": "text" },
    "department": { "selector": ".team",    "attr": "text", "default": "Other" },
    "location":   { "selector": ".loc",     "attr": "text", "nullable": true }
  }
}
```

`transform` autorisés (liste fermée) : `text`, `trim`, `number` (strip devise/
séparateurs → number), `lower`, `attr:<name>`. `replayExtractor(html, spec)`
retourne un objet brut `unknown`, jamais ne throw (miss → `null`).

## 6. Schéma DB

### Postgres — nouvelle table `parser_extractors`

```
parser_extractors  id, domain (normalized hostname), source_type (source_type enum),
                   spec (jsonb — ExtractorSpec), version (int),
                   heal_count (int), consecutive_failures (int),
                   last_validated_at, last_heal_attempt_at,
                   created_at, updated_at
                   — unique (domain, source_type)
```

Clé `(domain, source_type)` (pas competitor) : un extracteur est réutilisable
**cross-org** (même SaaS monitoré par plusieurs orgs = 1 seule génération IA),
survit à la suppression d'un competitor. Fichier
`packages/db/src/schema/parser-extractors.ts`, export dans `schema/index.ts`.

### ClickHouse — nouvelle table `extraction_runs` (la métrique d'arbitrage)

```sql
extraction_runs  competitor_id, source_type, domain,
                 resolution String,     -- structured | cache | heal | ai_fallback
                 extractor_version UInt16,
                 ai_used UInt8,          -- 0 si structured/cache, 1 si heal/ai_fallback
                 recorded_at DateTime DEFAULT now()
                 ENGINE = MergeTree() ORDER BY (recorded_at)
```

Ajoutée dans `packages/db/src/clickhouse-schema.ts` + `ch-setup.ts`. C'est le
**% de scrapes résolus par étage** demandé par le prompt (l'arbitre direct du
coût IA). `ai_runs`/`scrape_runs` ne peuvent pas le capturer : structured/cache
n'émettent aucun appel IA.

## 7. L'orchestrateur `stagedExtract` (workers/lib)

`apps/workers/src/lib/staged-extract.ts` — un seul helper générique appelé par les
3 jobs d'extraction :

```ts
stagedExtract<T>({
  html, url, sourceType, competitorId,
  structuredFn,   // (html,url) => T | null            (scrapers, structured-first)
  schema,         // Zod schema de T                   (ai)
  plausible,      // (T) => boolean                    (shared, anti-extraction-vide)
  aiFallback,     // (text) => Promise<T | null>       (extractPricing/Jobs/Reviews actuels)
}): Promise<{ data: T | null; resolution: Resolution; version: number }>
```

Algorithme :

1. **structured-first** : `structuredFn(html, url)` → valide (`schema` + `plausible`)
   → `resolution: "structured"`, 0 IA.
2. **cache** : `db.query.parserExtractors` sur `(normalizeDomain(url), sourceType)`.
   Présent → `replayExtractor(html, spec)` → valide → `resolution: "cache"`, 0 IA.
3. **self-heal** : si (pas d'extracteur) OU (validation KO) ET pas en cooldown
   (`last_heal_attempt_at` > `EXTRACTOR_HEAL_COOLDOWN_HOURS`) :
   `generateExtractor(sourceType, pruneHtmlForSelectors(html))` (IA, tier smart) →
   `replayExtractor` → valide → upsert (`version+1`, `heal_count+1`) →
   `resolution: "heal"`.
4. **ai_fallback** : sinon `aiFallback(htmlToText(html))` = comportement actuel →
   `resolution: "ai_fallback"`.

Le flag `STAGED_EXTRACTION_ENABLED=false` court-circuite directement à l'étape 4.
Chaque retour logue une ligne `extraction_runs`. Les jobs gardent ensuite leur
post-traitement inchangé (insert ClickHouse pricing/jobs/reviews, summary, etc.).

## 8. Cas reviews (gain partiel — à assumer)

`extract-reviews` produit `average_score` + `review_count` (**extractibles** :
`AggregateRating` JSON-LD / sélecteurs) **mais aussi** `sentiment_score`,
`top_praises`, `top_complaints` qui sont une **synthèse générative**, pas une
extraction — non exprimable en sélecteurs. Donc :

- structured-first / cache couvrent les **scores numériques** (0 IA pour eux).
- la synthèse qualitative **reste un appel IA génératif** (avec `withAiCache`).

→ reviews n'atteint pas « 0 IA » sauf à abandonner praises/complaints. C'est
documenté ici ; pricing & jobs sont les vrais full-wins.

## 9. Tiered models (optimisation empilée, version légère)

Le prompt liste « petit modèle par défaut, gros modèle si page complexe » sous
*Optimisations empilées* (secondaire, pas un étage). Sous le pool patch-22, un
seul modèle est servi par provider (le split 8b/70b est volontairement collapsé)
→ un vrai routage small/large dynamique impose un rework de `pickProvider` +
`Provider`. **Hors scope.**

Version légère retenue, faithful à l'intention sans toucher le pool :
- **self-heal** = `AI_CONFIG.classification` (tier « smart » — raisonnement lourd
  pour produire des sélecteurs robustes).
- routage « complexité de page » dynamique = **différé** (noté, nécessite le
  rework du pool).

> Honnêteté : tant que le pool ne réexpose pas les tiers, ce choix de config n'a
> pas d'effet runtime ; il est correct le jour où le pool supporte les tiers.

## 10. Pruning pour la génération de sélecteurs

`pruneHtmlForSelectors(html)` (scrapers, cheerio) : **garde** le squelette du
`<body>` avec `class`/`id`/`data-*` (le générateur en a besoin pour produire des
sélecteurs) mais **droppe** script/style/svg/noscript/head + tronque les longs
nœuds texte. Différent de `extractContent` (texte seul). Cappé à
`PRUNE_HTML_MAX_CHARS`. ≈ l'optim « ~67 % de tokens en moins » adaptée au cas
sélecteurs.

## 11. Variables d'environnement

```bash
STAGED_EXTRACTION_ENABLED=true     # kill-switch global (false → comportement actuel exact)
EXTRACTOR_HEAL_COOLDOWN_HOURS=12   # anti heal-thrash sur une page durablement cassée
PRUNE_HTML_MAX_CHARS=40000         # cap de l'HTML envoyé au générateur de sélecteurs
```

## 12. Plan d'implémentation (phases, chacune typecheck/build OK)

- **Phase 0 — scaffolding**
  - `ExtractorSpec` (type + zod) + `validateExtraction`/`plausible` + remonter
    `normalizeDomain` dans `@outrival/shared`.
  - table Postgres `parser_extractors` + export schema.
  - table ClickHouse `extraction_runs` (`clickhouse-schema.ts` + `ch-setup.ts`).
  - env flags (`.env.example` + lecture).
  - `db:push` (Railway) — ⚠️ backup d'abord, cf. mémoire patch-28.
  - ✔ vérif : `pnpm typecheck`.
- **Phase 1 — structured-first** (`scrapers/src/structured-data/`)
  - `extractJsonLd`, `extractOpenGraph`, mappers pricing/jobs/reviews-scores.
  - ✔ vérif : `bun test` sur fixtures HTML réelles (JSON-LD présent → objet
    valide ; absent → `null`).
- **Phase 2 — cache replay** (`scrapers/src/parsers/cached-extractor.ts`)
  - `replayExtractor(html, spec)` (transforms whitelistées, jamais de throw).
  - ✔ vérif : `bun test` (spec → extraction ; sélecteur cassé → `null`).
- **Phase 3 — self-heal** (`ai/src/tasks/generate-extractor.ts`)
  - prompt « génère un `ExtractorSpec` JSON pour extraire <champs> de cet HTML »,
    sortie validée par le zod `ExtractorSpec`. `pruneHtmlForSelectors` (scrapers).
  - ✔ vérif : typecheck + 1 run manuel (Trigger MCP) sur une vraie page.
- **Phase 4 — orchestration**
  - `workers/lib/staged-extract.ts` + branchement dans `extract-pricing/jobs/
    reviews.job.ts` derrière le flag, avec `ai_fallback` = appel actuel.
  - log `extraction_runs` à chaque résolution.
  - ✔ vérif : run manuel des 3 jobs ; `extraction_runs` se remplit ; flag off =
    chemin actuel.
- **Phase 5 — homepage structured-first** (additif)
  - enrichir `HomepageStructure` d'un bloc `structuredData` (Organization/Product
    JSON-LD) → nouveau champ de diff dans `diffHomepages`.
  - ✔ vérif : `bun test` homepage-diff.
- **Phase 6 — dashboard `/admin`**
  - panneau « Extraction resolution » (% structured/cache/heal/ai_fallback sur
    fenêtre) dans `admin/scraping` ou `admin/ai` via `clickhouse-safe`.
  - ✔ vérif : page rend, chiffres cohérents.
- **Phase 7 — clôture**
  - MAJ `docs/architecture.md` (pipeline data + tables + env).
  - item Notion → `Done` + lien `📄 docs/staged-extraction.md`.

## 13. Tests (critères de succès, faithful au prompt)

- structured quand JSON-LD présent → **0 appel IA** (assert `resolution=structured`,
  `ai_used=0`).
- cache hit (extracteur présent, valeurs changées) → **0 appel IA**
  (`resolution=cache`) — le test clé qui distingue du cache de sortie IA.
- self-heal déclenché **seulement** sur validation cassée ou cache absent
  (`resolution=heal`, `version` incrémentée).
- court-circuit content-hash/ETag : inchangé, toujours vert.
- flag off → `resolution=ai_fallback` systématique (comportement actuel).

## 14. Risques & mitigations

- **Sélecteurs IA fragiles** → la validation à chaque replay les attrape ;
  self-heal régénère. Cooldown anti-thrash. `ai_fallback` garantit le résultat.
- **`db:push` sur Railway prod** → backup d'abord (mémoire patch-28).
- **Injection via spec** → format clos, transforms whitelistées, aucun eval.
- **JSON-LD mensonger** (valeurs marketing ≠ page) → la validation plausibilité +
  l'IA-juge en aval restent les garde-fous ; on préfère JSON-LD au DOM seulement
  s'il passe la validation.
```
