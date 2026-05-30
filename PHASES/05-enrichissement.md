# Phase 5 — Enrichissement des sources

<context>
Les Phases 1 à 4 sont terminées : monorepo, auth, scraping autonome,
pipeline IA (signals), alertes, digest, et découverte automatique des
concurrents avec onboarding complet.

Cette phase enrichit la donnée et construit la fiche concurrent complète :
- Job postings : scraper les pages carrières → signaux stratégiques de recrutement
- Reviews : G2 / Capterra → score, verbatims, complaints récurrents
- Pricing structuré : extraire les prix → historique time-series dans ClickHouse
- Résumé IA du concurrent (2-3 phrases toujours visibles)
- Fiche concurrent complète avec tous les onglets

Les données time-series (historique prix, trends recrutement, scores reviews)
vont dans ClickHouse. Les données structurées (job_postings, reviews) en Postgres.

Lire impérativement avant de commencer :
- @CLAUDE.md
- @docs/architecture.md
- @task_plan.md
- @findings.md
- @.claude/skills/crawlee-patterns/SKILL.md
- @.claude/skills/trigger-jobs/SKILL.md
- @.claude/skills/ai-pipeline/SKILL.md
- @.claude/skills/clickhouse/SKILL.md
- @.claude/skills/add-monitor-source/SKILL.md
- @packages/scrapers/CLAUDE.md
- @packages/ai/CLAUDE.md
- @packages/db/CLAUDE.md
</context>

<goal>
À la fin de cette phase :
- Les sources jobs, g2_reviews, capterra_reviews sont scrapables
- Le pricing scrapé est extrait en données structurées → ClickHouse pricing_history
- Les job postings sont stockés + leur trend par département dans ClickHouse
- Les reviews sont stockées + le score moyen dans ClickHouse review_scores
- Chaque concurrent a un résumé IA généré (2-3 phrases)
- La fiche concurrent complète affiche tous les onglets (activité, pricing,
  recrutement, reviews, contenu)
- pnpm build et pnpm typecheck passent à 0 erreur
</goal>

<task>
Exécuter dans cet ordre exact. Committer après chaque étape numérotée.

## Étape 0 — Dépendances + ClickHouse client

```bash
# packages/db : client ClickHouse (si pas déjà installé en Phase 3)
pnpm add @clickhouse/client --filter @outrival/db
```

Vérifier que `.env.local` contient :
```
CLICKHOUSE_URL=...
CLICKHOUSE_PASSWORD=...
```

Si ClickHouse Cloud n'est pas encore setup : créer un projet (free tier),
récupérer l'URL HTTP + le password.

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): ensure clickhouse client installed`

---

## Étape 1 — Tables ClickHouse

### packages/db/src/clickhouse-schema.ts
Script de création des tables time-series (idempotent, CREATE IF NOT EXISTS).
Suivre @.claude/skills/clickhouse/SKILL.md.

```typescript
import { ch } from "./clickhouse";

export async function ensureClickhouseTables(): Promise {
  await ch.command({ query: `
    CREATE TABLE IF NOT EXISTS pricing_history (
      competitor_id String,
      plan_name String,
      price Float64,
      currency String,
      billing_period String,
      recorded_at DateTime DEFAULT now()
    ) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
  `});

  await ch.command({ query: `
    CREATE TABLE IF NOT EXISTS job_counts (
      competitor_id String,
      department String,
      count UInt32,
      recorded_at DateTime DEFAULT now()
    ) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
  `});

  await ch.command({ query: `
    CREATE TABLE IF NOT EXISTS review_scores (
      competitor_id String,
      source String,
      score Float64,
      review_count UInt32,
      sentiment_score Float64,
      recorded_at DateTime DEFAULT now()
    ) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
  `});

  await ch.command({ query: `
    CREATE TABLE IF NOT EXISTS signal_feed (
      org_id String,
      competitor_id String,
      category String,
      severity String,
      recorded_at DateTime DEFAULT now()
    ) ENGINE = MergeTree() ORDER BY (org_id, recorded_at)
  `});
}
```

Ajouter un script `pnpm ch:setup` dans packages/db qui appelle ensureClickhouseTables().

→ vérifier : pnpm ch:setup → les 4 tables existent dans ClickHouse

Commit : `feat(db): add clickhouse time-series tables setup`

---

## Étape 2 — Schéma : résumé IA du concurrent

### packages/db/src/schema/competitors.ts
Ajouter :
```typescript
aiSummary: text("ai_summary"),
aiSummaryUpdatedAt: timestamp("ai_summary_updated_at"),
```

Puis : pnpm db:push --filter @outrival/db

Commit : `feat(db): add ai summary field to competitors`

---

## Étape 3 — packages/ai : tâches d'extraction

Toutes via Groq (AI_CONFIG.classification). Suivre @.claude/skills/ai-pipeline/SKILL.md.

### packages/ai/src/tasks/extract-pricing.ts
Input : texte de la page pricing. Output : plans structurés.
```typescript
const PricingSchema = z.object({
  plans: z.array(z.object({
    plan_name: z.string(),
    price: z.number(),
    currency: z.string(),
    billing_period: z.enum(["monthly", "yearly", "one_time", "custom"]),
  })),
});
```

### packages/ai/src/tasks/extract-jobs.ts
Input : texte de la page carrières. Output : offres structurées.
```typescript
const JobsSchema = z.object({
  jobs: z.array(z.object({
    title: z.string(),
    department: z.string(), // Engineering, Sales, Marketing, etc.
    location: z.string().nullable(),
  })),
});
```

### packages/ai/src/tasks/extract-reviews.ts
Input : texte d'une page G2/Capterra. Output : score + verbatims.
```typescript
const ReviewsSchema = z.object({
  average_score: z.number().nullable(),
  review_count: z.number().nullable(),
  sentiment_score: z.number().min(0).max(100), // estimation globale
  top_praises: z.array(z.string()).max(5),
  top_complaints: z.array(z.string()).max(5),
});
```

### packages/ai/src/tasks/competitor-summary.ts
Input : profil concurrent + derniers signals + résumé reviews. Output : 2-3 phrases.
```typescript
const SummarySchema = z.object({ summary: z.string() });

export async function generateCompetitorSummary(input: {
  name: string;
  category: string | null;
  recentSignals: Array;
  reviewSummary?: { score: number | null; topComplaints: string[] };
}): Promise { /* prompt + Groq + parse */ }
```

Réexporter toutes depuis packages/ai/src/index.ts.

→ vérifier : pnpm typecheck --filter @outrival/ai

Commit : `feat(ai): add pricing, jobs, reviews extraction and competitor summary`

---

## Étape 4 — packages/scrapers : nouveaux scrapers

Suivre @.claude/skills/crawlee-patterns/SKILL.md et @.claude/skills/add-monitor-source/SKILL.md.

### packages/scrapers/src/jobs/jobs.scraper.ts
Scrape la page carrières du concurrent.
Heuristique : tenter /careers, /jobs, /join-us, /carrieres.
Détecter les ATS courants (Greenhouse, Lever, Ashby, Workable) si présents.
PlaywrightCrawler (souvent JS-heavy).

### packages/scrapers/src/g2-reviews/g2-reviews.scraper.ts
Scrape la page G2 du concurrent.
TOUJOURS via ScrapingBee (G2 est fortement protégé anti-bot).
Construire l'URL G2 depuis le nom du concurrent ou un champ config du monitor.

### packages/scrapers/src/capterra-reviews/capterra-reviews.scraper.ts
Idem G2 mais pour Capterra. Via ScrapingBee.

### packages/scrapers/src/index.ts
Ajouter les nouveaux scrapers dans la map getScraper() :
jobs, g2_reviews, capterra_reviews.

→ vérifier : tester jobs.scraper sur une vraie page carrières
→ vérifier : tester g2-reviews sur une vraie page G2 (via ScrapingBee)

Commit : `feat(scrapers): add jobs, g2 and capterra review scrapers`

---

## Étape 5 — Workers : jobs d'extraction + branchement

### apps/workers/src/jobs/extract-pricing.job.ts
Input : { snapshotId, competitorId }
```
1. Récupérer le HTML du snapshot depuis R2
2. extractPricing(text)
3. Pour chaque plan → insert dans ClickHouse pricing_history
4. context.log
```

### apps/workers/src/jobs/extract-jobs.job.ts
Input : { snapshotId, competitorId }
```
1. Récupérer le HTML depuis R2
2. extractJobs(text)
3. Upsert dans la table job_postings (détecter nouvelles offres + offres fermées) :
   - offre présente avant, absente maintenant → set closedAt + isActive false
   - nouvelle offre → insert
4. Compter par département → insert un snapshot dans ClickHouse job_counts
5. context.log
```

### apps/workers/src/jobs/extract-reviews.job.ts
Input : { snapshotId, competitorId, source }
```
1. Récupérer le HTML depuis R2
2. extractReviews(text)
3. Insérer les nouveaux verbatims dans la table reviews
4. Insert score + review_count + sentiment dans ClickHouse review_scores
5. context.log
```

### apps/workers/src/jobs/refresh-competitor-summary.job.ts
Input : { competitorId }
```
1. Récupérer profil + derniers signals + dernier review summary
2. generateCompetitorSummary(...)
3. Update competitor.aiSummary + aiSummaryUpdatedAt
```

### Modifier scrape-monitor.job.ts
Après un scrape réussi, router selon le source_type vers l'extraction :
- pricing → trigger extract-pricing.job
- jobs → trigger extract-jobs.job
- g2_reviews / capterra_reviews → trigger extract-reviews.job

Surgical : ajouter UNIQUEMENT ce routing après le scrape. Ne pas toucher
à la logique de diff/change existante (qui continue de tourner pour tous).

→ vérifier : scraper une page pricing → pricing_history alimenté dans ClickHouse
→ vérifier : scraper une page carrières → job_postings + job_counts alimentés
→ vérifier : scraper une page G2 → reviews + review_scores alimentés

Commit : `feat(workers): add extraction jobs and wire to scrape-monitor`

---

## Étape 6 — API : données de la fiche concurrent

### apps/api/src/routes/competitors.ts
Enrichir GET /api/competitors/:id et ajouter des sous-routes :

```
GET /api/competitors/:id
  → competitor + aiSummary + monitors + derniers changes/signals

GET /api/competitors/:id/jobs
  → job_postings actifs, groupés par département

GET /api/competitors/:id/job-trends
  → ClickHouse job_counts, 90 derniers jours, par département

GET /api/competitors/:id/reviews
  → reviews récentes (Postgres) + dernier summary

GET /api/competitors/:id/review-scores
  → ClickHouse review_scores, évolution du score par source

GET /api/competitors/:id/pricing-history
  → ClickHouse pricing_history, timeline par plan

GET /api/competitors/:id/signals
  → signals du concurrent, ordonnés par date
```

Toutes protégées par authMiddleware + vérification que le concurrent
appartient bien à l'org de l'utilisateur.

→ vérifier : chaque endpoint retourne des données cohérentes

Commit : `feat(api): add competitor profile data endpoints`

---

## Étape 7 — UI : fiche concurrent complète

### apps/web/src/app/(dashboard)/competitors/[id]/page.tsx
Reconstruire la page détail complète selon le design (angle A).

**Header**
- Logo/favicon, nom, URL, catégorie
- Score d'overlap (barre de progression amber)
- Dernière activité
- (funding/founded si disponibles dans metadata, sinon masqués)

**Résumé IA** (toujours visible, sous le header)
- competitor.aiSummary

**Onglets** (shadcn Tabs) :

1. **Activité récente** — feed chronologique des signals du concurrent
   (badge sévérité, catégorie, insight, so_what)

2. **Pricing** — timeline visuelle depuis pricing-history
   - Graphique (recharts) de l'évolution des prix par plan
   - Indicateurs de variation (▲/▼ %)

3. **Recrutement** — depuis jobs + job-trends
   - Tableau : département / offres actives / trend 90j
   - Insight textuel si signal pertinent

4. **Reviews** — depuis reviews + review-scores
   - Score moyen + évolution (graphique recharts)
   - Deux colonnes : "Ce qu'ils adorent" / "Ce dont ils se plaignent"

5. **Contenu** — articles de blog détectés (depuis les changes source=blog)

Design Outrival (dark, amber #F59E0B, Syne + Inter, shadcn new-york).
Graphiques recharts thémés dark + amber. Icônes lucide-react.

Installer recharts si nécessaire : pnpm add recharts --filter @outrival/web

→ vérifier : la fiche affiche tous les onglets avec données réelles

Commit : `feat(web): build complete competitor profile page with all tabs`

---

## Étape 8 — Vérification finale

```bash
pnpm build && pnpm typecheck && pnpm dev && pnpm trigger:dev
pnpm ch:setup  # si pas déjà fait
```

Test end-to-end :
1. Sur un concurrent existant, ajouter les monitors jobs + g2_reviews
2. Scraper manuellement chaque source
3. Vérifier pricing_history alimenté (ClickHouse / Drizzle Studio équivalent)
4. Vérifier job_postings + job_counts alimentés
5. Vérifier reviews + review_scores alimentés
6. Déclencher refresh-competitor-summary → aiSummary rempli
7. Ouvrir la fiche concurrent → tous les onglets affichent des données
8. Vérifier les graphiques (pricing timeline, review score, job trends)

---

## Étape 9 — Mettre à jour le planning

task_plan.md :
- Phase 5 Enrichissement → complete ✓
- Phase 6 Battle Cards & Alertes → in_progress (prochaine)

findings.md :
- Fiabilité du scraping G2/Capterra (taux d'échec, structure)
- Qualité de l'extraction Groq (pricing, jobs, reviews)
- Heuristiques de détection des pages carrières / ATS
- Particularités des requêtes ClickHouse pour les trends

progress.md : log de session.
</task>

<constraints>
- Toutes les extractions passent par Groq via AI_CONFIG
- Données time-series → ClickHouse uniquement (pricing_history, job_counts, review_scores)
- Données structurées → Postgres (job_postings, reviews)
- LinkedIn est HORS scope (trop restreint) — on scrape la page carrières du concurrent
- G2 et Capterra TOUJOURS via ScrapingBee (anti-bot)
- Ne pas implémenter les battle cards (Phase 6)
- Ne pas implémenter "nouveau concurrent détecté" (Phase 6)
- Ne pas implémenter Stripe / billing (Phase 7)
- Surgical : modifier scrape-monitor uniquement pour ajouter le routing d'extraction
- ClickHouse est append-only — jamais d'UPDATE/DELETE
- Le résumé IA se régénère, ne pas le recalculer à chaque page load (utiliser aiSummaryUpdatedAt)
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@.claude/skills/crawlee-patterns/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
@.claude/skills/ai-pipeline/SKILL.md
@.claude/skills/clickhouse/SKILL.md
@.claude/skills/add-monitor-source/SKILL.md
@packages/scrapers/CLAUDE.md
@packages/ai/CLAUDE.md
@packages/db/CLAUDE.md
</references>

<verification>
La phase est terminée quand TOUS ces checks passent :

✓ pnpm build → 0 erreurs
✓ pnpm typecheck → 0 erreurs
✓ Les 4 tables ClickHouse existent (pnpm ch:setup)
✓ Scraper une page pricing alimente pricing_history (ClickHouse)
✓ Scraper une page carrières alimente job_postings + job_counts
✓ Scraper une page G2 alimente reviews + review_scores
✓ Les offres fermées sont marquées closedAt/isActive false
✓ refresh-competitor-summary remplit competitor.aiSummary
✓ La fiche concurrent affiche les 5 onglets avec données réelles
✓ Les graphiques (pricing, reviews, jobs) s'affichent correctement
✓ task_plan.md Phase 5 = complete
</verification>

<commit>
Commits dans l'ordre :
chore(deps): ensure clickhouse client installed
feat(db): add clickhouse time-series tables setup
feat(db): add ai summary field to competitors
feat(ai): add pricing, jobs, reviews extraction and competitor summary
feat(scrapers): add jobs, g2 and capterra review scrapers
feat(workers): add extraction jobs and wire to scrape-monitor
feat(api): add competitor profile data endpoints
feat(web): build complete competitor profile page with all tabs
</commit>