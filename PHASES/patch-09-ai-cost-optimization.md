# Patch 09 — Optimisation coût IA

<context>
Suite logique du focus coûts. Patch-01 et patch-07 ont attaqué le scraping
(le coût n°1). Patch-09 attaque le coût n°2 : l'IA.

Trois leviers immédiats, simples et universels :
1. Cache Redis sur les appels IA déterministes (classify, analyze, score)
2. Filtrage en amont — skip l'IA quand le diff est trivial
3. Routing modèle — llama-3.1-8b pour classification, 70b pour les générations

Combinés, on divise le coût IA par ~4. À <500 utilisateurs on reste dans le
free tier Groq, à 1000 users on passe d'un coût de ~$120/mois à ~$30/mois.

Ce qui N'EST PAS dans ce patch (volontairement reporté, voir Notion Roadmap) :
- Batching de classification (Later, refactor moyen — quand volumes mesurés)
- Audit prompts + prompt caching natif Groq (Later, opportuniste)
- Self-host modèle classification (Backlog, post-validation produit)
- Évaluer providers IA alternatifs Cloudflare Workers AI (Backlog)

Principe : ne pas pre-optimiser. Les 3 leviers immédiats sont universels et
faciles. Le reste demande des données réelles pour valider le ROI.

Lire avant : @CLAUDE.md, @docs/architecture.md, @packages/ai/CLAUDE.md,
@.claude/skills/ai-pipeline/SKILL.md, @findings.md, @PHASES/patch-02-admin-ops.md
(pour le logging ai_runs)
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Env

Pas de nouvelle dépendance (Redis client déjà via Upstash, crypto natif Node).

Ajouter dans `.env.local` :
```
AI_CACHE_TTL_CLASSIFY_DAYS=7
AI_CACHE_TTL_ANALYZE_DAYS=30
AI_CACHE_TTL_SCORE_DAYS=30
```

→ vérifier : variables lues côté ai

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Cache IA partagé (packages/shared)

### packages/shared/src/cache/ai-cache.ts
```typescript
import { createHash } from "node:crypto";
import { redis } from "../redis"; // client Upstash existant

export interface AiCacheOptions {
  namespace: string;          // "classify" | "analyze" | "score-overlap" | ...
  ttlSeconds: number;
}

function makeCacheKey(namespace: string, input: string): string {
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 24);
  return `ai:${namespace}:${hash}`;
}

/**
 * Wrap un appel IA déterministe avec un cache Redis.
 * Si le hash de l'input est en cache, retourne le résultat caché sans appeler fn().
 * Si le cache n'est pas joignable, dégrade silencieusement (appelle fn() directement).
 */
export async function withAiCache(
  input: string,
  options: AiCacheOptions,
  fn: () => Promise,
): Promise {
  const key = makeCacheKey(options.namespace, input);

  // Tentative de lecture cache
  try {
    const hit = await redis.get(key);
    if (hit) {
      return { value: JSON.parse(hit) as T, cached: true };
    }
  } catch {
    // Redis indisponible — dégrader silencieusement
  }

  // Cache miss → appel réel
  const value = await fn();

  // Écriture cache (non-bloquante, échec silencieux)
  try {
    await redis.setex(key, options.ttlSeconds, JSON.stringify(value));
  } catch {
    // ignorer
  }

  return { value, cached: false };
}
```

Réexporter depuis packages/shared/src/index.ts.

→ vérifier : pnpm typecheck --filter @outrival/shared
→ vérifier : appel répété avec même input → 2e fois cached: true
→ vérifier : Redis coupé → l'appel passe quand même (sans cache)

Commit : `feat(shared): add ai cache helper with redis and graceful fallback`

---

## Étape 2 — Filtre de significativité (packages/ai)

### packages/ai/src/filters/significance.ts
Helper pur qui décide si un diff vaut la peine d'être classifié par l'IA.

```typescript
export interface DiffInput {
  added: string;
  removed: string;
}

export interface SignificanceResult {
  worth: boolean;
  reason?: string;
}

/**
 * Heuristiques pour skipper les diffs triviaux avant d'appeler l'IA.
 * Économise ~40-60% des appels classifyChange.
 */
export function evaluateSignificance(diff: DiffInput): SignificanceResult {
  const combined = `${diff.added}\n${diff.removed}`;
  const trimmed = combined.replace(/\s+/g, "");

  // 1. Trop court globalement
  if (trimmed.length < 50) {
    return { worth: false, reason: "too_short" };
  }

  // 2. Caractères significatifs (hors chiffres, dates, ponctuation, espaces)
  const significant = combined.replace(/[\s\d:/.\-,;()[\]{}_+@#'"]/g, "").length;
  if (significant < 30) {
    return { worth: false, reason: "no_significant_text" };
  }

  // 3. Uniquement des hashes / UUIDs / IDs longs
  if (/^[a-f0-9-]{20,}$/i.test(trimmed)) {
    return { worth: false, reason: "looks_like_hash" };
  }

  // 4. Uniquement timestamps / dates / heures
  if (/^[\d\s\-:T/.,Z+]+$/.test(combined)) {
    return { worth: false, reason: "timestamps_only" };
  }

  // 5. Pattern CSRF / nonce / random token (mots aléatoires sans espaces)
  if (/^[A-Za-z0-9+/=]{30,}$/.test(trimmed) && !combined.includes(" ")) {
    return { worth: false, reason: "looks_like_token" };
  }

  return { worth: true };
}
```

→ vérifier : tests unitaires sur cas représentatifs (diff vide, diff de dates,
  diff de hash, vrai changement texte)

Commit : `feat(ai): add significance filter to skip trivial diffs`

---

## Étape 3 — Routing par modèle (packages/ai/src/provider)

### Étendre l'abstraction provider
```typescript
// packages/ai/src/provider/models.ts
export const MODELS = {
  fast: "llama-3.1-8b-instant",        // classification, scoring, dédoublonnage
  smart: "llama-3.3-70b-versatile",    // insights, signals, digest, battle cards
} as const;

export type ModelTier = keyof typeof MODELS;
```

### Modifier complete() pour accepter un tier
```typescript
// packages/ai/src/provider/groq.ts
import { MODELS, type ModelTier } from "./models";

export interface CompleteOptions {
  prompt: string;
  model?: ModelTier;          // défaut: "smart"
  maxTokens?: number;
  temperature?: number;
  // ... autres options existantes
}

export async function complete(opts: CompleteOptions): Promise {
  const groqModel = MODELS[opts.model ?? "smart"];
  // appel Groq avec groqModel
}
```

Surgical : modifier UNIQUEMENT la signature pour accepter le tier. Les appelants
existants sans tier continuent d'utiliser "smart" par défaut → aucune régression.

→ vérifier : un appel avec model: "fast" → log Groq montre llama-3.1-8b-instant
→ vérifier : un appel sans tier → log Groq montre llama-3.3-70b-versatile (inchangé)

Commit : `feat(ai): add model tier routing (fast vs smart)`

---

## Étape 4 — Appliquer cache + routing sur les tâches IA

Modifier chacune des tâches déterministes pour utiliser le cache + le bon tier.

### packages/ai/src/tasks/classify-change.ts
```typescript
import { withAiCache } from "@outrival/shared";

const TTL = Number(process.env.AI_CACHE_TTL_CLASSIFY_DAYS ?? 7) * 86400;

export async function classifyChange(diffText: string): Promise {
  const { value, cached } = await withAiCache(
    diffText,
    { namespace: "classify", ttlSeconds: TTL },
    async () => {
      // logique existante MAIS avec model: "fast"
      const response = await complete({
        prompt: buildClassifyPrompt(diffText),
        model: "fast",   // 8b suffit largement pour de la classification
        // ... reste inchangé
      });
      return safeParseJson(response);
    },
  );
  return { result: value, cached };
}
```

### packages/ai/src/tasks/analyze-product.ts
```typescript
const TTL = Number(process.env.AI_CACHE_TTL_ANALYZE_DAYS ?? 30) * 86400;

export async function analyzeProduct(content: string): Promise {
  const { value, cached } = await withAiCache(
    content,
    { namespace: "analyze", ttlSeconds: TTL },
    async () => {
      // logique existante, garde model: "smart" (raisonnement riche)
      // ...
    },
  );
  return { result: value, cached };
}
```

### packages/ai/src/tasks/score-overlap.ts
```typescript
const TTL = Number(process.env.AI_CACHE_TTL_SCORE_DAYS ?? 30) * 86400;

export async function scoreOverlap(
  profileA: ProductProfile,
  profileB: ProductProfile,
): Promise {
  // Concaténer les deux profils dans une clé canonique
  const cacheInput = JSON.stringify({ a: profileA, b: profileB });
  const { value, cached } = await withAiCache(
    cacheInput,
    { namespace: "score-overlap", ttlSeconds: TTL },
    async () => {
      // logique existante, model: "fast" (scoring simple)
      // ...
    },
  );
  return { result: value, cached };
}
```

NE PAS appliquer le cache à :
- generateSignal (sortie créative, peu déterministe)
- generateDigest (récap personnalisé)
- generateBattleCard (sortie créative)

→ vérifier : 2 appels successifs avec même input → 2e fois cached: true
→ vérifier : classification utilise llama-3.1-8b dans les logs Groq

Commit : `feat(ai): wrap deterministic tasks with cache and fast model`

---

## Étape 5 — Filtrage amont dans scrape-monitor

### apps/workers/src/jobs/scrape-monitor.job.ts
Avant l'appel à classifyChange, vérifier la significativité du diff.

```typescript
import { evaluateSignificance } from "@outrival/ai";

// ... dans la logique de traitement d'un diff détecté
const significance = evaluateSignificance({ added: diff.added, removed: diff.removed });

if (!significance.worth) {
  logger.debug({ monitorId, reason: significance.reason }, "Skipping classification (trivial diff)");
  // logger un ai_run avec status spécial pour traçabilité (réutilise patch-02)
  await logAiRun("classify", "groq", "llama-3.1-8b-instant", "skipped");
  // continuer le flow sans classification — le diff n'engendre pas de signal
  return;
}

const { result: classification, cached } = await classifyChange(diff.text);
await logAiRun(
  "classify",
  "groq",
  "llama-3.1-8b-instant",
  cached ? "cached" : (classification ? "success" : "parse_failed"),
);
```

Étendre logAiRun pour accepter le model dans le status (ou ajouter un champ
si patch-02 a déjà créé la table). Si le status enum n'autorise pas "cached"
et "skipped", étendre les valeurs autorisées.

Si patch-02 n'est PAS encore appliqué : ignorer logAiRun pour l'instant,
ce sera ajouté avec patch-02.

→ vérifier : un diff trivial → pas d'appel Groq, ai_run status "skipped"
→ vérifier : un vrai diff → classification effectuée, ai_run status "success" ou "cached"

Commit : `feat(workers): filter trivial diffs before classification`

---

## Étape 6 — Vérification finale + mesures

```bash
pnpm build && pnpm typecheck
```

Test mesurable :

### A. Cache fonctionne
1. Scraper deux fois le même monitor avec le même contenu
2. 1er passage : classification → ai_run status "success"
3. 2e passage : classification → ai_run status "cached"
4. Aucun appel Groq sur le 2e passage (vérifier les logs)

### B. Filtre fonctionne
1. Provoquer un diff trivial (changement de timestamp uniquement)
2. ai_run status "skipped"
3. Aucun appel Groq

### C. Routing fonctionne
1. Déclencher une classification
2. Vérifier dans les logs Groq que c'est llama-3.1-8b-instant qui est appelé
3. Déclencher une génération de signal → vérifier llama-3.3-70b-versatile

### D. Mesures post-patch (à observer pendant 24h-7j)
Calculer dans le dashboard ops (patch-02) :
- Taux de cache hit sur classify (objectif : 30-50%)
- Taux de skip sur classify (objectif : 30-60%)
- Volume effectif d'appels Groq (objectif : -60 à -80% vs avant)

Documenter les mesures réelles dans findings.md.

task_plan.md : patch-09 → complete.
</task>

<constraints>
- Cache UNIQUEMENT sur les tâches déterministes (classify, analyze, score)
- JAMAIS de cache sur les générations créatives (signal, digest, battle card)
- Redis indisponible → dégrader silencieusement vers appel direct (ne jamais bloquer)
- Routing : "fast" pour classify + score, "smart" par défaut pour le reste
- Filtre evaluateSignificance reste conservateur (mieux skip un cas limite que sur-skip)
- Surgical : étendre les tâches existantes sans changer leur API publique
  (la signature retourne { result, cached } au lieu de juste result)
- Logger les statuts "cached" et "skipped" dans ai_runs (patch-02) si la table existe
- Aucun secret/API key dans les clés de cache (hash du contenu uniquement)
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@packages/ai/CLAUDE.md
@.claude/skills/ai-pipeline/SKILL.md
@.claude/rules/typescript.md
@findings.md
@PHASES/patch-02-admin-ops.md (logging ai_runs)
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Cache hit observable sur classify (2e appel même input = cached)
✓ Filtre skippe les diffs triviaux (timestamps, hashes, trop courts)
✓ Classification utilise llama-3.1-8b-instant (vérifier logs Groq)
✓ Génération signal/digest/battle card utilise llama-3.3-70b-versatile (inchangé)
✓ Redis coupé → l'app continue de fonctionner (juste sans cache)
✓ ai_runs (patch-02) loggue les statuts "cached" et "skipped"
✓ Mesure du gain documenté dans findings.md après 24h-7j d'observation
✓ task_plan.md patch-09 = complete
</verification>

<commit>
feat(shared): add ai cache helper with redis and graceful fallback
feat(ai): add significance filter to skip trivial diffs
feat(ai): add model tier routing (fast vs smart)
feat(ai): wrap deterministic tasks with cache and fast model
feat(workers): filter trivial diffs before classification
</commit>