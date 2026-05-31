# Patch 07 — Optimisations performance scraping

> **STATUT 2026-05-31 : PARTIEL (branche `feat/detection-config`, pas mergé/déployé).**
> - ✅ Étape 1 — Conditional fetch (304) faite, mais **blog + changelog uniquement** (pas via undici : `fetch` natif). `jobs` exclu (risque faux-304 vs détection clôtures).
> - ✅ Étape 3 — gzip R2 faite.
> - ❌ Étapes 0/2/4/5 (dep undici, browser pool, HTTP/2 keep-alive, domain throttle) **abandonnées** : no-op sur le runtime Trigger.dev (machine isolée par run) / aucune cible d'intégration.
> - 📄 Détail fait/skip + à-revisiter : **`findings.md` § "Patch 07"** (source canonique de reprise). Item Notion "Patch 07" = Status `Now`.

<context>
Suite logique du patch-01 (direct-first + fréquence adaptative). Le patch-01
a coupé le COÛT proxy (moins d'appels payants). Ce patch-07 coupe les
RESSOURCES (CPU, RAM, bande passante, stockage R2) pour les scrapes qu'on
fait quand même — qu'ils soient directs ou via proxy.

Cinq leviers, ordonnés du plus impactant au plus subtil :

1. Conditional fetch (ETag / Last-Modified) — skip le download complet quand
   la page n'a pas changé. Gain : 60-90% de bande passante + CPU sur les
   sources stables.

2. Browser context pooling — réutiliser une instance Chromium pour plusieurs
   scrapes au lieu de la relancer à chaque job. Gain : -200 à -400ms par
   scrape + RAM divisée.

3. Compression gzip avant upload R2 — les snapshots HTML compressent à 80-90%.
   Gain : storage R2 ÷ 5-10, et lecture plus rapide.

4. HTTP/2 keep-alive pour les fetchs directs — réutiliser les connexions TCP
   au lieu d'ouvrir une nouvelle socket par requête. Gain : 30-40% de latence
   et moins de connexions ouvertes simultanément.

5. Domain throttling avec connection sharing — sérialiser les scrapes par
   domaine + partager les connexions. Anti-ban gratuit + perf.

Aucune nouvelle dépendance lourde. Tout est natif Node/Bun + Crawlee.

Lire avant : @CLAUDE.md, @docs/architecture.md, @packages/scrapers/CLAUDE.md,
@.claude/skills/crawlee-patterns/SKILL.md, @.claude/skills/trigger-jobs/SKILL.md,
@findings.md (notes des patches précédents)
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances

Une seule, légère :
```bash
# Compression native rapide (utilisé par étape 3)
# zlib est dans Node/Bun nativement → rien à installer
# Mais on ajoute une lib pour HTTP keep-alive propre :
pnpm add undici --filter @outrival/scrapers
```

undici est le client HTTP officiel de Node, avec un pool de connexions natif,
HTTP/2 et keep-alive intégrés. Plus performant que fetch global.

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): add undici for HTTP/2 connection pooling`

---

## Étape 1 — Conditional fetch (ETag + Last-Modified)

LE plus gros gain. Avant chaque scrape, on envoie un HEAD ou un GET conditionnel
qui retourne 304 Not Modified si rien n'a bougé. Pas de download, pas de parsing.

### Schéma : stocker les validateurs HTTP

#### packages/db/src/schema/snapshots.ts
Ajouter à la table snapshots :
```typescript
etag: text("etag"),
lastModified: text("last_modified"),
```

pnpm db:push --filter @outrival/db

### Logique dans le scraper direct

#### packages/scrapers/src/lib/conditional-fetch.ts
```typescript
import { request } from "undici";

export interface ConditionalFetchResult {
  status: number;
  etag?: string;
  lastModified?: string;
  body?: string;
  notModified: boolean;
}

export async function conditionalFetch(
  url: string,
  prevEtag?: string | null,
  prevLastModified?: string | null,
): Promise {
  const headers: Record = {
    "User-Agent": "OutrivalBot/1.0 (+https://outrival.io/bot)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Encoding": "gzip, deflate, br",
  };

  if (prevEtag) headers["If-None-Match"] = prevEtag;
  if (prevLastModified) headers["If-Modified-Since"] = prevLastModified;

  const res = await request(url, { method: "GET", headers });

  if (res.statusCode === 304) {
    return { status: 304, notModified: true };
  }

  const etag = res.headers["etag"] as string | undefined;
  const lastModified = res.headers["last-modified"] as string | undefined;
  const body = await res.body.text();

  return {
    status: res.statusCode,
    etag,
    lastModified,
    body,
    notModified: false,
  };
}
```

### Intégration dans scrape-monitor

Avant de lancer Playwright (cas Cas 1) ou Cheerio (cas statique), tenter d'abord
le conditional fetch :

```typescript
// dans scrape-monitor.job.ts, en début de logique de scrape direct
const lastSnapshot = await db.query.snapshots.findFirst({
  where: eq(snapshots.monitorId, monitor.id),
  orderBy: desc(snapshots.scrapedAt),
});

const conditional = await conditionalFetch(
  url,
  lastSnapshot?.etag,
  lastSnapshot?.lastModified,
);

if (conditional.notModified) {
  // 304 — rien n'a bougé, on skip TOUT le reste
  await db.update(monitors).set({ lastRunAt: new Date() })...
  await logScrapeRun({ status: "no_change", used_proxy: 0, duration_ms: ... });
  // reprogrammer nextRunAt via computeNextRun (patch-01)
  return { changed: false, reason: "etag_304" };
}

// Si on a un body utilisable directement (HTML statique sans JS), l'utiliser
// Sinon passer à Playwright avec preferProxy logic (patch-01)
```

IMPORTANT : ne pas appliquer le conditional fetch sur les sites JS-heavy où
le HTML initial ne reflète pas le contenu (SPA). Pour ces sources, garder
la logique Playwright complète. Heuristique : par `source_type` :
- blog, changelog, jobs (ATS) → conditional fetch OK (souvent statique)
- homepage, pricing → Playwright direct (souvent SPA)
- g2_reviews, capterra_reviews → Playwright + proxy (protégés)

Marquer chaque scraper avec un flag `supportsConditional: boolean`.

→ vérifier : scraper un blog deux fois → la 2e fois retourne 304, scrape_runs
  enregistre `status: "no_change"`, aucun upload R2
→ vérifier : modifier la page → la 3e fois ne retourne PAS 304, scrape complet

Commit : `feat(scrapers): conditional fetch with etag and last-modified`

---

## Étape 2 — Browser context pooling

Plutôt que de lancer Chromium à chaque job (coûteux : ~2s + ~150MB), garder
un pool de browsers persistants dans le worker process et réutiliser des
contexts isolés.

### packages/scrapers/src/lib/browser-pool.ts
```typescript
import { chromium, type Browser, type BrowserContext } from "playwright";

let browser: Browser | null = null;
let inFlight = 0;
const MAX_CONCURRENT_CONTEXTS = 4;

async function getBrowser(): Promise {
  if (!browser) {
    browser = await chromium.launch({
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-gpu",
        "--disable-extensions",
      ],
    });
    // Auto-restart sur crash
    browser.on("disconnected", () => { browser = null; });
  }
  return browser;
}

export async function withBrowserContext(
  fn: (ctx: BrowserContext) => Promise,
  options?: { proxy?: { server: string; username?: string; password?: string } },
): Promise {
  // Backpressure simple
  while (inFlight >= MAX_CONCURRENT_CONTEXTS) {
    await new Promise((r) => setTimeout(r, 100));
  }
  inFlight++;

  try {
    const b = await getBrowser();
    const ctx = await b.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ...",
      viewport: { width: 1280, height: 800 },
      ...(options?.proxy && { proxy: options.proxy }),
    });
    try {
      return await fn(ctx);
    } finally {
      await ctx.close();
    }
  } finally {
    inFlight--;
  }
}

// Cleanup au shutdown du worker (pour Trigger.dev v3, utiliser le hook approprié)
export async function closeBrowserPool(): Promise {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
```

### Refactor des scrapers pour utiliser le pool

Dans packages/scrapers/src/lib/crawler.ts, remplacer le `chromium.launch()` à
chaque appel par `withBrowserContext(async (ctx) => { ... })`.

IMPORTANT : Crawlee gère son propre pool via PlaywrightCrawler. Si tu utilises
PlaywrightCrawler tel quel, il fait déjà du pooling au niveau du crawler.
Le pool maison n'est utile que si tu lances Playwright directement HORS Crawlee
(ex: scrapes one-shot lancés depuis l'API onboarding analyze).

Vérifier : DANS LES JOBS workers utilisant Crawlee, garder Crawlee (il pool
déjà). DANS l'API (analyze-product onboarding) où tu lances Playwright
directement, utiliser withBrowserContext.

→ vérifier : 5 scrapes consécutifs depuis l'API → un seul process Chromium
  visible, pas un par scrape
→ vérifier : un crash de Chromium → le pool se réinitialise au scrape suivant

Commit : `feat(scrapers): persistent browser pool with context isolation`

---

## Étape 3 — Compression gzip avant R2

Les snapshots HTML sont du texte → ils compressent magnifiquement (80-90%).
On gzip avant d'uploader, on stocke gzippé, on décompresse à la lecture.

### packages/shared/src/r2/client.ts
Étendre uploadToR2 et getFromR2 avec un flag `compress`.

```typescript
import { gzipSync, gunzipSync } from "node:zlib";

export async function uploadToR2(
  key: string,
  body: string | Buffer,
  contentType: string,
  options?: { compress?: boolean },
): Promise {
  let finalBody: Buffer = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  const headers: Record = { ContentType: contentType };

  if (options?.compress) {
    finalBody = gzipSync(finalBody);
    headers.ContentEncoding = "gzip";
  }

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: finalBody,
    ContentType: contentType,
    ContentEncoding: options?.compress ? "gzip" : undefined,
  }));
}

export async function getFromR2(key: string): Promise {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const buf = Buffer.from(await res.Body!.transformToByteArray());

  // Décompresser si stocké en gzip
  if (res.ContentEncoding === "gzip") {
    return gunzipSync(buf).toString("utf-8");
  }
  return buf.toString("utf-8");
}
```

### Convention de clé R2

Pour rester lisible et autoriser une migration progressive, garder le nom
de clé inchangé. Le `ContentEncoding` dans les métadonnées R2 indique le
gzip — `getFromR2` détecte automatiquement.

### Compresser systématiquement HTML, jamais les screenshots

```typescript
// Dans scrape-monitor :
await uploadToR2(`${r2Key}.html`, result.html, "text/html", { compress: true });
await uploadToR2(`${r2Key}.png`, result.screenshotBuffer, "image/png");
// PNG est déjà compressé — re-gzip dégraderait + coûterait CPU
```

→ vérifier : un snapshot HTML de 100KB → ~10-20KB sur R2 (vérifier la taille
  dans le dashboard Cloudflare)
→ vérifier : getFromR2 retourne le HTML décompressé correctement

Commit : `feat(shared): gzip compression for HTML snapshots on R2`

---

## Étape 4 — HTTP/2 keep-alive via undici

Pour les fetchs directs (conditional fetch étape 1, mais aussi tout autre
appel HTTP du worker : Exa, ScrapingBee, webhooks), utiliser un Agent undici
partagé qui maintient les connexions ouvertes.

### packages/shared/src/http/agent.ts
```typescript
import { Agent, setGlobalDispatcher } from "undici";

// Agent partagé avec keep-alive agressif et HTTP/2
export const httpAgent = new Agent({
  keepAliveTimeout: 30_000,      // garder la connexion 30s
  keepAliveMaxTimeout: 300_000,  // max 5min
  connections: 50,                // pool de 50 connexions par host
  pipelining: 1,                  // pipelining classique
  allowH2: true,                  // HTTP/2 quand le serveur le supporte
});

// Optionnel : faire de cet agent le dispatcher global
// → toutes les fetch() de l'app utilisent automatiquement le pool
export function installGlobalAgent(): void {
  setGlobalDispatcher(httpAgent);
}
```

### Activer au démarrage des workers
Dans apps/workers/src/index.ts (ou trigger.config.ts si plus pertinent) :
```typescript
import { installGlobalAgent } from "@outrival/shared";
installGlobalAgent();
```

### Pour l'API
Pareil dans apps/api/src/index.ts, AVANT toute init Hono.

ATTENTION : ne PAS activer dans le frontend Next.js — undici est server-only.
Si Next.js server actions font des fetch externes, c'est OK aussi côté server.

→ vérifier : tcpdump ou un simple log → les requêtes vers le même host
  réutilisent la même socket (visible dans les timing : la 1re requête est
  plus lente, les suivantes sont rapides)

Commit : `feat(shared): shared HTTP/2 agent with connection pooling`

---

## Étape 5 — Domain throttling avec connection sharing

Sérialiser les scrapes par domaine (déjà partiellement fait via Trigger.dev
concurrencyKey du patch-01) ET ajouter un délai minimum entre requêtes au même
domaine. Bénéfice : anti-ban gratuit + meilleure utilisation du keep-alive
(les connexions restent chaudes entre requêtes du même domaine).

### packages/shared/src/scheduling/domain-throttle.ts
```typescript
const lastHitByDomain = new Map();
const MIN_DELAY_MS = 2000; // 2s minimum entre 2 requêtes au même domaine

export async function throttleByDomain(url: string): Promise {
  const host = new URL(url).hostname;
  const last = lastHitByDomain.get(host) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS - elapsed));
  }
  lastHitByDomain.set(host, Date.now());
}
```

NOTE : cette Map est in-memory et donc PAR WORKER. Avec plusieurs workers
en parallèle (scale horizontal), elle ne synchronise pas. À ton échelle
actuelle (1 worker), c'est suffisant. Si tu scales à plusieurs workers,
on migrera vers Upstash Redis (clé `throttle:{domain}` avec EXPIRE).

### Intégration dans scrape-monitor
Appeler `throttleByDomain(url)` juste avant le scrape (direct ou via Playwright).

→ vérifier : 5 scrapes du même domaine déclenchés simultanément → ils
  s'exécutent espacés de ≥2s
→ vérifier : 5 scrapes de 5 domaines différents → ils peuvent s'exécuter en
  parallèle sans délai supplémentaire

Commit : `feat(shared): per-domain throttling with in-memory tracking`

---

## Étape 6 — Vérification finale + mesures

```bash
pnpm build && pnpm typecheck
```

Test mesurable (avant/après le patch) :

### A. Conditional fetch
1. Scraper un blog stable 5 fois de suite
2. Mesurer dans scrape_runs : la 1re = full, les 4 suivantes = `status="no_change"`
3. Vérifier : aucun upload R2 sur les 4 suivantes
4. Bande passante mesurée : 1× HTML complet + 4× ~200 bytes (headers 304)

### B. Compression
1. Scraper une homepage (~150KB HTML)
2. Vérifier la taille du fichier sur R2 → devrait être 15-30KB
3. Lire le snapshot via getFromR2 → HTML décompressé correct

### C. Browser pool
1. Lancer 10 onboarding/analyze consécutifs depuis l'API
2. Vérifier : un seul process Chromium dans `ps aux | grep chromium`
3. Avant patch : 10 process lancés/tués séquentiellement

### D. HTTP keep-alive
1. Logger les timings de 10 fetchs successifs vers le même host
2. Vérifier : 1re = 200-400ms, suivantes = 50-150ms (réutilisation socket)

### E. Throttling
1. Trigger 5 scrapes du même domaine en parallèle
2. Vérifier dans les timestamps scrape_runs : espacés de ≥2s

### Bilan attendu

Sur un workload typique d'Outrival (mix sites stables / actifs) :
- Bande passante : -70 à -85%
- Stockage R2 : -80 à -90%
- Mémoire workers : -40 à -60% (browser pool)
- Latence par scrape : -30 à -50%
- Coût ScrapingBee : pas impacté ici (c'était le patch-01)

Mettre à jour findings.md avec les mesures réelles.

task_plan.md : patch-07 → complete.
</task>

<constraints>
- AUCUN changement de langage — tout reste Node/Bun (Mathys a confirmé pas de Rust/Go)
- Conditional fetch UNIQUEMENT pour les sources statiques (blog, changelog, jobs ATS)
  → ne PAS l'appliquer aux SPAs (homepage, pricing) où le HTML initial est vide
- Le browser pool est utilisé en DEHORS de Crawlee uniquement (Crawlee pool déjà)
- Compression gzip uniquement sur le texte (HTML), JAMAIS sur PNG/JPG
- Le throttling in-memory est OK pour 1 worker. Si scale → Redis (note dans findings)
- undici comme agent partagé côté SERVEUR uniquement (jamais dans web/Next.js client)
- Surgical : étendre les fonctions existantes (uploadToR2, scrape-monitor) sans
  réécrire la logique métier
- Les logs ops (scrape_runs) du patch-02 continuent de fonctionner — vérifier que
  les statuts "no_change" remontent bien
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@packages/scrapers/CLAUDE.md
@.claude/skills/crawlee-patterns/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
@.claude/rules/scraping.md
@findings.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Schema snapshots étendu avec etag + lastModified
✓ Un scrape de page stable retourne 304 et skip l'upload R2
✓ scrape_runs enregistre correctement le status "no_change" sur 304
✓ HTML R2 stocké compressé (vérifier taille + ContentEncoding gzip)
✓ getFromR2 décompresse automatiquement et retourne le HTML d'origine
✓ Browser pool : un seul process Chromium pour N scrapes API consécutifs
✓ HTTP keep-alive observable (timings 2e+ requête < 1re)
✓ Throttling : scrapes même domaine espacés de ≥2s
✓ Aucune régression sur les fonctionnalités existantes (pipeline IA, signals, etc.)
✓ Mesures avant/après documentées dans findings.md
✓ task_plan.md patch-07 = complete
</verification>

<commit>
chore(deps): add undici for HTTP/2 connection pooling
feat(db): add etag and last-modified to snapshots
feat(scrapers): conditional fetch with etag and last-modified
feat(scrapers): persistent browser pool with context isolation
feat(shared): gzip compression for HTML snapshots on R2
feat(shared): shared HTTP/2 agent with connection pooling
feat(shared): per-domain throttling with in-memory tracking
</commit>