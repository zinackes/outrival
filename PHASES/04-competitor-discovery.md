Voilà le fichier complet et révisé. Remplace tout le contenu de PHASES/04-competitor-discovery.md par ceci :

markdown# Phase 4 — Competitor Discovery

<context>
Les Phases 1 à 3 sont terminées : monorepo, auth, scraping autonome,
pipeline IA (classification → insights → signals), alertes, digest hebdo.

Cette phase implémente LE différenciateur d'Outrival : la découverte
automatique des concurrents. Au lieu de demander à l'utilisateur de
connaître ses concurrents, on les trouve pour lui à partir de l'URL
de son propre produit.

Flow d'onboarding en 5 étapes :
1. L'utilisateur entre l'URL de son produit
2. On analyse son site → profil produit (catégorie, audience, valeur, modèle)
3. On découvre ses concurrents via Exa.ai + scoring d'overlap
4. Il choisit lesquels suivre + préférences de monitoring
5. Premier snapshot immédiat

IMPORTANT — Choix d'architecture : l'analyse et la discovery sont des
opérations courtes (~12s et ~8s) qui ne se font qu'une fois par utilisateur.
Elles se font en APPELS API SYNCHRONES (le frontend affiche un spinner),
PAS via des jobs Trigger.dev. C'est plus simple, gratuit, et évite le coût
de Trigger.dev Realtime. Trigger.dev reste utilisé uniquement pour le
premier scrape déclenché à la fin de l'onboarding.

Lire impérativement avant de commencer :
- @CLAUDE.md
- @docs/architecture.md
- @task_plan.md
- @findings.md
- @.claude/skills/ai-pipeline/SKILL.md
- @.claude/skills/crawlee-patterns/SKILL.md
- @.claude/skills/trigger-jobs/SKILL.md
- @packages/scrapers/CLAUDE.md
- @packages/ai/CLAUDE.md
</context>

<goal>
À la fin de cette phase :
- L'utilisateur entre l'URL de son produit et obtient un profil produit auto-détecté
- Il peut corriger ce profil
- Le système découvre 10-15 concurrents potentiels avec un score d'overlap
- L'utilisateur sélectionne ceux à suivre
- Les concurrents sélectionnés sont créés avec leurs monitors par défaut
- Le premier scraping se déclenche immédiatement
- L'onboarding est marqué comme complété sur l'organisation
- Aucune dépendance à Trigger.dev Realtime — tout en appels API synchrones
- pnpm build et pnpm typecheck passent à 0 erreur
</goal>

<task>
Exécuter dans cet ordre exact. Committer après chaque étape numérotée.

## Étape 0 — Dépendances

```bash
# packages/scrapers (Exa.ai pour la discovery)
pnpm add exa-js --filter @outrival/scrapers
```

Ajouter dans `.env.local` :
```
EXA_API_KEY=...
```

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): install phase 4 discovery dependencies`

---

## Étape 1 — Schéma : profil produit + état onboarding

### packages/db/src/schema/organizations.ts
Ajouter :
```typescript
productUrl: text("product_url"),
productProfile: jsonb("product_profile"), // { category, audience, valueProp, pricingModel }
onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
```

Puis : pnpm db:push --filter @outrival/db

→ vérifier : colonnes ajoutées dans Drizzle Studio

Commit : `feat(db): add product profile and onboarding state to organizations`

---

## Étape 2 — packages/ai : analyse produit + scoring overlap

### packages/ai/src/tasks/analyze-product.ts
```typescript
import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

const ProductProfileSchema = z.object({
  category: z.string(),
  audience: z.string(),
  value_prop: z.string(),
  pricing_model: z.string(),
});

export type ProductProfile = z.infer;

export async function analyzeProduct(homepageText: string): Promise {
  const prompt = `
${homepageText.slice(0, 4000)}



Analyse ce site de produit/SaaS et déduis son profil.
Réponds UNIQUEMENT en JSON valide, sans markdown.


Format :
{
  "category": "ex: SaaS B2B / Productivité",
  "audience": "ex: Startups 1-50 personnes",
  "value_prop": "ex: Automatisation de X en une phrase",
  "pricing_model": "ex: Freemium + abonnement"
}`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true });
  const result = safeParseJson(raw, ProductProfileSchema);
  if (!result.ok) {
    console.error("Product analysis failed:", result.error);
    return null;
  }
  return result.value;
}
```

### packages/ai/src/tasks/score-overlap.ts
Scoring BATCHÉ : un seul appel Groq pour scorer tous les candidats.
```typescript
import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import type { ProductProfile } from "./analyze-product";

const ScoredSchema = z.object({
  scores: z.array(z.object({
    url: z.string(),
    overlap_score: z.number().min(0).max(100),
    reason: z.string(),
  })),
});

export interface Candidate {
  url: string;
  title: string;
  snippet: string;
}

export async function scoreOverlap(
  profile: ProductProfile,
  candidates: Candidate[]
): Promise<Array> {
  const prompt = `
Catégorie : ${profile.category}
Audience : ${profile.audience}
Valeur : ${profile.value_prop}
Modèle : ${profile.pricing_model}



${JSON.stringify(candidates, null, 2)}



Pour chaque candidat, évalue son overlap concurrentiel avec mon produit
(0-100). Un overlap élevé = même audience, même problème résolu, même marché.
Réponds UNIQUEMENT en JSON valide, sans markdown.


Format :
{
  "scores": [
    { "url": "...", "overlap_score": 0-100, "reason": "une phrase" }
  ]
}`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 2048 });
  const result = safeParseJson(raw, ScoredSchema);
  if (!result.ok) {
    console.error("Overlap scoring failed:", result.error);
    return candidates.map((c) => ({ url: c.url, overlapScore: 0, reason: "scoring failed" }));
  }
  return result.value.scores.map((s) => ({
    url: s.url, overlapScore: s.overlap_score, reason: s.reason,
  }));
}
```

Réexporter depuis packages/ai/src/index.ts.

→ vérifier : pnpm typecheck --filter @outrival/ai

Commit : `feat(ai): add product analysis and overlap scoring tasks`

---

## Étape 3 — packages/scrapers : discovery Exa.ai + fetch léger

### packages/scrapers/src/discovery/discover.ts
```typescript
import Exa from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY!);

export interface DiscoveredCompany {
  url: string;
  title: string;
  snippet: string;
}

export async function findSimilarCompanies(
  productUrl: string,
  count = 15
): Promise {
  const hostname = new URL(productUrl).hostname;

  const results = await exa.findSimilarAndContents(productUrl, {
    numResults: count,
    excludeDomains: [hostname],
    text: { maxCharacters: 500 },
  });

  return results.results.map((r) => ({
    url: r.url,
    title: r.title ?? new URL(r.url).hostname,
    snippet: r.text ?? "",
  }));
}
```

### packages/scrapers/src/lib/quick-fetch.ts
Extraction légère sans Playwright (l'API reste légère, pas de browser).
```typescript
export async function quickFetchText(url: string): Promise {
  const endpoint = new URL("https://app.scrapingbee.com/api/v1/");
  endpoint.searchParams.set("api_key", process.env.SCRAPINGBEE_API_KEY!);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("render_js", "false");

  const res = await fetch(endpoint.toString());
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

Réexporter les deux depuis packages/scrapers/src/index.ts.

→ vérifier : tester findSimilarCompanies avec une vraie URL (ex: https://linear.app)
→ vérifier : tester quickFetchText sur une homepage → texte propre extrait

Commit : `feat(scrapers): add Exa.ai discovery and lightweight fetch`

---

## Étape 4 — Routes API synchrones d'onboarding

Pas de jobs Trigger.dev pour l'analyse/discovery — appels synchrones directs.

### apps/api/src/routes/onboarding.ts
Toutes protégées par authMiddleware. Validation Zod sur les inputs.

```
POST /api/onboarding/analyze
  body: { productUrl }
  → quickFetchText(productUrl)              (~5s)
  → analyzeProduct(text)                    (~2s, Groq)
  → si profil null → 422 { error }
  → stocker productUrl + productProfile sur l'org
  → retourner { profile } directement

POST /api/onboarding/discover
  body: { productUrl, profile }
  → findSimilarCompanies(productUrl, 15)    (~2s, Exa)
  → scoreOverlap(profile, candidates)       (~4s, Groq)
  → trier par overlapScore desc
  → retourner { competitors: [{ url, title, snippet, overlapScore, reason }] }
  → ne crée RIEN en DB

PATCH /api/onboarding/profile
  body: { profile }
  → update org.productProfile (correction manuelle)

POST /api/onboarding/complete
  body: {
    selectedCompetitors: [{ name, url, overlapScore }],
    monitoringPrefs: { frequency, sources: ["homepage","pricing","blog"] }
  }
  → pour chaque concurrent sélectionné :
    - créer le competitor (avec overlapScore)
    - créer les monitors selon monitoringPrefs.sources et frequency
    - trigger scrape-monitor.job immédiatement (premier snapshot)
  → set org.onboardingCompleted = true
  → retourner { competitorsCreated }
```

Réutiliser la logique existante de création de competitors/monitors
(POST /api/competitors de la Phase 2). Le premier scrape reste un job
Trigger.dev — c'est le seul usage de Trigger.dev dans l'onboarding.

Enregistrer le router dans apps/api/src/index.ts.

→ vérifier : curl POST /api/onboarding/analyze avec une URL → profil retourné
→ vérifier : curl POST /api/onboarding/discover → liste scorée retournée

Commit : `feat(api): add synchronous onboarding routes`

---

## Étape 5 — UI : flow d'onboarding 5 étapes (sans Realtime)

State machine côté client, un seul composant avec steps. Appels fetch
classiques avec états de loading (spinners). Aucune dépendance Realtime.

### apps/web/src/lib/api.ts
S'assurer que le client fetch gère les appels longs (pas de timeout court côté client).

### apps/web/src/app/(onboarding)/onboarding/page.tsx

**Étape 1 — Ton produit**
- Input URL + (optionnel) une phrase de description
- Bouton "Analyser"
- Au clic :
```typescript
  setLoading(true);
  const res = await api.post("/onboarding/analyze", { productUrl });
  setProfile(res.profile);
  setStep(2);
  setLoading(false);
```
- Pendant loading : spinner amber + "Analyse de votre produit..."

**Étape 2 — Validation du profil**
- Afficher le profil détecté (catégorie, audience, valeur, modèle) dans des champs éditables
- Boutons "Corriger" (PATCH /onboarding/profile) / "C'est ça"
- Moment "wow, il a tout compris" — soigner cette étape

**Étape 3 — Concurrents détectés**
- Au passage à l'étape :
```typescript
  setLoading(true);
  const res = await api.post("/onboarding/discover", { productUrl, profile });
  setCompetitors(res.competitors);
  setLoading(false);
```
- Pendant loading : spinner + "Recherche de vos concurrents..."
- Liste avec :
  - Checkbox (pré-cochée si overlapScore > 60)
  - Nom + favicon
  - Badge overlap score coloré
  - Reason au survol (tooltip)
- Bouton "+ Ajouter un concurrent manuellement"

**Étape 4 — Préférences de monitoring**
- Fréquence : quotidien / hebdo (radio)
- Sources à activer : homepage, pricing, blog (checkboxes)

**Étape 5 — Confirmation**
- "Configuration de votre veille..."
- POST /onboarding/complete
- Redirect vers /dashboard

Respecter le design Outrival (dark, amber #F59E0B, Syne + Inter, shadcn new-york).
Icônes lucide-react uniquement. Spinners en amber.

→ vérifier : flow complet de bout en bout depuis un nouveau compte

Commit : `feat(web): add 5-step competitor discovery onboarding flow`

---

## Étape 6 — Garde d'onboarding

### apps/web/src/app/(dashboard)/layout.tsx
Ajouter une vérification : si onboardingCompleted = false → redirect /onboarding.

Surgical : ajouter uniquement le check, ne pas toucher au reste du layout.

→ vérifier : un nouvel utilisateur est redirigé vers l'onboarding

Commit : `feat(web): redirect to onboarding until completed`

---

## Étape 7 — Vérification finale

```bash
pnpm build && pnpm typecheck && pnpm dev && pnpm trigger:dev
```

Test end-to-end complet :
1. Créer un nouveau compte → redirect vers /onboarding
2. Entrer une URL de produit réelle (ex: https://cal.com)
3. Vérifier que le profil détecté est pertinent (étape 2)
4. Corriger le profil → vérifier la persistance
5. Lancer la discovery → 10-15 concurrents avec scores cohérents
6. Sélectionner 3-4 concurrents
7. Choisir les préférences de monitoring
8. Compléter → concurrents créés + monitors + premier scrape déclenché
9. Arriver sur le dashboard avec les concurrents en place
10. Re-login → plus de redirect onboarding (completed)

---

## Étape 8 — Mettre à jour le planning

task_plan.md :
- Phase 4 Competitor Discovery → complete ✓
- Phase 5 Enrichissement → in_progress (prochaine)

findings.md :
- Qualité de la discovery Exa.ai (pertinence des résultats par type de produit)
- Qualité du scoring d'overlap Groq
- Comportement de quickFetchText (sites où l'extraction texte est faible)
- Temps réel des appels synchrones analyze/discover

progress.md : log de session.
</task>

<constraints>
- L'analyse produit et le scoring passent par Groq via AI_CONFIG
- analyze et discover sont des appels API SYNCHRONES — pas de jobs Trigger.dev
- AUCUNE dépendance à Trigger.dev Realtime ni @trigger.dev/react-hooks
- discover ne crée RIEN en DB — retourne juste la liste
- Seuls les concurrents sélectionnés par l'utilisateur deviennent des competitors
- Le premier scrape (dans /complete) reste un job Trigger.dev — seul usage ici
- Utiliser quickFetchText (pas Playwright) pour l'analyse — garder l'API légère
- Ne pas implémenter "nouveau concurrent détecté" (Phase 6)
- Ne pas implémenter jobs/reviews enrichis (Phase 5)
- Réutiliser la logique de création competitors/monitors de la Phase 2
- Pré-cocher uniquement les concurrents avec overlap > 60
- Surgical : ajouter le check onboarding sans réécrire le dashboard layout
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@.claude/skills/ai-pipeline/SKILL.md
@.claude/skills/crawlee-patterns/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
@packages/scrapers/CLAUDE.md
@packages/ai/CLAUDE.md
@packages/db/CLAUDE.md
</references>

<verification>
La phase est terminée quand TOUS ces checks passent :

✓ pnpm build → 0 erreurs
✓ pnpm typecheck → 0 erreurs
✓ Aucune dépendance Trigger.dev Realtime installée
✓ Entrer une URL produit retourne un profil produit pertinent (synchrone)
✓ Le profil est éditable et la correction persiste
✓ La discovery retourne 10-15 concurrents avec scores d'overlap cohérents (synchrone)
✓ Les concurrents sont triés par overlap décroissant
✓ Sélectionner des concurrents les crée avec leurs monitors
✓ Le premier scrape se déclenche immédiatement après completion
✓ org.onboardingCompleted passe à true
✓ Un nouvel utilisateur est redirigé vers l'onboarding
✓ Un utilisateur ayant complété l'onboarding va directement au dashboard
✓ task_plan.md Phase 4 = complete
</verification>

<commit>
Commits dans l'ordre :
chore(deps): install phase 4 discovery dependencies
feat(db): add product profile and onboarding state to organizations
feat(ai): add product analysis and overlap scoring tasks
feat(scrapers): add Exa.ai discovery and lightweight fetch
feat(api): add synchronous onboarding routes
feat(web): add 5-step competitor discovery onboarding flow
feat(web): redirect to onboarding until completed
</commit>