# Progress Log — Outrival

Log chronologique des sessions de développement.

## Format

### [DATE] — [Phase] — [Durée estimée]
**Objectif** : ...
**Réalisé** :
- ...
**Fichiers modifiés** :
- ...
**Tests** : pnpm build ✓ | pnpm typecheck ✓ | tests ✓
**Prochaine session** : ...

---

## Sessions

### 2026-05-25 — Phase 1 Foundation

**Objectif** : Monorepo démarrable avec auth, DB schema, dashboard shell, Trigger.dev configuré.

**Réalisé** :
- Étape 0 : Installation de toutes les dépendances (shared/db/api/web/workers + tailwind/shadcn core)
- Étape 1 : packages/shared — Result<T,E>, SOURCE_TYPES, SIGNAL_SEVERITIES, SIGNAL_CATEGORIES
- Étape 2 : packages/db — Drizzle schema complet (10 entités : organizations, users, competitors, monitors, snapshots, changes, signals, digests, alerts, job_postings, reviews)
- Étape 3 : apps/api — Hono server + Better Auth v1.6.11 + /health endpoint + Zod env validation
- Étape 4 : apps/web — Next.js App Router + auth flow (login/register) + dashboard shell (sidebar + 3 pages vides) + dark theme amber
- Étape 5 : apps/workers — Trigger.dev v3 config + hello-world.job.ts (API corrigée : logger.log vs ctx.log)
- Étape 6 : .env.local créé avec BETTER_AUTH_SECRET généré
- Étape 7 : pnpm build ✓ (7/7) | pnpm typecheck ✓ (7/7)

**Fichiers créés** :
- packages/shared/src/types/result.ts
- packages/shared/src/constants/sources.ts
- packages/db/src/schema/*.ts (11 fichiers)
- packages/db/src/client.ts + drizzle.config.ts
- apps/api/src/env.ts, lib/db.ts, lib/auth.ts, middleware/auth.ts, routes/health.ts, index.ts
- apps/web/src/lib/auth-client.ts, lib/utils.ts
- apps/web/src/app/layout.tsx, globals.css
- apps/web/src/app/(auth)/login/page.tsx, register/page.tsx
- apps/web/src/app/(dashboard)/layout.tsx, logout-button.tsx, page.tsx
- apps/web/src/app/(dashboard)/competitors/page.tsx, digests/page.tsx, alerts/page.tsx
- apps/web/next.config.ts, postcss.config.mjs
- apps/workers/trigger.config.ts, src/env.ts, src/jobs/hello-world.job.ts

**Corrections notables** :
- Trigger.dev v4 : `ctx.log` → `logger.log`, `maxDuration` requis dans config
- Better Auth v1 : `drizzleAdapter` sans schema custom, ses propres tables
- TypeScript : `@types/node` + `@types/react` requis, `lib: ["DOM"]` pour web

**Tests** : pnpm build ✓ | pnpm typecheck 7/7 ✓

**Prochaine session** :
1. Remplir DATABASE_URL dans .env.local → lancer pnpm db:push
2. Remplir TRIGGER_SECRET_KEY + TRIGGER_PROJECT_ID → tester pnpm trigger:dev
3. Test E2E manuel : localhost:3000/register → login → dashboard → logout
4. Commencer Phase 2 — Scraping Core

---

### 2026-05-25 — Phase 3 Intelligence IA

**Objectif** : Pipeline IA Groq-only de bout en bout — classify + insight + digest,
alertes Slack/email, scraping autonome (cron), digest hebdomadaire.

**Réalisé** :
- Étape 0 : Install deps (groq-sdk, @anthropic-ai/sdk, resend, @clickhouse/client)
- Étape 1 : packages/ai pipeline complet (config + provider abstrait + parse + classify + insight + digest)
- Étape 2 : organizations.{slackWebhookUrl, digestEmail, digestEnabled, alertsEnabled}
- Étape 3 : classify-change.job + generate-signal.job + insert ClickHouse signal_feed (best-effort)
- Étape 4 : scrape-monitor branché sur pipeline (trigger classify-change après création Change)
- Étape 5 : send-alert.job + lib/slack + lib/resend (Slack webhook + email HTML)
- Étape 6 : schedule-scraping.job (cron horaire, enqueue monitors due selon nextRunAt)
- Étape 7 : generate-weekly-digest.job (cron lundi 8h, idempotent par weekStart, email HTML)
- Étape 8 : Routes API /api/signals, /api/digests, /api/settings/notifications
- Étape 9 : UI — activity-feed devient signals feed, page Digests (liste + détail), page Settings
- Étape 10 : pnpm typecheck ✓ (7/7) + pnpm build ✓ (7/7)

**Fichiers créés** :
- packages/ai/src/{config,provider,env,index}.ts + lib/parse.ts + tasks/{classify,insight,digest}.ts
- apps/workers/src/jobs/{classify-change,generate-signal,send-alert,schedule-scraping,generate-weekly-digest}.job.ts
- apps/workers/src/lib/{clickhouse,slack,resend,digest-email}.ts
- apps/api/src/routes/{signals,digests,settings}.ts
- apps/web/src/components/outrival/{digests-list,notification-settings-form}.tsx
- apps/web/src/app/dashboard/settings/page.tsx

**Fichiers modifiés** :
- packages/db/src/schema/organizations.ts (4 colonnes notifications)
- apps/workers/src/jobs/scrape-monitor.job.ts (trigger classify-change après changeId créé)
- apps/api/src/index.ts (mount des nouveaux routers)
- apps/web/src/components/outrival/activity-feed.tsx (Changes → Signals)
- apps/web/src/lib/api.ts (Signal/Digest/Settings types + endpoints)
- apps/web/src/app/dashboard/digests/page.tsx (liste interactive)
- .env.local (placeholders GROQ_API_KEY, ANTHROPIC_API_KEY, RESEND_API_KEY, CLICKHOUSE_*)

**Décisions notables** :
- Pipeline 100% Groq (llama-3.3-70b-versatile) pour Phase 3 — swap Claude futur = 1 ligne dans config
- ClickHouse best-effort (skip si non configuré) pour ne pas bloquer le dev produit
- Pattern lazy : aiEnv() + getGroq() + getClaude() pour éviter crash au démarrage workers
- Idempotence signals via check signals.changeId dans BOTH classify-change ET generate-signal
- Alerts erreurs : insert ligne alerts.error au lieu de throw (signal pas perdu si alerte échoue)
- Digest skip orgs sans signal sur la semaine (pas de digest vide)

**Tests** : pnpm build ✓ (7/7) | pnpm typecheck ✓ (7/7) | tests runtime à faire avec keys

**Prochaine session** :
1. Remplir GROQ_API_KEY + RESEND_API_KEY dans .env.local
2. pnpm db:push --filter @outrival/db (colonnes notifications)
3. (optionnel) Provisionner ClickHouse + créer table signal_feed
4. Test E2E : scraper modifié → Signal → alerte high/critical reçue
5. Déclencher generate-weekly-digest manuellement → email digest reçu
6. Commencer Phase 4 — Competitor Discovery (Exa.ai)

---

### 2026-05-25 — Phase 4 Competitor Discovery

**Objectif** : Onboarding 5 étapes synchrone (URL produit → profil IA →
discovery Exa + scoring overlap Groq → sélection → premier scrape).
Zéro dépendance Trigger.dev Realtime.

**Réalisé** :
- Étape 0 : pnpm add exa-js @outrival/scrapers + EXA_API_KEY + SCRAPINGBEE_API_KEY
- Étape 1 : organizations.{productUrl, productProfile jsonb, onboardingCompleted}
- Étape 2 : packages/ai/tasks/{analyze-product, score-overlap} (Groq, schemas Zod, scoring batché)
- Étape 3 : packages/scrapers/discovery/discover.ts (Exa findSimilarAndContents) + lib/quick-fetch.ts (ScrapingBee no-JS)
- Étape 4 : apps/api/src/routes/onboarding.ts (5 endpoints : status, analyze, discover, profile, complete)
- Étape 5 : apps/web/src/app/(onboarding)/onboarding/page.tsx (client unique 5 étapes, state machine, spinners amber)
- Étape 6 : dashboard layout — getOnboardingStatus + redirect /onboarding (4 lignes surgical)
- Étape 7 : pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)

**Fichiers créés** :
- packages/ai/src/tasks/analyze-product.ts, score-overlap.ts
- packages/scrapers/src/discovery/discover.ts, lib/quick-fetch.ts
- apps/api/src/routes/onboarding.ts
- apps/web/src/app/(onboarding)/onboarding/page.tsx

**Fichiers modifiés** :
- packages/db/src/schema/organizations.ts (+3 colonnes)
- packages/ai/src/index.ts (réexports)
- packages/scrapers/src/index.ts + package.json (subpath exports ./discovery, ./quick-fetch)
- apps/api/package.json (+ @outrival/scrapers workspace)
- apps/api/src/index.ts (mount /api/onboarding)
- apps/web/src/lib/api.ts (5 endpoints + types ProductProfile, DiscoveredCompetitor)
- apps/web/src/app/dashboard/layout.tsx (garde onboarding)
- .env.local (EXA_API_KEY + SCRAPINGBEE_API_KEY placeholders)

**Décisions notables** :
- Tout synchrone — pas de Trigger.dev Realtime (gratuit, plus simple, debug trivial)
- Scoring overlap **batché** : 1 appel Groq pour 15 candidats (vs 15 appels séparés)
- ProductProfile en **camelCase** partout (valueProp, pricingModel) — LLM instruit en camelCase
- Subpath exports @outrival/scrapers pour ne pas pull crawlee/playwright dans l'API
- `/discover` ne crée RIEN en DB — seul `/complete` crée competitors + monitors
- Premier scrape post-onboarding = seul usage Trigger.dev (réutilise scrape-monitor)

**Tests** : pnpm build ✓ (7/7) | pnpm typecheck ✓ (7/7) | runtime à tester avec EXA + SCRAPINGBEE keys

**Prochaine session** :
1. Remplir EXA_API_KEY + SCRAPINGBEE_API_KEY dans .env.local
2. Test E2E : nouveau compte → /onboarding → URL réelle → flow complet → dashboard
3. Mesurer latence /analyze + /discover (cible <15s total)
4. Évaluer qualité discovery Exa sur 3-4 produits variés
5. Commencer Phase 5 — Enrichissement (jobs, reviews, pricing history)

---

### 2026-05-25 — Phase 5 Enrichissement

**Objectif** : Sources jobs + G2/Capterra scrapables, pricing structuré en ClickHouse,
résumé IA des concurrents, fiche concurrent complète (5 onglets, recharts).

**Réalisé** :
- Étape 0 : @clickhouse/client ajouté à @outrival/db
- Étape 1 : client `ch` partagé (proxy lazy) + ensureClickhouseTables (4 tables)
  + script `pnpm --filter @outrival/db ch:setup` (bun + dotenv ../../.env.local)
- Étape 2 : competitors.aiSummary + aiSummaryUpdatedAt + pnpm db:push
- Étape 3 : 4 tâches Groq (extract-pricing/jobs/reviews + competitor-summary)
  via AI_CONFIG.classification, Zod schemas snake_case, safeParseJson
- Étape 4 : 3 nouveaux scrapers (jobs Playwright + ATS detect, g2-reviews via
  ScrapingBee premium, capterra-reviews) + helper scrapingbee.ts + getScraper map
- Étape 5 : 4 nouveaux jobs Trigger.dev v3 :
  - extract-pricing.job → ClickHouse pricing_history
  - extract-jobs.job → diff vs actives (close manquants, insert nouveaux) +
    ClickHouse job_counts par département
  - extract-reviews.job → praises/complaints en reviews + ClickHouse review_scores
  - refresh-competitor-summary.job → update competitor.aiSummary
  - scrape-monitor.job : routing surgical (~12 lignes) selon source_type
- Étape 6 : 6 sous-routes /api/competitors/:id/{jobs,job-trends,reviews,review-scores,
  pricing-history,signals} + enrichissement /:id avec aiSummary + recentSignals
  + helper assertOwnedCompetitor + chQuery best-effort
- Étape 7 : refonte complète /dashboard/competitors/[id] :
  - Header (name, category, overlap bar, last activity)
  - AiSummary toujours visible (avec placeholder si non généré)
  - Monitor list inline avec bouton "Scraper"
  - 5 onglets custom (Activité, Pricing, Recrutement, Reviews, Contenu) lazy-load
  - recharts dark amber : pricing timeline (par plan), job trends (par département),
    review scores (par source)
  - Cards delta % pour pricing
  - Table département × offres actives × trend 90j
  - Reviews : 2 colonnes praises (green) / complaints (red)
- Étape 8 : pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)

**Fichiers créés** :
- packages/db/src/clickhouse.ts + clickhouse-schema.ts + scripts/ch-setup.ts
- packages/ai/src/tasks/{extract-pricing,extract-jobs,extract-reviews,competitor-summary}.ts
- packages/scrapers/src/{jobs/jobs.scraper,g2-reviews/g2-reviews.scraper,capterra-reviews/capterra-reviews.scraper}.ts
- packages/scrapers/src/lib/scrapingbee.ts
- apps/workers/src/lib/html-to-text.ts
- apps/workers/src/jobs/{extract-pricing,extract-jobs,extract-reviews,refresh-competitor-summary}.job.ts
- apps/api/src/lib/clickhouse-safe.ts

**Fichiers modifiés** :
- packages/db/{package.json, src/index.ts, src/schema/competitors.ts}
- packages/ai/src/index.ts (réexports)
- packages/scrapers/src/index.ts (getScraper map)
- apps/workers/src/lib/clickhouse.ts (insertPricingHistory + insertJobCounts + insertReviewScore)
- apps/workers/src/jobs/scrape-monitor.job.ts (routing surgical après création snapshot)
- apps/api/src/routes/competitors.ts (helper + 6 sous-routes + enrichissement /:id)
- apps/web/src/lib/api.ts (types Competitor enrichis + 7 nouveaux endpoints + CompetitorSignal)
- apps/web/src/app/dashboard/competitors/[id]/page.tsx (réécriture complète)
- apps/web/package.json (+ recharts)

**Décisions notables** :
- Client ClickHouse partagé via proxy lazy → API + script + workers
- Workers gardent leur impl spécifique (logger Trigger.dev, insertBestEffort)
- chQuery best-effort retourne [] si CLICKHOUSE_URL absent → UI fonctionne sans CH
- Reviews praises/complaints stockés dans reviews.author = "praise"|"complaint"
  (pas de schema change Phase 5 — à normaliser plus tard)
- G2 / Capterra forcés via ScrapingBee premium_proxy + render_js
- Tabs custom (pas de @radix-ui/react-tabs) — design boutons + underline amber
- Routing scrape-monitor surgical : aucune logique existante touchée

**Tests** : pnpm build ✓ (7/7) | pnpm typecheck ✓ (7/7) | runtime à tester avec
GROQ + SCRAPINGBEE + CLICKHOUSE credentials

**Prochaine session** :
1. Provisionner ClickHouse Cloud + `pnpm ch:setup` (créé les 4 tables)
2. Sur un concurrent réel : ajouter monitors pricing + jobs + g2_reviews
3. Scraper manuellement → vérifier pricing_history alimenté, job_postings créés,
   reviews praises/complaints insérés
4. Déclencher refresh-competitor-summary → vérifier competitor.aiSummary rempli
5. Ouvrir la fiche → tous les onglets affichent des données + graphiques OK
6. Mesurer le taux de succès ScrapingBee sur G2/Capterra
7. Commencer Phase 6 — Battle Cards & Alertes

---

### 2026-05-25 — Phase 7 Monétisation

**Objectif** : Monétisation Stripe end-to-end — limites par plan, gating
des features premium, Stripe Checkout + Customer Portal + webhooks,
dashboard billing et paywalls contextuels. Landing page hors scope
(faite séparément avec Claude Design).

**Réalisé** :
- Étape 0 : Install stripe (apps/api) + STRIPE_* + WEB_URL placeholders
- Étape 1 : @outrival/shared/constants/plans.ts — PLAN_LIMITS, PLAN_PRICING,
  PLAN_LABELS, types Plan, BillingPeriod, AlertChannel, PlanFeature
- Étape 2 : apps/api/src/lib/plan.ts (helpers : quota, isFeatureAllowed,
  isSourceAllowed, isChannelAllowed, isFrequencyAllowed, getOrgPlan,
  countActiveCompetitors)
  + gating surgical sur 5 routes : POST /competitors, /onboarding/complete,
    /candidates/:id/add, /competitors/:id/battle-card/generate,
    PATCH /settings/notifications
  + gating dans workers/send-alert.job (realtimeAlerts + slack channel)
  → codes 403 structurés : plan_limit_competitors, plan_locked_feature,
    plan_locked_source, plan_locked_frequency, plan_locked_channel
- Étape 3a : organizations.stripeSubscriptionId + planPeriod (enum
  billing_period) → pnpm db:push
- Étape 3b : Stripe routes
  · apps/api/src/lib/stripe.ts : getStripe lazy + getPriceId +
    lookupPlanByPriceId
  · apps/api/src/routes/billing.ts : GET /, POST /checkout, POST /portal
  · apps/api/src/routes/stripe-webhook.ts : signature verify + 4 events
    (checkout.session.completed, customer.subscription.created/updated/deleted)
  · Mount AVANT les autres /api/* dans index.ts
- Étape 4 : UI billing
  · apps/web/src/lib/api.ts : ApiError class + types BillingInfo +
    endpoints getBilling, createCheckout, openPortal
  · apps/web/src/components/outrival/billing-dashboard.tsx (Client) :
    plan actuel + barre usage + tableau 4 plans + toggle monthly/yearly
    + boutons "Passer à X" / "Gérer mon abonnement" + ?status=success toast
  · apps/web/src/app/dashboard/settings/billing/page.tsx (Server wrapper)
  · settings/page.tsx : section "Abonnement" avec lien card vers billing
- Étape 5 : Paywalls
  · apps/web/src/components/outrival/paywall-dialog.tsx + paywallFromError(err)
  · Branchés sur 5 call sites : createCompetitor, completeOnboarding,
    addCandidate, generateBattleCard, updateNotificationSettings
- Étape 6 : pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- Étape 7 : Mise à jour planning (task_plan.md, findings.md, progress.md)

**Fichiers créés** :
- packages/shared/src/constants/plans.ts
- apps/api/src/lib/plan.ts
- apps/api/src/lib/stripe.ts
- apps/api/src/routes/billing.ts
- apps/api/src/routes/stripe-webhook.ts
- apps/web/src/app/dashboard/settings/billing/page.tsx
- apps/web/src/components/outrival/billing-dashboard.tsx
- apps/web/src/components/outrival/paywall-dialog.tsx

**Fichiers modifiés** :
- .env.example (STRIPE_PRICE_*, WEB_URL)
- packages/shared/src/index.ts (re-export plans)
- packages/db/src/schema/organizations.ts (+ stripeSubscriptionId, planPeriod, billingPeriodEnum)
- apps/api/src/index.ts (mount billing + stripe-webhook AVANT autres routes)
- apps/api/src/routes/competitors.ts (gating POST /)
- apps/api/src/routes/onboarding.ts (gating POST /complete)
- apps/api/src/routes/candidates.ts (gating POST /:id/add)
- apps/api/src/routes/battle-cards.ts (gating POST /:id/battle-card/generate)
- apps/api/src/routes/settings.ts (gating PATCH /notifications - slack channel)
- apps/api/package.json (+ stripe)
- apps/workers/src/jobs/send-alert.job.ts (gating notif RT + slack channel)
- apps/web/src/lib/api.ts (ApiError + BillingInfo + billing endpoints)
- apps/web/src/app/dashboard/settings/page.tsx (section Abonnement)
- apps/web/src/app/dashboard/competitors/page.tsx (paywall createCompetitor)
- apps/web/src/app/dashboard/candidates/page.tsx (paywall addCandidate)
- apps/web/src/app/(onboarding)/onboarding/page.tsx (paywall completeOnboarding)
- apps/web/src/components/outrival/battle-card-tab.tsx (paywall generateBattleCard)
- apps/web/src/components/outrival/notification-settings-form.tsx (paywall update)

**Décisions notables** :
- Stripe SDK v22 + TS NodeNext : utiliser InstanceType + Extract pour
  inférer les types (le namespace `Stripe.X` n'est pas accessible en CJS)
- `apiVersion: "2026-04-22.dahlia"` (la dernière supportée par v22.1.1)
- Mapping price ↔ plan/period piloté à 100% par les env vars STRIPE_PRICE_*
  → ajout/changement de prix = pas de code, juste env
- Webhook signature-verified, hors authMiddleware, monté avant /api/*
- `business.maxCompetitors = Number.POSITIVE_INFINITY` → API renvoie
  `limit: null` (JSON-safe), UI affiche "illimité"
- ApiError côté web porte le code structuré + payload → paywallFromError
  retourne null pour les non-paywalls (fallback erreur classique)
- PaywallDialog unique avec switch sur code → maps FEATURE/SOURCE/CHANNEL_LABEL
  pour ajouter une nouvelle source = 1 ligne
- Gating send-alert surgical : 3 if blocks, pas de refacto du job

**Tests** : pnpm build ✓ (7/7) | pnpm typecheck ✓ (7/7) | runtime E2E
à faire avec vraies clés Stripe test + price IDs créés manuellement

**Prochaine session** :
1. Créer dans Stripe Dashboard (mode test) : 3 produits Starter/Pro/Business
   avec prix monthly + yearly chacun (6 prix au total)
2. Coller les price IDs dans .env.local (STRIPE_PRICE_*)
3. Configurer le webhook Stripe (URL : https://<api>/api/stripe/webhook
   en prod ou via Stripe CLI en local) → coller STRIPE_WEBHOOK_SECRET
4. Test E2E :
   a. Compte free : ajouter 2 concurrents OK, 3e → paywall
   b. Tenter de générer une battle card en free → paywall
   c. Aller dans /dashboard/settings/billing → souscrire au plan Pro
      (carte test 4242 4242 4242 4242)
   d. Au retour : org.plan = pro (via webhook subscription.created/updated)
   e. Vérifier qu'on peut ajouter jusqu'à 15 concurrents
   f. Vérifier que battle cards + sources reviews sont débloquées
   g. Customer Portal → annuler l'abonnement → org.plan repasse en free
5. Hand-off à Claude Design pour landing page + polish global

---

### 2026-05-25 — Phase 6 Battle Cards & Alertes

**Objectif** : Battle cards IA exportables en PDF, alertes in-app temps-réel via SSE
(DB-backed, pas Upstash), détection hebdo de nouveaux concurrents avec flow candidat.

**Réalisé** :
- Étape 1 : 3 nouvelles tables Postgres + enums (battle_cards, notifications + type enum,
  competitor_candidates + status enum) → db:push appliqué
- Étape 2 : @outrival/ai : generateBattleCard (Groq AI_CONFIG.insights, Zod schema 6 sections,
  prompt XML structuré, maxTokens 2048)
- Étape 3 : Workers : generate-battle-card.job + lib/battle-card-html.ts
  (template A4 dark/amber printable) + Playwright PDF → upload R2
  · getBytesFromR2 ajouté à @outrival/shared (Uint8Array pour binaires)
  · playwright ajouté en dep directe d'apps/workers (pnpm strict)
- Étape 4 : API : 4 routes /api/competitors/:id/battle-card (GET, generate, PATCH content, GET pdf)
  · Router séparé monté à /api/competitors à côté du competitorsRouter (Hono dispatche par chemin)
- Étape 5 : UI : composant BattleCardTab + ajout onglet "Battle Card" dans fiche concurrent
  · Modes view/edit, polling 3s pendant génération, DL PDF, régénérer
- Étape 6 : Notifications SSE :
  · send-alert.job : 7 lignes ajoutées pour insert notifications (surgical)
  · routes/notifications.ts (list, unread-count, read/:id, read-all, stream)
  · streamSSE Hono + poll DB 3s + onAbort + heartbeat
  · components/notifications-bell.tsx (badge + dropdown + toast + EventSource)
  · Header ajouté au dashboard layout (au-dessus du main)
- Étape 7 : detect-new-competitors.job (schedules.task, cron 0 20 * * 0) :
  · Loop orgs onboardées → findSimilarCompanies → dedup URL+hostname
  · scoreOverlap → insert candidate + notification si overlap > 65
  · routes/candidates.ts (list filter status, add, dismiss)
  · /dashboard/candidates page + entrée sidebar "Détections"
- Étape 8 : pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)

**Fichiers créés** :
- packages/db/src/schema/{battle_cards,notifications,competitor_candidates}.ts
- packages/ai/src/tasks/battle-card.ts
- apps/workers/src/jobs/{generate-battle-card,detect-new-competitors}.job.ts
- apps/workers/src/lib/battle-card-html.ts
- apps/api/src/routes/{battle-cards,notifications,candidates}.ts
- apps/web/src/components/outrival/{battle-card-tab,notifications-bell}.tsx
- apps/web/src/app/dashboard/candidates/page.tsx

**Fichiers modifiés** :
- packages/db/src/schema/index.ts (+3 exports)
- packages/shared/src/r2/client.ts (+ getBytesFromR2)
- packages/ai/src/index.ts (réexports battle card)
- apps/workers/src/jobs/send-alert.job.ts (insert notification surgical)
- apps/workers/package.json (+ playwright dep)
- apps/api/src/index.ts (3 nouveaux mounts)
- apps/web/src/lib/api.ts (types + endpoints battle card + candidates)
- apps/web/src/app/dashboard/competitors/[id]/page.tsx (onglet Battle Card)
- apps/web/src/app/dashboard/layout.tsx (header + NotificationsBell + nav Détections)

**Décisions notables** :
- SSE DB-backed (poll 3s) plutôt qu'Upstash pub/sub — latence ok, gratuit, sur VPS
- PDF Playwright in-process (browser launch + close per job) — Trigger.dev extension
  playwright déjà configurée pour les scrapers
- Battle card content = jsonb editable, PDF non-régénéré auto (bouton "Régénérer" séparé)
- Dedup candidates : URL exacte + hostname normalisé (sans www) — Exa varie les formats
- Cron `0 20 * * 0` (dim 20h UTC) pour detect-new-competitors
- Notification creation surgical : 7 lignes dans send-alert (avant Slack/email)
- Battle cards générées via Groq llama-3.3-70b (AI_CONFIG.insights) — swap Claude
  Sonnet via 1 ligne config si besoin de qualité premium plus tard

**Tests** : pnpm build ✓ (7/7) | pnpm typecheck ✓ (7/7) | runtime à tester avec
GROQ + R2 + EXA + DB credentials

**Prochaine session** :
1. Test E2E : sur un concurrent enrichi, générer battle card → vérifier contenu cohérent
2. Éditer une section → sauvegarde OK, PDF inchangé jusqu'à "Régénérer"
3. Télécharger le PDF → ouvrir → vérifier le rendu A4 (sections, branding)
4. Déclencher un signal critical → vérifier l'apparition dans la cloche en ~3s + toast
5. Test "Marquer tout comme lu" + clic notif → navigation correcte
6. Déclencher manuellement detect-new-competitors → vérifier insert candidates +
   notification "new_competitor"
7. Ajouter un candidat → vérifier création competitor + 3 monitors + scrape initial
8. Re-déclencher detect-new-competitors → vérifier qu'on ne re-alerte PAS sur les
   candidats déjà vus
9. Mesurer stabilité SSE (durée connexion, reconnect EventSource)
10. Commencer Phase 7 — Monétisation (Stripe, free tier limits, landing page)

### 2026-05-31 — Patch-08 Onboarding par stade — implémenté (commits → utilisateur)

**Objectif** : refondre l'étape 1 de l'onboarding pour accepter 4 stades de projet
(idée / pitch document / repo GitHub / URL en ligne), tous convergeant vers le même
ProductProfile. Robustesse (fallback description), liberté (back-nav, reprise, skip),
confiance (mode document ZÉRO-STOCKAGE), continuité (page première session).

**Réalisé** :
- 4 adaptateurs ProductProfile purs (packages/ai/src/profile/) — type unique partagé
- routes API par mode + /progress + /skip + helpers github/extract-document découplés auth
- /analyze → /analyze-url (rename, 2 appelants web mis à jour)
- detectTemporaryUrl (shared) ; discovery rendue sans-URL (findSimilarCompanies null-safe)
- onboarding-form.tsx réécrit (5 écrans, persistance + reprise) + garde dashboard skip
- re-onboarding dans WorkspaceSettingsForm (concurrents préservés)
- zéro-stockage durci : sentry beforeSend + pino redact + audit code (aucune écriture)
- schéma : projectStage / onboardingStep / onboardingSkipped + db:push (applied)

**Fichiers nouveaux** :
- packages/ai/src/profile/{from-description,from-document,from-repo,from-url,index}.ts
- apps/api/src/lib/{github,extract-document}.ts
- apps/web/src/components/outrival/onboarding-banner.tsx

**Fichiers modifiés** :
- packages/db/src/schema/organizations.ts · packages/ai/src/index.ts
- packages/shared/src/{url,logger}.ts · packages/scrapers/src/discovery/discover.ts
- apps/api/src/routes/{onboarding,settings}.ts · apps/api/src/lib/sentry.ts
- apps/api/package.json (unpdf + mammoth)
- apps/web/src/lib/api.ts · apps/web/src/app/(onboarding)/onboarding/{page,onboarding-form}.tsx
- apps/web/src/app/dashboard/layout.tsx · apps/web/src/components/outrival/workspace-settings-form.tsx

**Décisions notables** :
- packages/ai PUR : fetch/extraction côté API, ai ne voit que texte/artefacts
- ProductProfile = type unique (pas de duplicat) ; fromUrl = wrapper sur analyzeProduct
- Mode Document zéro-stockage : in-memory only, bodyLimit 10MB, no-store, redact, beforeSend
- Resume : redirect dashboard si completed && step==="done" (laisse passer skip/re-onboard)
- 102 fichiers WIP non commités au démarrage → décision "j'implémente, tu commites" :
  AUCUN commit fait par Claude, staging/commit laissés à l'utilisateur

**Tests** : pnpm typecheck ✓ (7/7) | pnpm build ✓ (7/7) | 0 nouvelle erreur TS.
Runtime à tester (creds GROQ/EXA/R2/DB + auth) : 4 modes, fallback, skip, reprise,
re-onboarding, **vérif zéro-stockage live** (disque/R2/logs/Sentry après upload PDF).

**Prochaine session** :
1. Test E2E des 4 modes (idée / document / repo public / URL)
2. Vérif zéro-stockage live : upload PDF → find disque + bucket R2 + logs + Sentry = vide ;
   crash volontaire route document → Sentry sans contenu
3. URL temporaire (vercel preview) → warning ; skip → bannière dashboard
4. Re-onboarding depuis settings → concurrents préservés
5. Commits par étape (à faire par l'utilisateur, working tree à nettoyer)

---

## Patch-24 — Anti-hallucinations IA — COMPLETE (2026-06-02)

10 étapes, 9 commits (1380f01..8675b05). 5 couches de défense :
1. Grounding : groundedAiCall augmente le prompt (enveloppe {output,citations,confidence}),
   valide les citations vs source (fuzzy substring Levenshtein, seuil 0.85, sans dep).
2. Confidence scoring : low/medium/high self-reporté → tri + UI + déclenche self-check.
3. Self-check 2e passe : systématique battle cards, auto low-confidence, sampling 10%.
4. Transparence UI : ConfidenceDot (caché si high), AiOutputWarning (contenu préservé).
5. Review humaine : /admin/ai-review-queue + métriques /admin/ai + alerte Slack >3%/7j.

12 tasks migrées vers groundedAiCall. État mutable en Postgres ai_quality_checks
(ai_runs ClickHouse étendu append-only). _quality attaché non-enumerable (0 pollution jsonb).

Vérif : shared/db/ai/scrapers/api/workers typecheck clean ; web src clean ; next build
compile (seule erreur = artefact .next/types/validator.ts pré-existant, hors scope) ;
tests citations 8/8.

Reste optionnel (non bloquant) : per-candidate ConfidenceDot (discovery), ConfidenceDot sur
battle card/digest UI, rendu "removed" sur hallucination confirmée, persist des tasks
sans entité (classify/summary/verify/sectoral).
