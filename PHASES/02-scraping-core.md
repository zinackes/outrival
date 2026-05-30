# Phase 2 — Scraping Core

<context>
La Phase 1 est terminée : monorepo fonctionnel, auth opérationnelle,
schéma DB complet et migré, dashboard shell avec navigation,
Trigger.dev configuré avec un job de test.

Cette phase implémente le cœur du produit : scraper réellement les
concurrents, détecter les changements, et les afficher dans le dashboard.
On introduit Cloudflare R2 pour stocker les snapshots HTML et screenshots.

Lire impérativement avant de commencer :
- @CLAUDE.md
- @docs/architecture.md
- @task_plan.md
- @findings.md
- @.claude/skills/crawlee-patterns/SKILL.md
- @.claude/skills/trigger-jobs/SKILL.md
- @.claude/rules/scraping.md
- @.claude/rules/jobs.md
- @packages/scrapers/CLAUDE.md
</context>

<goal>
À la fin de cette phase :
- Un utilisateur peut ajouter un concurrent via son URL
- Des monitors par défaut (homepage, pricing, blog) sont créés automatiquement
- Le job de scraping capture la source, upload sur R2, détecte les changements
- Les changements détectés sont stockés en DB (table changes)
- Le dashboard affiche un feed "Activité récente" chronologique
- Un bouton "Scraper maintenant" permet de tester manuellement
- pnpm build et pnpm typecheck passent à 0 erreur
</goal>

<task>
Exécuter dans cet ordre exact. Committer après chaque étape numérotée.

## Étape 0 — Dépendances + R2

### Installation
```bash
# packages/scrapers
pnpm add crawlee playwright --filter @outrival/scrapers
pnpm add @outrival/shared --filter @outrival/scrapers

# packages/shared (R2 client + diff)
pnpm add @aws-sdk/client-s3 diff --filter @outrival/shared
pnpm add -D @types/diff --filter @outrival/shared

# apps/workers (utilise les scrapers + déclenche les jobs)
pnpm add @outrival/scrapers --filter @outrival/workers

# apps/api (déclenche les jobs de scraping)
pnpm add @trigger.dev/sdk --filter @outrival/api

# apps/web (formatage des dates dans le feed)
pnpm add date-fns --filter @outrival/web
```

### Installer le navigateur Playwright
```bash
pnpm exec playwright install chromium
```

### Setup Cloudflare R2
Créer un bucket R2 nommé `outrival-snapshots` sur le dashboard Cloudflare.
Générer un token API R2 (Access Key + Secret).
Ajouter dans `.env.local` :
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=outrival-snapshots
```

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): install phase 2 dependencies and configure R2`

---

## Étape 1 — Client R2 (packages/shared)

### packages/shared/src/r2/client.ts
```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

export async function uploadToR2(
  key: string,
  body: string | Buffer,
  contentType: string
): Promise {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

export async function getFromR2(key: string): Promise {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return await res.Body!.transformToString();
}
```

Exporter depuis packages/shared/src/index.ts.

→ vérifier : pnpm typecheck --filter @outrival/shared

Commit : `feat(shared): add R2 client for snapshot storage`

---

## Étape 2 — Diff engine (packages/shared)

### packages/shared/src/diff/index.ts
```typescript
import { createHash } from "crypto";
import { diffLines, type Change as DiffChange } from "diff";

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface TextDiffResult {
  hasChanges: boolean;
  added: string[];
  removed: string[];
  diffText: string;
}

export function computeTextDiff(before: string, after: string): TextDiffResult {
  const changes: DiffChange[] = diffLines(before, after);
  const added: string[] = [];
  const removed: string[] = [];

  for (const part of changes) {
    if (part.added) added.push(part.value.trim());
    if (part.removed) removed.push(part.value.trim());
  }

  const diffText = [
    ...removed.map((l) => `- ${l}`),
    ...added.map((l) => `+ ${l}`),
  ].join("\n");

  return {
    hasChanges: added.length > 0 || removed.length > 0,
    added,
    removed,
    diffText,
  };
}
```

Exporter depuis packages/shared/src/index.ts.

→ vérifier : écrire un test unitaire simple (before vs after) → pnpm test --filter @outrival/shared

Commit : `feat(shared): add diff engine for change detection`

---

## Étape 3 — Scrapers (packages/scrapers)

Suivre le pattern exact de @.claude/skills/crawlee-patterns/SKILL.md.

### packages/scrapers/src/types.ts
```typescript
export interface ScraperResult {
  html: string;
  text: string;
  screenshotBuffer: Buffer;
  metadata: Record;
}
```

### packages/scrapers/src/lib/crawler.ts
Fonction générique de scraping avec PlaywrightCrawler + ScrapingBee optionnel.
Réutilisable par tous les scrapers. Retourne ScraperResult.

### packages/scrapers/src/homepage/homepage.scraper.ts
```typescript
import { scrapePage } from "../lib/crawler";
import type { ScraperResult } from "../types";

export async function scrape(competitorId: string, url: string): Promise {
  return scrapePage(url, { fullPage: true });
}
```

### packages/scrapers/src/pricing/pricing.scraper.ts
Comme homepage mais tente de naviguer vers /pricing si l'URL ne pointe pas déjà dessus.
Heuristique : chercher un lien contenant "pricing" / "tarifs" / "plans" sur la homepage.

### packages/scrapers/src/blog/blog.scraper.ts
Utilise CheerioCrawler (statique, plus rapide).
Tente /blog, /changelog, /news.

### packages/scrapers/src/index.ts
```typescript
import * as homepage from "./homepage/homepage.scraper";
import * as pricing from "./pricing/pricing.scraper";
import * as blog from "./blog/blog.scraper";
import type { SourceType } from "@outrival/shared";

const scrapers = {
  homepage: homepage.scrape,
  pricing: pricing.scrape,
  blog: blog.scrape,
} as const;

export function getScraper(sourceType: SourceType) {
  const scraper = scrapers[sourceType as keyof typeof scrapers];
  if (!scraper) throw new Error(`No scraper for source type: ${sourceType}`);
  return scraper;
}

export type { ScraperResult } from "./types";
```

→ vérifier : pnpm typecheck --filter @outrival/scrapers
→ vérifier : tester manuellement scrape() sur une vraie URL (ex: linear.app)

Commit : `feat(scrapers): add homepage, pricing, blog scrapers with crawlee`

---

## Étape 4 — Job de scraping (apps/workers)

### apps/workers/src/lib/r2.ts
Réexport du client R2 depuis @outrival/shared.

### apps/workers/src/jobs/scrape-monitor.job.ts
Suivre le pattern de @.claude/skills/trigger-jobs/SKILL.md.

Logique complète :
```
1. Récupérer le monitor + competitor depuis la DB (input: monitorId)
   → si introuvable : AbortTaskRunError
2. Obtenir le scraper via getScraper(monitor.sourceType)
3. Exécuter le scraper → ScraperResult
4. Calculer computeHash(result.html)
5. Récupérer le dernier snapshot du monitor
6. Si hash identique au dernier snapshot :
   → update monitor.lastRunAt, retourner { changed: false }
7. Upload sur R2 (html + screenshot) AVANT toute écriture DB
   → clé : snapshots/{competitorId}/{sourceType}/{ISO_timestamp}
8. Créer le snapshot en DB
9. Si un snapshot précédent existe :
   → récupérer son HTML depuis R2
   → computeTextDiff(ancien, nouveau)
   → si hasChanges : créer un Change en DB
10. Update monitor.lastRunAt + nextRunAt
11. context.log du résultat
```

Idempotence : si un snapshot a été créé il y a moins d'1h pour ce monitor,
skip (sauf si déclenchement manuel forcé via payload.force = true).

Ajouter le job dans trigger.config.ts (déjà couvert par dirs: ["./src/jobs"]).

→ vérifier : pnpm trigger:dev → déclencher le job manuellement avec un monitorId réel
→ vérifier : un snapshot apparaît dans R2 + une row dans la table snapshots

Commit : `feat(workers): add scrape-monitor job with R2 upload and diff`

---

## Étape 5 — Routes API (apps/api)

### apps/api/src/lib/trigger.ts
Client pour déclencher les jobs Trigger.dev depuis l'API.
```typescript
import { tasks } from "@trigger.dev/sdk/v3";
export { tasks };
```

### apps/api/src/routes/competitors.ts
Toutes les routes protégées par authMiddleware. Validation Zod.

```
POST   /api/competitors
  body: { name, url, description? }
  → créer le competitor (orgId depuis la session)
  → créer automatiquement 3 monitors par défaut :
    homepage (daily), pricing (daily), blog (weekly)
  → retourner le competitor avec ses monitors

GET    /api/competitors
  → liste des competitors de l'org (non supprimés)

GET    /api/competitors/:id
  → détail + monitors + derniers changements

DELETE /api/competitors/:id
  → soft delete (set deletedAt)
```

### apps/api/src/routes/monitors.ts
```
POST   /api/monitors/:id/run
  → déclencher scrape-monitor.job avec force: true
  → retourner le run id Trigger.dev
```

### apps/api/src/routes/changes.ts
```
GET    /api/changes
  query: ?limit=50&competitorId=optional
  → liste chronologique des changements de l'org
  → join avec competitor (name, url) et monitor (sourceType)
  → ordonné par detectedAt desc
```

Enregistrer les routers dans apps/api/src/index.ts.

→ vérifier : curl POST /api/competitors avec un body valide → competitor + 3 monitors créés
→ vérifier : curl POST /api/monitors/:id/run → job déclenché

Commit : `feat(api): add competitors, monitors, changes routes`

---

## Étape 6 — UI Competitors + Activity feed (apps/web)

### apps/web/src/lib/api.ts
Petit client fetch typé pour appeler l'API (avec credentials: include).

### apps/web/src/app/(dashboard)/competitors/page.tsx
- Liste des concurrents (cards : nom, URL, dernière activité)
- Bouton "Ajouter un concurrent" → ouvre un dialog
- Dialog : input URL + nom + bouton "Ajouter"
  → POST /api/competitors → refresh la liste
- Chaque card cliquable → /dashboard/competitors/:id (page détail simple)
- Sur chaque card : bouton "Scraper maintenant" → POST /api/monitors/:id/run

### apps/web/src/app/(dashboard)/competitors/[id]/page.tsx
Page détail simple :
- Header : nom, URL du concurrent
- Liste des monitors (sourceType, frequency, lastRunAt)
- Bouton "Scraper maintenant" par monitor

### apps/web/src/components/outrival/activity-feed.tsx
Composant feed "Activité récente" :
- Fetch GET /api/changes
- Liste chronologique : 
  ● [il y a X] — [sourceType] — [competitor name]
  + preview du diffText (tronqué)
- Formatage des dates avec date-fns (formatDistanceToNow, locale fr)
- État vide : "Aucun changement détecté pour l'instant"

### apps/web/src/app/(dashboard)/page.tsx
Remplacer le redirect par une vraie page d'accueil dashboard :
- Titre "Activité récente"
- Le composant ActivityFeed

Respecter le design system Outrival (dark, amber #F59E0B, Syne + Inter, shadcn new-york).
Icônes lucide-react uniquement.

→ vérifier : ajouter un concurrent depuis l'UI → 3 monitors créés
→ vérifier : "Scraper maintenant" → après quelques secondes, le changement apparaît dans le feed

Commit : `feat(web): add competitor management and activity feed`

---

## Étape 7 — Vérification finale

```bash
pnpm build      # 0 erreurs
pnpm typecheck  # 0 erreurs
pnpm dev        # tout démarre
pnpm trigger:dev # runner actif
```

Test manuel end-to-end :
1. Login → dashboard
2. Aller sur Competitors → Ajouter un concurrent (ex: https://linear.app)
3. Vérifier que 3 monitors sont créés
4. Cliquer "Scraper maintenant" sur le monitor homepage
5. Vérifier dans R2 qu'un snapshot HTML + PNG existe
6. Vérifier dans Drizzle Studio qu'une row snapshots existe
7. Re-scraper après avoir attendu (ou forcer) → si le site a changé, un Change apparaît
8. Vérifier que l'activité récente s'affiche sur le dashboard

---

## Étape 8 — Mettre à jour le planning

task_plan.md :
- Phase 2 Scraping Core → complete ✓
- Phase 3 Intelligence IA → in_progress (prochaine)

findings.md :
- Particularités Crawlee/Playwright découvertes
- Comportement R2 (clés, content-type)
- Toute heuristique de scraping notée (détection page pricing, etc.)

progress.md : log de session.
</task>

<constraints>
- Ne pas implémenter la classification IA ni les insights (Phase 3)
- Ne pas implémenter le digest (Phase 3)
- Ne scraper que homepage, pricing, blog — pas jobs/reviews (Phase 5)
- Le diff screenshot est hors scope cette phase — texte uniquement
  (stocker le screenshot sur R2 mais ne pas le comparer)
- Ne pas configurer les fréquences automatiques / cron (Phase 3+)
  → le scraping se déclenche uniquement manuellement cette phase
- Respecter strictement : upload R2 AVANT écriture DB
- maxConcurrency 1 par domaine — ne jamais paralléliser sur un même site
- Surgical changes : ne pas toucher au schéma DB de la Phase 1
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@.claude/skills/crawlee-patterns/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
@.claude/rules/scraping.md
@.claude/rules/jobs.md
@packages/scrapers/CLAUDE.md
@packages/db/CLAUDE.md
</references>

<verification>
La phase est terminée quand TOUS ces checks passent :

✓ pnpm build → 0 erreurs
✓ pnpm typecheck → 0 erreurs
✓ Ajout d'un concurrent via l'UI crée le competitor + 3 monitors
✓ "Scraper maintenant" déclenche le job avec succès
✓ Un snapshot HTML + screenshot apparaît dans R2 (clé correcte)
✓ Une row snapshots existe en DB avec le bon contentHash
✓ Un second scrape sur un site modifié crée une row changes
✓ Un second scrape sur un site identique ne crée PAS de change
✓ Le feed "Activité récente" affiche les changements
✓ task_plan.md Phase 2 = complete
</verification>

<commit>
Commits dans l'ordre :
chore(deps): install phase 2 dependencies and configure R2
feat(shared): add R2 client for snapshot storage
feat(shared): add diff engine for change detection
feat(scrapers): add homepage, pricing, blog scrapers with crawlee
feat(workers): add scrape-monitor job with R2 upload and diff
feat(api): add competitors, monitors, changes routes
feat(web): add competitor management and activity feed
</commit>