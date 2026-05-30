# Patch 01 — Optimisation coût scraping

<context>
Refinement des Phases 2 et 3 pour réduire drastiquement le coût de scraping
à l'échelle, sans casser l'existant. Deux leviers :

1. Direct-first scraping : tenter le scrape direct (gratuit) d'abord,
   fallback ScrapingBee uniquement si blocage détecté. Le résultat est
   "appris" (monitor.requiresProxy) pour ne pas re-tenter le direct sur
   un site connu comme protégé.

2. Fréquence adaptative : un monitor dont le contenu ne change pas ralentit
   automatiquement sa fréquence de scrape. La fréquence choisie par
   l'utilisateur devient un plafond, pas une valeur fixe.

La logique de reprogrammation vit dans scrape-monitor (le monitor se
reprogramme selon son propre résultat). schedule-scraping ne fait plus
que ramasser les monitors dus (nextRunAt <= now).

Lire avant : @packages/scrapers/CLAUDE.md, @.claude/skills/crawlee-patterns/SKILL.md,
@.claude/skills/trigger-jobs/SKILL.md, @findings.md
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 1 — Schéma : champs de monitoring adaptatif

### packages/db/src/schema/monitors.ts
Ajouter :
```typescript
requiresProxy: boolean("requires_proxy").notNull().default(false),
lastChangedAt: timestamp("last_changed_at"),
```

(lastRunAt et nextRunAt existent déjà depuis la Phase 1.)

pnpm db:push --filter @outrival/db

Commit : `feat(db): add requiresProxy and lastChangedAt to monitors`

---

## Étape 2 — Helper de fréquence adaptative (packages/shared)

### packages/shared/src/scheduling.ts
```typescript
import type { MonitorFrequency } from "./constants/sources";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const BASE_INTERVAL_MS: Record = {
  realtime: 1 * HOUR,
  daily: 24 * HOUR,
  weekly: 7 * DAY,
};

// Plafond : même très stable, on ne dépasse jamais ça
const MAX_INTERVAL_MS: Record = {
  realtime: 12 * HOUR,
  daily: 5 * DAY,
  weekly: 30 * DAY,
};

function stalenessMultiplier(daysStable: number): number {
  if (daysStable < 14) return 1;
  if (daysStable < 45) return 2;
  if (daysStable < 90) return 3;
  return 4;
}

/**
 * Calcule le prochain run d'un monitor selon sa fréquence de base
 * et depuis combien de temps son contenu est stable.
 */
export function computeNextRun(
  frequency: MonitorFrequency,
  lastChangedAt: Date | null,
  createdAt: Date,
  now: Date = new Date()
): Date {
  const reference = lastChangedAt ?? createdAt;
  const daysStable = (now.getTime() - reference.getTime()) / DAY;
  const interval = Math.min(
    BASE_INTERVAL_MS[frequency] * stalenessMultiplier(daysStable),
    MAX_INTERVAL_MS[frequency]
  );
  return new Date(now.getTime() + interval);
}
```

Réexporter depuis packages/shared/src/index.ts.

→ vérifier : pnpm typecheck --filter @outrival/shared

Commit : `feat(shared): add adaptive scrape scheduling helper`

---

## Étape 3 — Direct-first dans le crawler (packages/scrapers)

### packages/scrapers/src/lib/crawler.ts
Modifier le helper de scraping pour tenter le direct d'abord, fallback proxy.

```typescript
import type { ScraperResult } from "../types";

export interface ScrapeOptions {
  fullPage?: boolean;
  preferProxy?: boolean; // si true (appris), on saute la tentative directe
}

export interface ScrapeOutcome extends ScraperResult {
  usedProxy: boolean;
}

// Détection heuristique d'un blocage anti-bot
function looksBlocked(html: string, statusCode?: number): boolean {
  if (statusCode === 403 || statusCode === 429 || statusCode === 503) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("cf-challenge") ||
    lower.includes("attention required") ||  // Cloudflare
    lower.includes("access denied") ||
    lower.includes("just a moment") ||        // Cloudflare interstitiel
    html.trim().length < 500                   // page suspectement vide
  );
}

// runCrawler = la logique Crawlee existante, paramétrée par useProxy
// (extraire l'ancienne logique de scrapePage dans une fonction interne runCrawler)

export async function scrapePage(
  url: string,
  opts: ScrapeOptions = {}
): Promise {
  // 1. Site connu comme protégé → proxy direct
  if (opts.preferProxy) {
    const result = await runCrawler(url, { useProxy: true, fullPage: opts.fullPage });
    return { ...result, usedProxy: true };
  }

  // 2. Tentative directe (gratuite)
  try {
    const result = await runCrawler(url, { useProxy: false, fullPage: opts.fullPage });
    if (!looksBlocked(result.html, result.statusCode)) {
      return { ...result, usedProxy: false };
    }
  } catch {
    // échec direct → on tombe sur le fallback proxy
  }

  // 3. Fallback ScrapingBee
  const result = await runCrawler(url, { useProxy: true, fullPage: opts.fullPage });
  return { ...result, usedProxy: true };
}
```

Note : extraire l'ancienne logique Crawlee dans une fonction interne
`runCrawler(url, { useProxy, fullPage })` qui retourne { html, text,
screenshotBuffer, metadata, statusCode }. Ajouter statusCode au ScraperResult
si absent. Les scrapers (homepage, pricing, blog, jobs) continuent d'appeler
scrapePage — pas de changement de leur côté, ils reçoivent juste usedProxy en plus.

Important : les scrapers G2/Capterra peuvent forcer preferProxy: true par
défaut (on sait qu'ils sont protégés) pour éviter une tentative directe inutile.

→ vérifier : scrapePage sur un site non protégé → usedProxy false
→ vérifier : scrapePage sur un site Cloudflare → fallback → usedProxy true

Commit : `feat(scrapers): direct-first scraping with proxy fallback`

---

## Étape 4 — scrape-monitor : apprendre le proxy + reprogrammer

### apps/workers/src/jobs/scrape-monitor.job.ts
Modifications chirurgicales (ne pas réécrire le job entier) :

**a. Passer preferProxy au scrape**
```typescript
const outcome = await scrape(competitorId, url, { preferProxy: monitor.requiresProxy });
```

**b. Apprendre si le site nécessite le proxy**
Après le scrape, si on a dû utiliser le proxy alors que requiresProxy était false :
```typescript
if (outcome.usedProxy && !monitor.requiresProxy) {
  await db.update(monitors)
    .set({ requiresProxy: true })
    .where(eq(monitors.id, monitor.id));
}
```

**c. Mettre à jour lastChangedAt quand un Change est créé**
À l'endroit où le Change est inséré, ajouter :
```typescript
await db.update(monitors)
  .set({ lastChangedAt: new Date() })
  .where(eq(monitors.id, monitor.id));
```

**d. Reprogrammer le monitor à la fin (fréquence adaptative)**
À la toute fin du job (succès comme "pas de changement"), calculer le prochain run :
```typescript
import { computeNextRun } from "@outrival/shared";

const refreshed = await db.query.monitors.findFirst({ where: eq(monitors.id, monitor.id) });
const nextRunAt = computeNextRun(
  refreshed!.frequency,
  refreshed!.lastChangedAt,
  refreshed!.createdAt
);
await db.update(monitors)
  .set({ lastRunAt: new Date(), nextRunAt })
  .where(eq(monitors.id, monitor.id));
```

Surgical : ne toucher qu'à ces 4 points. La logique de diff/change/pipeline IA
existante ne bouge pas.

→ vérifier : un scrape sans changement → nextRunAt s'éloigne progressivement
→ vérifier : un scrape avec changement → lastChangedAt mis à jour, nextRunAt rapproché
→ vérifier : un site protégé scrapé une fois → requiresProxy passe à true

Commit : `feat(workers): adaptive rescheduling and proxy learning in scrape-monitor`

---

## Étape 5 — schedule-scraping : ramasser les monitors dus

### apps/workers/src/jobs/schedule-scraping.job.ts
Simplifier : le job ne calcule plus les intervalles. Il enqueue simplement
les monitors actifs dont nextRunAt est null ou passé.

```typescript
async run(_payload, { ctx }) {
  const now = new Date();
  const due = await db.query.monitors.findMany({
    where: and(
      eq(monitors.isActive, true),
      or(isNull(monitors.nextRunAt), lte(monitors.nextRunAt, now))
    ),
  });

  for (const monitor of due) {
    await scrapeMonitorJob.trigger({ monitorId: monitor.id });
  }

  ctx.log("Enqueued due monitors", { count: due.length });
}
```

Le cron reste horaire (`0 * * * *`). La reprogrammation est gérée par
scrape-monitor (étape 4), donc plus aucune logique d'intervalle ici.

→ vérifier : seuls les monitors dus sont enqueued
→ vérifier : un monitor stable n'est plus scrapé à chaque heure

Commit : `refactor(workers): schedule-scraping only enqueues due monitors`

---

## Étape 6 — Vérification finale

```bash
pnpm build && pnpm typecheck
```

Test :
1. Scraper un site non protégé → usedProxy false (pas de crédit ScrapingBee consommé)
2. Scraper G2 → fallback proxy → requiresProxy appris
3. Scraper plusieurs fois un site stable → observer nextRunAt s'éloigner
   (24h → 48h → 72h selon la stabilité)
4. Provoquer un changement → lastChangedAt mis à jour, nextRunAt revient à la base

Mettre à jour findings.md :
- Taux de fallback proxy observé (% de sites nécessitant ScrapingBee)
- Comportement de la fréquence adaptative
- Faux positifs éventuels de looksBlocked à ajuster
</task>

<constraints>
- Surgical : modifier scrape-monitor uniquement aux 4 points indiqués
- Ne pas casser la logique de diff/change/pipeline IA existante
- looksBlocked doit être conservateur (mieux vaut un fallback proxy de trop
  qu'un faux contenu de blocage stocké comme snapshot valide)
- Les scrapers G2/Capterra forcent preferProxy: true (sites connus protégés)
- La fréquence utilisateur est un PLAFOND — on ralentit, on n'accélère jamais
  au-delà de la fréquence choisie
- Un commit par étape
</constraints>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Site non protégé scrapé sans consommer ScrapingBee (usedProxy false)
✓ Site protégé → fallback proxy + requiresProxy appris à true
✓ Monitor stable → nextRunAt s'éloigne progressivement (backoff)
✓ Changement détecté → lastChangedAt mis à jour + nextRunAt rapproché
✓ schedule-scraping n'enqueue que les monitors dus
✓ La logique de diff/change/IA existante fonctionne toujours
</verification>

<commit>
feat(db): add requiresProxy and lastChangedAt to monitors
feat(shared): add adaptive scrape scheduling helper
feat(scrapers): direct-first scraping with proxy fallback
feat(workers): adaptive rescheduling and proxy learning in scrape-monitor
refactor(workers): schedule-scraping only enqueues due monitors
</commit>