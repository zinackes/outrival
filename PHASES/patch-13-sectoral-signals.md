# Patch 13 — Intelligence sectorielle depuis les données existantes

<context>
Aujourd'hui Outrival génère des signals UNIQUEMENT au niveau micro (un changement
chez un concurrent → un signal pour le user qui le suit). Mais on a déjà toutes
les données pour faire du méso : croiser les snapshots de plusieurs concurrents
du MÊME user pour détecter des patterns sectoriels.

Exemples de signaux sectoriels possibles :
- "5 de vos 8 concurrents ont ajouté une feature AI ce mois-ci"
- "3 concurrents recrutent activement des Sales Enterprise"
- "Le pricing médian de votre secteur a baissé de 12% sur 6 mois"
- "2 concurrents sont passés de pricing public à gated_demo"

Pourquoi c'est précieux : un signal micro dit "X a fait Y". Un signal sectoriel
dit "X fait Y dans un contexte où plusieurs autres font pareil — c'est une
tendance, pas un accident". Ça change radicalement l'interprétation.

Pourquoi c'est différenciant : personne d'autre n'a tes données agrégées pour
faire cette analyse. Et c'est gratuit (réutilise tout ce qui existe).

SCOPE STRICT : on reste dans la veille concurrentielle. On N'AJOUTE PAS de
sources externes (RSS, news APIs, etc.). On N'EXPOSE PAS l'intelligence
sectorielle entre orgs différentes (chaque user voit uniquement les patterns
de SES propres concurrents).

Lire avant : @CLAUDE.md, @docs/architecture.md, @packages/ai/CLAUDE.md,
@.claude/skills/ai-pipeline/SKILL.md, @.claude/skills/clickhouse/SKILL.md,
@PHASES/03-ai-intelligence.md (pipeline signals existant),
@PHASES/05-enrichissement.md (sources de données enrichies),
@PHASES/patch-11-pricing-detection.md (taxonomie pricing),
@PHASES/patch-09-ai-cost-optimization.md (cache et routing)
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Env

Pas de nouvelle dépendance.

```
SECTORAL_ANALYSIS_DAY=monday      # jour de la semaine pour l'analyse hebdo
SECTORAL_MIN_COMPETITORS=4        # nombre minimum de concurrents pour analyser
SECTORAL_MIN_CONFIDENCE=0.6       # seuil de confiance min pour publier un signal
```

→ vérifier : env lue côté workers

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Schéma : sectoral_signals

Distinct de signal_feed pour ne pas mélanger micro et méso.

### packages/db/src/schema/sectoral-signals.ts
```typescript
import { pgTable, text, timestamp, jsonb, pgEnum, numeric } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const sectoralCategoryEnum = pgEnum("sectoral_category", [
  "feature_trend",        // ex: vague d'ajouts de feature AI
  "hiring_trend",         // ex: vague de recrutement sales
  "pricing_trend",        // ex: baisse médiane des prix
  "positioning_shift",    // ex: plusieurs concurrents passent gated
  "category_emergence",   // ex: nouveau type de feature apparaît
]);

export const sectoralSignals = pgTable("sectoral_signals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

  category: sectoralCategoryEnum("category").notNull(),
  title: text("title").notNull(),               // "5 de vos 8 concurrents ont ajouté une feature AI"
  insight: text("insight").notNull(),           // le "so what" stratégique
  evidence: jsonb("evidence").notNull(),        // { competitors: [...], dataPoints: [...] }
  confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(), // 0.00-1.00
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),

  // état utilisateur
  readAt: timestamp("read_at"),
  dismissedAt: timestamp("dismissed_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

Ajouter au schema/index.ts. pnpm db:push --filter @outrival/db

→ vérifier : table créée dans Drizzle Studio

Commit : `feat(db): add sectoral_signals table`

---

## Étape 2 — Détecteurs de patterns (analyses pures sur les données existantes)

### packages/ai/src/sectoral/detectors.ts

Chaque détecteur est une fonction PURE qui prend les données agrégées d'une org
et retourne 0 ou N patterns détectés. Pas d'appel IA dans les détecteurs
(juste de la statistique). L'IA viendra à l'étape 3 pour formuler l'insight.

```typescript
export interface PatternEvidence {
  competitors: Array;
  dataPoints: unknown[];     // données brutes pour traçabilité
  metric: string;
  value: number | string;
}

export interface DetectedPattern {
  category: SectoralCategory;
  rawSignal: string;          // description brute pour l'IA
  evidence: PatternEvidence;
  confidence: number;          // 0-1
}

/**
 * Détecte les vagues de features ajoutées sur une période.
 * Source : changes classifiées "feature_added" dans les snapshots récents.
 */
export function detectFeatureTrends(
  competitors: CompetitorWithChanges[],
  periodDays: number,
): DetectedPattern[] {
  // Compter les ajouts de features par concurrent sur la période
  // Identifier les thèmes communs (AI, integrations, mobile, etc.)
  // Si ≥40% des concurrents partagent un thème → pattern
}

/**
 * Détecte les vagues de recrutement sur des profils spécifiques.
 * Source : job_postings agrégées par titre/catégorie.
 */
export function detectHiringTrends(
  competitors: CompetitorWithJobs[],
  periodDays: number,
): DetectedPattern[] {
  // Compter les ouvertures par catégorie de poste (Sales, AI/ML, Marketing...)
  // Si ≥3 concurrents recrutent dans la même catégorie → pattern
}

/**
 * Détecte les évolutions de pricing au niveau du secteur.
 * Source : pricing_history ClickHouse.
 */
export function detectPricingTrends(
  competitors: CompetitorWithPricing[],
  periodDays: number,
): DetectedPattern[] {
  // Calculer la variation médiane des tiers comparables
  // Si > 10% sur 90j → pattern
}

/**
 * Détecte les transitions de statut pricing (Patch 11).
 * Source : pricing_history avec champ status.
 */
export function detectPositioningShifts(
  competitors: CompetitorWithPricing[],
  periodDays: number,
): DetectedPattern[] {
  // Compter les transitions public → gated_demo
  // Si ≥2 concurrents → pattern de consolidation enterprise
}
```

→ vérifier : tests unitaires sur fixtures représentatives
  (ex: 8 concurrents fictifs avec données préparées → patterns attendus)

Commit : `feat(ai): add sectoral pattern detectors (pure functions)`

---

## Étape 3 — Formulation IA des signaux sectoriels

### packages/ai/src/sectoral/formulate.ts

Une fois les patterns détectés, l'IA formule un signal lisible avec le "so what".

```typescript
import { complete } from "../provider/groq";

export interface SectoralSignalDraft {
  title: string;
  insight: string;       // le "so what" stratégique
}

export async function formulateSectoralSignal(
  pattern: DetectedPattern,
  userContext: { category: string; audience: string },  // depuis le ProductProfile
): Promise {
  // Prompt : "Tu es un analyste sectoriel. Voici un pattern détecté
  //          dans les concurrents de [user]. Formule un titre court
  //          et un insight stratégique de 2-3 phrases."
  //
  // Modèle : "smart" (llama-3.3-70b) — c'est de la génération créative,
  // pas une classification. PAS de cache (sortie créative).
  //
  // Retour structuré JSON via safeParseJson.
}
```

Le prompt doit insister sur :
- Ne PAS inventer de données — utiliser uniquement l'evidence fournie
- Le "so what" doit être actionnable (qu'est-ce que le user devrait faire)
- Ton sobre, factuel, pas de superlatifs

→ vérifier : un pattern test → signal formulé avec titre + insight cohérents
→ vérifier : evidence respectée (pas d'invention)

Commit : `feat(ai): formulate sectoral signals from detected patterns`

---

## Étape 4 — Job hebdomadaire d'analyse

### apps/workers/src/jobs/analyze-sectoral.job.ts

Job Trigger.dev planifié chaque lundi matin.

```typescript
import { logger } from "@outrival/shared";
import { db } from "@outrival/db";
import { detectFeatureTrends, detectHiringTrends, detectPricingTrends, detectPositioningShifts } from "@outrival/ai/sectoral";
import { formulateSectoralSignal } from "@outrival/ai/sectoral";
import { logAiRun } from "../lib/log-ai-run";  // patch-02

export const analyzeSectoralJob = task({
  id: "analyze-sectoral",
  cron: "0 7 * * 1",  // lundi 7h, ajustable via SECTORAL_ANALYSIS_DAY
  run: async () => {
    const orgs = await db.query.organizations.findMany({
      where: /* orgs avec ≥ SECTORAL_MIN_COMPETITORS concurrents actifs */
    });

    for (const org of orgs) {
      try {
        await analyzeOneOrg(org);
      } catch (e) {
        logger.error({ orgId: org.id, err: e }, "Sectoral analysis failed");
        // ne pas bloquer les autres orgs
      }
    }
  },
});

async function analyzeOneOrg(org: Organization) {
  // 1. Charger les données nécessaires pour cette org (7 derniers jours pour
  //    features/hiring, 90j pour pricing)
  const data = await loadOrgSectoralData(org.id);

  if (data.competitors.length < MIN_COMPETITORS) {
    logger.debug({ orgId: org.id }, "Not enough competitors for sectoral analysis");
    return;
  }

  // 2. Lancer tous les détecteurs
  const patterns = [
    ...detectFeatureTrends(data.competitors, 30),
    ...detectHiringTrends(data.competitors, 30),
    ...detectPricingTrends(data.competitors, 90),
    ...detectPositioningShifts(data.competitors, 30),
  ];

  // 3. Filtrer par confiance minimale
  const significant = patterns.filter(p => p.confidence >= MIN_CONFIDENCE);

  // 4. Formuler les signaux via l'IA (1 appel par pattern significatif)
  for (const pattern of significant) {
    const draft = await formulateSectoralSignal(pattern, {
      category: org.productProfile?.category ?? "",
      audience: org.productProfile?.audience ?? "",
    });

    await logAiRun("formulate_sectoral", "groq", "llama-3.3-70b-versatile",
      draft ? "success" : "parse_failed");

    if (!draft) continue;

    // 5. Persister le signal sectoriel
    await db.insert(sectoralSignals).values({
      orgId: org.id,
      category: pattern.category,
      title: draft.title,
      insight: draft.insight,
      evidence: pattern.evidence,
      confidence: pattern.confidence.toString(),
      periodStart: new Date(Date.now() - 30 * 86400000),
      periodEnd: new Date(),
    });
  }

  logger.info({ orgId: org.id, count: significant.length },
    "Sectoral analysis completed");
}
```

→ vérifier : déclenchement manuel sur une org test → patterns détectés,
  formulés, persistés
→ vérifier : org avec < 4 concurrents → skip propre, pas d'erreur
→ vérifier : ai_runs (patch-02) loggue chaque formulate_sectoral

Commit : `feat(workers): weekly sectoral analysis job`

---

## Étape 5 — API : exposer les signaux sectoriels

### apps/api/src/routes/sectoral.ts

```
GET /api/sectoral
  authMiddleware. Retourne les sectoral_signals de l'org user, ordonnés
  par createdAt DESC, non dismissed. Optionnel : ?limit=N

POST /api/sectoral/:id/read
  Marque readAt = now().

POST /api/sectoral/:id/dismiss
  Marque dismissedAt = now(). Ne supprime pas (on garde l'historique).
```

→ vérifier : GET retourne les signaux sectoriels de l'org uniquement (pas d'autres orgs)
→ vérifier : read/dismiss mettent à jour les timestamps

Commit : `feat(api): expose sectoral signals endpoints`

---

## Étape 6 — UI : section dédiée dans le dashboard

### apps/web/src/app/(dashboard)/page.tsx (ou la page d'accueil dashboard)

Ajouter une section CLAIREMENT séparée des signals micro. Visuellement distincte.

```
┌─ Signaux sur vos concurrents ──────────────────────────┐
│  (signal_feed classique, existant)                     │
│  ...                                                    │
└────────────────────────────────────────────────────────┘

┌─ 🌍 Tendances sectorielles ────────────────────────────┐
│                                                         │
│  📈 Recrutements                                        │
│     3 de vos concurrents recrutent activement des       │
│     Sales Enterprise.                                   │
│     Insight : consolidation enterprise probable du      │
│     secteur. Réfléchir à votre positionnement face      │
│     à cette pression.                                   │
│     [Voir le détail] [Marquer comme lu]                │
│                                                         │
│  💰 Pricing                                             │
│     Le pricing médian de votre secteur a baissé de      │
│     12% sur 6 mois.                                     │
│     Insight : pression marché. Vos hausses de prix      │
│     deviendront plus difficiles à justifier sans        │
│     différentiation forte.                              │
│     [Voir le détail] [Marquer comme lu]                │
│                                                         │
└────────────────────────────────────────────────────────┘
```

Composant `SectoralSignalCard` :
- Icône par catégorie (📈 hiring, 💰 pricing, ✨ feature, 🎯 positioning)
- Titre + insight + confidence visible (subtilement, ex: "Confiance : 78%")
- Click sur le card → modal avec evidence détaillée (liste des concurrents
  concernés, dataPoints)
- État lu/non lu visible
- Bouton dismiss

Design Outrival (dark + amber + Geist Mono pour les chiffres).

→ vérifier : signaux sectoriels visibles dans la bonne section
→ vérifier : section vide masquée si aucun signal (pas de placeholder vide)
→ vérifier : modal de détail montre l'evidence

Commit : `feat(web): add sectoral signals section to dashboard`

---

## Étape 7 — Intégration dans le digest hebdomadaire

### apps/workers/src/jobs/generate-digest.job.ts

Le digest existant (Phase 3) reprend les signals classiques. Étendre pour
inclure une section **"Tendances sectorielles"** s'il y a des sectoral_signals
non lus pour l'org.

Le prompt du digest reçoit en plus :
- La liste des sectoral_signals récents (non lus, non dismissed)
- Instruction : "Inclure une section distincte 'Tendances sectorielles' qui
  reprend ces signaux dans un format synthétique."

Visuellement dans l'email : section dédiée avec un séparateur clair, après
les signals classiques.

→ vérifier : un digest généré inclut bien la section sectorielle si signaux dispo
→ vérifier : pas de section vide si aucun signal sectoriel

Commit : `feat(workers): include sectoral signals in weekly digest`

---

## Étape 8 — Garde-fous

### Limites volontaires à coder explicitement

**a. Confidence threshold**
Aucun signal sectoriel publié si confidence < SECTORAL_MIN_CONFIDENCE. Évite
de surfacer des patterns trop faibles.

**b. Minimum de concurrents**
Aucune analyse si l'org a < SECTORAL_MIN_COMPETITORS concurrents actifs.
4 concurrents minimum pour parler de "tendance sectorielle". Sinon c'est
juste deux concurrents qui font la même chose.

**c. Pas d'inter-org**
Les sectoral_signals d'une org sont calculés UNIQUEMENT à partir des concurrents
de cette org. Pas d'agrégation cross-org. RGPD-clean + respect de la
confidentialité business.

**d. Pas de prédiction**
Les sectoral_signals décrivent ce qui EST observé. Pas de "X va probablement
faire Y dans les 3 mois". La prédiction (predictive signals) est en Backlog,
hors scope ici.

**e. Pas de sources externes**
Tous les patterns viennent des données déjà collectées par Outrival. Aucune
ingestion de RSS, news APIs, ou autre. C'est la discipline qui garde le
scope produit serré.

Documenter ces limites dans findings.md.

Commit : `docs: document sectoral analysis guardrails`

---

## Étape 9 — Vérification finale

```bash
pnpm build && pnpm typecheck
```

Test end-to-end :

1. Créer une org test avec 5+ concurrents
2. Préparer des données simulant des patterns (ex: 3 concurrents avec
   feature_added de type "AI" sur le dernier mois)
3. Déclencher analyze-sectoral manuellement
4. Vérifier : sectoral_signals créés avec evidence cohérente
5. UI dashboard : signaux affichés dans la section dédiée, distincts des signals micro
6. Click sur un signal → modal détail avec evidence
7. Mark as read → readAt mis à jour
8. Dismiss → dismissedAt mis à jour, signal disparaît
9. Générer un digest → section "Tendances sectorielles" présente
10. Org avec 2 concurrents → skip, aucun signal généré, log debug clair
11. ai_runs (patch-02) montre les appels formulate_sectoral

Mettre à jour findings.md :
- Patterns détectés en pratique
- Faux positifs observés (ajuster les seuils)
- Confidence distribution réelle
- Performance du job (durée, coût IA)

task_plan.md : patch-13 → complete.
</task>

<constraints>
- Distinct de signal_feed : table sectoral_signals dédiée, UI séparée
- Pure functions pour les détecteurs (PAS d'IA dans les détecteurs)
- IA pour la FORMULATION uniquement (génération créative, modèle "smart", PAS de cache)
- Minimum SECTORAL_MIN_COMPETITORS (défaut 4) sinon skip propre
- Confidence threshold (défaut 0.6) pour ne publier que les patterns solides
- AUCUNE agrégation cross-org (chaque org voit uniquement ses propres patterns)
- AUCUNE source externe (RSS, news APIs) — discipline de scope stricte
- AUCUNE prédiction (predictive signals = Backlog, hors scope)
- UI clairement distincte des signals classiques (icône, section, séparateur)
- Le job ne doit JAMAIS bloquer une org en cas d'échec sur une autre
- Evidence persistée pour traçabilité et debug
- ai_runs (patch-02) loggue chaque formulate_sectoral
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@packages/ai/CLAUDE.md
@.claude/skills/ai-pipeline/SKILL.md
@.claude/skills/clickhouse/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
@PHASES/03-ai-intelligence.md
@PHASES/05-enrichissement.md
@PHASES/patch-09-ai-cost-optimization.md
@PHASES/patch-11-pricing-detection.md
@apps/web/CLAUDE.md
@apps/api/CLAUDE.md
@packages/db/CLAUDE.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Table sectoral_signals créée
✓ Détecteurs purs (sans appel IA) testés unitairement
✓ Formulation IA produit titre + insight cohérents avec evidence
✓ Job hebdomadaire planifié (lundi 7h)
✓ Org avec < 4 concurrents → skip propre
✓ Confidence < seuil → pas publié
✓ AUCUNE agrégation cross-org (vérifier qu'une org ne voit que ses patterns)
✓ AUCUNE source externe ajoutée
✓ UI : section dédiée distincte des signals micro
✓ Read/dismiss fonctionnels
✓ Digest inclut une section sectorielle quand pertinent
✓ ai_runs loggue les formulate_sectoral
✓ task_plan.md patch-13 = complete
</verification>

<commit>
feat(db): add sectoral_signals table
feat(ai): add sectoral pattern detectors (pure functions)
feat(ai): formulate sectoral signals from detected patterns
feat(workers): weekly sectoral analysis job
feat(api): expose sectoral signals endpoints
feat(web): add sectoral signals section to dashboard
feat(workers): include sectoral signals in weekly digest
docs: document sectoral analysis guardrails
</commit>