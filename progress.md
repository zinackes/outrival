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

---

## Patch-27 — Données obsolètes : actions concrètes — IMPLÉMENTÉ (2026-06-03)

8 étapes (0→7) typecheck clean (shared/db/ai/scrapers/api/workers ✓ ; web = seul artefact
`.next/types/validator.ts` pré-existant). **Branche** `patch-27-stale-data-actions` (rebranchée
sur `patch-26-notification-moderation` après une fausse manip qui l'avait créée sur `main`,
très en retard). Décisions user : mapping option-1 + `github_repo→features` (features câblé) ·
limite re-scan **par user** · notif silent **in-app + email best-effort**.

**Nouveaux fichiers** :
- `packages/shared/src/staleness.ts` (4 états par type de source, env-overridable, mapping 12→6)
- `packages/db/src/schema/forced-rescan-log.ts`
- `apps/api/src/routes/...` → route ajoutée dans `monitors.ts` (pas de nouveau router)
- `apps/web/src/hooks/use-force-rescan.ts` + `components/outrival/monitor-freshness.tsx`
- `apps/workers/src/jobs/detect-silent-monitors.job.ts` (cron 0 8 * * *)
- `apps/web/src/app/(admin)/admin/monitors-health/page.tsx`

**Fichiers modifiés** : shared/index · db/schema/index · db/schema/notifications (enum
+silent_monitor) · api/routes/monitors (force-rescan + status) · api/lib/api.ts (web client) ·
api/routes/admin (endpoint monitors-health) · workers/scrape-monitor.job (payload + stamp log) ·
web freshness-dot.tsx (mode actionnable opt-in) · web competitor page (MonitorSources row) ·
admin-nav · .env.example · docs/architecture.md.

**Divergences spec corrigées** : `monitors` sans orgId/userId/status (join competitors, isActive,
lastRunAt) · notifications org-scoped (enum +silent_monitor, cooldown par org) · **bypass déjà
existant** via `force:true` (réutilisé, pas de nouveau flag) · `getOrgTier`=org.plan · dispatcher
ne fait que décider (création notif faite à la main) · lastSignal via join changes⋈signals ·
limite via count DB (Redis no-op sans Upstash).

**À FAIRE par l'utilisateur (laissé exprès)** :
1. `pnpm db:push` — applique `forced_rescan_log` (table) + `silent_monitor` (valeur d'enum).
   drizzle-kit push est interactif (peut prompter sur l'enum) + touche la DB prod → pas lancé.
2. Commits par étape (auto-committer concurrent → aucun commit fait par Claude).
3. Runtime à tester : tiers A–H de la carte (limite 429, bypass, toast contextuel, silent cron,
   dashboard admin). Item Notion → Done. TODO suite : page Notion "Repenser limites par tier".

---

## Patch-29 — Rework Settings & Navigation — IMPLÉMENTÉ (2026-06-03)

**Branche** `patch-29-rework-settings-navigation` (off `patch-28`). 13 commits perso (9ff4d72 →
a49b1a5) ; un commit design concurrent `ed1fdcd` + landing/* insérés par l'auto-committer
(skill impeccable, indépendants — pas embarqués dans mes commits). Typecheck web/api/shared
propre. **Aucun schéma DB** — pur frontend/nav + 1 endpoint liste. Les 3 erreurs TS web
(onboarding-form 284 · competitors/[id] 986 · products-settings 126) sont PRÉ-EXISTANTES
(patch-25/28), pas touchées.

**Code réel ≠ patch (remappé)** : tout sous `/dashboard/*` ; composants `components/dashboard/`
(sidebar/dashboard-shell/topbar/user-menu) ; pas de `useUser` ; UI **anglais** (mockups FR du
patch ignorés, rule language.md). Variante 1 = swap `AppSidebar↔SettingsSidebar` dans
`DashboardShell` (usePathname), même SidebarProvider/topbar/cookie.

**Décisions user** : phase nav d'abord (puis tout enchaîné) · alerts/digests = **préserver
l'accès** (alerts→301 Notifications + page supprimée ; digests garde sa vue + lien depuis
notifications/Cmd+K) · backend = câbler l'existant + stub le reste.

**Nouveaux fichiers** :
- `packages/shared/src/feature-flags.ts` (`FEATURE_FLAGS.multiUser=false`)
- `apps/api/src/routes/battle-cards.ts` → `battleCardsListRouter` (GET org-wide) monté
  `/api/battle-cards`
- `apps/web/src/components/dashboard/settings-sidebar.tsx`, `recent-battle-cards.tsx`
- `apps/web/src/components/outrival/{profile-settings-form,security-settings,integrations-settings,data-settings}.tsx`
- `apps/web/src/app/dashboard/battle-cards/page.tsx`
- `apps/web/src/app/dashboard/settings/{profile,security,integrations,api-keys,data,members}/page.tsx`

**Renommés / supprimés** : routes `my-product→products`, `candidates→discovery`,
`settings/workspace→settings/general` (git mv + 301) ; `settings-nav.tsx` supprimé (remplacé
par la sub-sidebar) ; page `/dashboard/alerts` supprimée (→301 notifications).

**Modifiés** : sidebar.tsx (rail rationalisée + footer Settings), dashboard-shell.tsx (swap),
topbar.tsx (titres), user-menu.tsx (Profile/Notifications/Settings/Logout), signals-view.tsx
(tab Alerts), overview.tsx (section), settings/layout.tsx (simplifié), settings/notifications
(2 tabs), settings/page.tsx (redirect general), lib/api.ts (BattleCardSummary + listBattleCards),
api/index.ts (mount), shared/index.ts (export flag), next.config.ts (4 redirects 301),
docs/architecture.md.

**Câblé (vrai backend)** : profile name (Better Auth updateUser), security sessions
(listSessions/revokeSession/revokeOtherSessions Better Auth — réels), data export (client-side
via listCompetitors/listSignals/getWorkspaceSettings), notifications (forms patch-26 existants),
battle-cards list (nouvel endpoint), integrations (AlertChannelsSheet existant).

**Stub / non câblé (suite)** : 2FA · API keys (placeholder) · data import · Delete workspace
(page danger = bouton disabled, pas de flow confirmation multi-étapes ni endpoint DELETE) ·
email change (RO) · password set · products/forced-rescans usage dans Subscription
(billing-dashboard couvre déjà plan+limites+competitors) · avatar upload · langue (English-only) ·
deep-link tab battle-card depuis la liste (linke la fiche).

**À FAIRE par l'utilisateur** :
1. Validation visuelle : `pnpm dev --filter @outrival/web` (WSL ne tient pas le dev complet).
   Checklist A–I de la carte Notion. Le `.next` périmé déplacé en `/tmp` (régénéré au dev).
2. Item Notion patch-29 → Done.

---

## 2026-07-19 — Runbook RS 1000 G12, Phases 5-6 (branche `feat/worker-deploy`, depuis `main`)

7 commits atomiques. `pnpm typecheck` + `pnpm test` (1171 pass / 0 fail, 12/12 tasks)
verts à chaque étape ; `docker build` OK ; smoke test exécuté pour de vrai contre un
Postgres 17 local.

- `dca1151` Étape 0 — pg-boss 12.24.1 → 12.26.1. Seul retrait de type : `JobOptions.keepUntil`
  (jamais utilisé ici). Reste additif (update/upsert, detectSchemaDrift). Lockfile scope-guardé :
  pg-boss + cron-parser uniquement, aucun fork de peer.
- `cbf9d0c` Étape 1 — options constructeur (`max:5`, `useListenNotify`, `superviseIntervalSeconds:60`,
  `monitorIntervalSeconds:120`) + `deleteAfterSeconds`/`notify` par queue + Slack sur `boss.on('error')`
  (throttle 5 min).
- `6829fd6` Étape 2 — heartbeat : alerte Slack après 3 échecs consécutifs, warning si `HEARTBEAT_URL`
  absent. Le dead-man switch reste le monitor externe.
- `9e2cf7e` Étape 3 — `Dockerfile.worker` (deps Node/pnpm → runtime bun, install scopé workers,
  Chromium via le binaire épinglé du workspace). 2,26 Go, USER bun, Chromium se lance.
- `af0dc8f` Étape 4 — `.github/workflows/deploy.yml`, déclenché sur succès de CI sur main.
- `a5f1e48` Étape 5 — `scripts/pgboss-smoke.ts`, exécuté : pickup médian 8 ms, drain 6 761 jobs/s.
- `acdf211` fix révélé par le smoke test — voir findings.md.

### Mesures réelles (Postgres 17 en conteneur local, pas le VPS)
| Mesure | Valeur |
|---|---|
| Pickup latency médiane (NOTIFY, backstop 30 s) | **8 ms** (p95 50 ms) |
| Insert 10 000 jobs | 541 ms (18 484 jobs/s) |
| Drain 10 000 (batch 50 + burst) | 1 479 ms (**6 761 jobs/s**) |
| Drain forme prod (batch 1, backstop 2 s) | ~5 jobs/s |
| Drain forme prod (batch 1, backstop 30 s — avant fix) | ~0,4 jobs/s |

### Reste à faire côté humain
- Créer les 2 secrets GitHub (`VPS_HOST`, `VPS_SSH_KEY`) + `docker login ghcr.io` sur le VPS.
- Écrire `/opt/outrival/docker-compose.yml` avec les services `worker-light` / `worker-browser`
  (noms attendus par deploy.yml) + `.env.worker`.
- Re-jouer le smoke test sur le VPS (Phase 9) pour obtenir les vrais chiffres de la box.

### 2026-07-30 — Pricing Intelligence v2, Phase 1/5 — signaux pricing déterministes

**Objectif** : promouvoir le diff plan-à-plan batch→batch (déjà calculé pour l'affichage
par `signal-facts.ts`) en générateur de SIGNAUX pricing déterministes typés — le pattern
des chemins « never miss » (cf. docs/signal-evidence-audit.md §1b). Carte Notion
« Pricing — Intelligence v2 », P1 uniquement.

**Réalisé** :
- `packages/shared/src/pricing-diff.ts` — module PUR `diffPricingBatches(prev, next)` →
  `PricingChange[]` typés : price_changed (pct + direction), plan_added, plan_removed,
  period_added, rate_changed (rows `usage`), included_quantity_changed (shrinkflation),
  trial_changed, free_plan_changed. Sévérités déterministes de la table de la card
  (undercut >15% → critical ; quantité ↓ à prix égal → high ; <3% → low). 34 tests.
  Liberté prise (documentée) : les rows `promotional=1` sont exclues des comparaisons de
  prix DES DEUX CÔTÉS, pas seulement côté next — sinon la fin d'une promo Black Friday
  se lirait comme une hausse de prix au scrape suivant.
- **Anti-doublon par transfert de propriété (race-free)** : scrape-monitor ne classifie
  plus un change pricing lui-même — il DÉFÈRE le changeId à extract-pricing
  (`ExtractPricingPayload.changeId` + `lexicalWorth`). Diff batch non-vide → signal
  déterministe (classification synthétisée, l'AI ne fait que narrer — pattern
  classify-structured) ; diff vide → fallback classifier lexical ssi
  `evaluateSignificance` l'avait jugé worth. Un enqueue parallèle aurait fait la course
  sur `signals.changeId` unique. Promo/repositioning gardent leur voie (le join par
  `snapshotAfterId` fait stand down le déterministe : « change owned elsewhere »).
- Émission dans `extract-pricing.ts` APRÈS `insertPricingHistory`, runs live uniquement
  (jamais `recordedAt`/backfill), jamais si `coverage_regression_guard` (mais fallback
  lexical préservé), jamais au premier scrape. Anchor = change déféré, sinon change
  synthétique sur le monitor pricing réel (pattern review_shift/hiring_shift).
  `routePricingSignal` ne throw JAMAIS (post-insert non-idempotent). Risque assumé,
  hérité de la card : sur le chemin synthétique (pas de change row), une dérive
  d'extracteur (renommage de plan par l'AI floor) peut fabriquer un plan_added/removed —
  à surveiller en dev avant d'élargir.
- `human_change_before/_after` exacts depuis les rows (« Pro — $79/mo » → « Pro — $59/mo »).
  Le diffText synthétique porte des price tokens → un critical pricing survit à
  `applySeverityGuard` (testé).
- `signal-facts.ts` (API) : PlanFact + `unit` / `includedQuantity` /
  `previousIncludedQuantity`, state `changed` sur mouvement de quantité, SQL enrichi ;
  fact block web (`signal-facts.tsx`) affiche « 10,000 → 5,000 API calls included,
  price unchanged ».
- `getPreviousPricing` sélectionne désormais unit/included_quantity/trial/free-plan
  (la baseline du diff doit porter ce que la batch fraîche porte).

**Fichiers modifiés** :
- packages/shared/src/pricing-diff.ts (+ .test.ts, + export index.ts) — NOUVEAU
- apps/workers/src/lib/pricing-signals.ts (+ test/pricing-signals.test.ts) — NOUVEAU
- apps/workers/src/core/extract-pricing.ts · scrape-monitor.ts
- apps/workers/src/lib/analytics.ts (getPreviousPricing élargi)
- packages/queue/src/jobs.ts (ExtractPricingPayload)
- apps/api/src/lib/signal-facts.ts · apps/web/src/lib/api.ts ·
  apps/web/src/components/outrival/signal-facts.tsx

**Tests** : pnpm typecheck ✓ (8/8) | shared 381 ✓ | workers 178 ✓ | api 225 ✓

**Prochaine session** : P2 — entitlements (`plan_entitlements` + catalogue de slugs +
extraction structured-first + volet Packaging). NE PAS commencer sans /clear.

### 2026-07-30 — Pricing Intelligence v2, Phase 2/5 — entitlements (features × plans)

**Objectif** : capturer la matrice features × plans (modèle Stigg), la differ, émettre
`entitlement_moved` / `entitlement_limit_changed` / `entitlement_added` / `entitlement_removed`,
et l'afficher (volet Packaging du pricing tab + section battle card). Branche
`feat/pricing-entitlements`, EMPILÉE sur `feat/pricing-deterministic-signals` (P1, PR #359
ouverte, pas mergée — P2 consomme diffPricingBatches/routePricingSignal).

**Réalisé** :
- Migration **0055** : `plan_entitlements` (id, competitor_id, plan_name, feature_slug,
  feature_label VERBATIM, kind boolean|config|metered, value_num/value_text/unit/
  reset_period, is_canonical, recorded_at) + index (competitor, recorded_at) et
  (competitor, feature_slug). `recorded_at` = LE même timestamp de batch que
  pricing_history du même run. ⚠️ PAS APPLIQUÉE : ce checkout n'a pas de `.env.local`
  → `pnpm db:migrate` à lancer sur l'env qui a la DB dev.
- `packages/shared/entitlement-catalog.ts` : ~40 slugs canoniques, alias
  EN/FR/DE/ES/IT/NL/PT (patron period-vocab : données + résolveur pur, zéro AI),
  `resolveFeatureSlug` → slug canonique ou slugify fallback `is_canonical=0`. 61 tests.
- `packages/shared/entitlement-diff.ts` : `diffEntitlements(prev, next, {planRank})` →
  `PricingChange[]` (types ajoutés à `PricingChangeType`). moved=high + sens
  down/upmarket (planRank dérivé des prix), limit ±30% medium/high, added low /
  removed medium. **Jamais critical** (testé). **Frontière de confiance** : moved/
  added/removed sur slugs CANONIQUES seulement — un slug free-text EST le wording du
  label, une reformulation marketing churnerait ; limit_changed accepte tout slug
  identique des deux côtés. Premier batch (prev vide) → []. 16 tests.
- Extraction table-first : `packages/scrapers/pricing/entitlement-table.ts` parse le
  `<table>` comparatif ANCRÉ sur les noms de plans déjà extraits (≥2 colonnes matchées,
  ≥3 feature rows sinon null — jamais un guess) ; ✓/✗/nombres (k/M)/unlimited/texte,
  aria-label des checks SVG, gotcha parse5 (tbody auto-inséré → header exclu par
  identité de nœud). Sinon tâche AI sœur `extract-entitlements` (labels verbatim,
  « Everything in Pro, plus… » jamais expansé — l'héritage n'est PAS modélisé en v1 ;
  1 call EN PLUS par scrape changé seulement). `pricing.scraper.ts` : `expandLists:true`
  → les accordions « See all features » se déplient au render (boucle jobs réutilisée).
- Worker (`lib/entitlements.ts` + intégration `core/extract-pricing.ts`, live only,
  jamais backfill) : substring-check CÔTÉ CODE (label absent du texte de page →
  droppé), caps 15 features × 6 plans loggés, anti-collapse
  (`isSuspectedEntitlementCollapse` : prev ≥5 && next <30% → rien écrit, zéro signal —
  extension de pricing-guard), slugs résolus, insert best-effort après
  insertPricingHistory (même recordedAt). Changes mergés dans `routePricingSignal`
  (`entitlementChanges` + `sortPricingChanges`) → UN signal par capture, top line =
  pire mouvement des deux axes. Étage ADDITIF : tout échec laisse le run pricing
  intact (try/catch). 11 tests workers.
- `signal-facts` (API) : `entitlements: EntitlementFact[]` sur le kind pricing —
  re-diff des 2 batches de la fenêtre par LE MÊME differ shared (l'évidence ne peut
  pas contredire le signal), before/after exacts (« SSO — Enterprise » → « SSO — Pro »).
  Rendu web dans le fact block (bloc « Packaging · N features moved »).
- UI : `GET /api/competitors/:id/entitlements` (2 derniers batches) ; volet
  **Packaging** du pricing tab (matrice, canoniques d'abord, cellules changées
  surlignées `bg-medium/10`, overflow-x, s'auto-masque sans matrice) ; section battle
  card **Packaging** (3-5 lignes déterministes : features gated top-plan, échelle de
  seats, moves récents via le differ partagé, overlap self-profile — « not AI-written »
  affiché).

**Tests** : typecheck 8/8 ✓ | shared 458 ✓ | scrapers 740 ✓ | ai 175 ✓ | workers 189 ✓ | api 225 ✓

**Reste côté humain** : `pnpm db:migrate` (0055) sur l'env dev + prod (après merge) ·
vérifier en dev un concurrent à `<table>` comparatif (matrice + cellules surlignées au
2e scrape) puis un à cartes (chemin AI) · PR empilée sur #359.

**Prochaine session** : P3 — tiers / rate_structure / price_points computed.
NE PAS commencer sans /clear. (P4 calculator probe, P5 burn rates ensuite.)

### 2026-07-31 — Pricing Intelligence v2, Phase 3/5 — rate structures & cost model

**Objectif** : modéliser les paliers et structures de rate, calculer des coûts effectifs
à volumes de référence (déterministe, zéro AI), faire rentrer l'usage-based dans le
compare, brancher les signaux tier/minimum. Branche `feat/pricing-rate-structures`.

⚠️ **P2 n'avait jamais atteint `main`** : PR #361 a été mergée dans
`feat/pricing-deterministic-signals` (P1) à 21:30, alors que #359 (P1 → main) l'avait
été à 16:15. Les 8 commits entitlements étaient donc orphelins. Cette branche a été
rebasée sur `origin/main` et les porte avec P3.

**Réalisé** :
- Migrations **0056** (`pricing_history` += `rate_structure` / `minimum_amount` /
  `percentage_rate` ; tables `price_tiers` et `price_points` + index) et **0057**
  (`organizations.reference_volumes`). Tout nullable : une ligne subscription legacy
  est inchangée et ses colonnes vides ne sont pas une affirmation sur le plan.
- `packages/shared/unit-alias.ts` : ~26 meters canoniques, alias EN/FR/DE/ES/IT/NL/PT
  (patron period-vocab / entitlement-catalog : données + résolveur pur, zéro AI).
  `resolveMeterUnit` rend `{unit, canonical}` — un meter inconnu garde le wording de la
  page avec `canonical:false` et n'est **jamais deviné** vers un voisin. 13 tests.
- `packages/shared/cost-model.ts` : `costAtVolume` pur pour standard / graduated /
  volume / package + plancher `max(usage, minimum)`. L'arithmétique tourne sur les
  PLAFONDS de bande (`to_qty`), donc les deux notations qu'une page peut imprimer
  (« 10k–50k » et « 10 001–50 000 ») calculent à l'identique. `percentage` EXCLU : son
  meter est de l'argent. `validateTierSet` rejette un set INVALIDE EN ENTIER (jamais
  son préfixe valide) : une échelle à moitié lue calcule un coût faux avec assurance.
  38 tests (bords exacts, qty 0, bande infinie, minimum, fee d'entrée).
- Extraction (`packages/ai/extract-pricing.ts`) : zod + prompt étendus —
  `rate_structure`, `minimum_amount`, `percentage_rate`, `tiers[]`, `cost_examples[]`.
  maxTokens 1536 → 2048 (une réponse tronquée en plein tableau ne parse pas du tout).
- Worker `lib/rate-structures.ts` (pur, testé) : validation code-side, écriture des
  bandes (`price_tiers`) et des coûts aux 4 volumes preset (`price_points`,
  `method='computed_from_tiers'`). **Trois refus** : ladder invalide droppée entière ·
  aucun point sur un meter non normalisable · exemple chiffré cru seulement si SES DEUX
  nombres sont dans le texte de page (patron substring P2). Un plan hybride porte la
  souscription sur laquelle son meter s'appuie, sinon il se lit moins cher qu'il ne
  facture. Live only, jamais backfill, jamais après le coverage guard. 15 tests.
- `packages/shared/price-tier-diff.ts` : `diffPriceTiers` → `tier_boundary_moved`
  (HIGH — « 0–10k @ $0.10 » → « 0–5k @ $0.10 » : une hausse dont aucun nombre imprimé
  ne bouge) + `rate_changed` sur l'unit_price d'une bande (table de sévérité P1, baisse
  >15% = critical). Un rate n'est JAMAIS comparé à travers une bande déplacée. Ladder
  apparue sur un plan connu = silence (c'est l'extracteur qui lit enfin un tableau).
  14 tests.
- `diffPricingBatches` étendu : `minimum_introduced` / `minimum_changed` (medium) et
  `rate_changed` sur `percentage_rate`. Comparés seulement quand LES DEUX côtés portent
  le tampon `rate_structure` — sinon le 1er scrape post-deploy annoncerait un plancher
  présent depuis toujours. 8 tests ajoutés (40 au total, 32 d'origine intouchés).
- `signal-facts` : `tiers: TierFact[]` sur le kind pricing, re-diff des 2 batches par
  LE MÊME differ shared ; bloc web « Volume bands · N moves ».
- `packages/shared/pricing-model.ts` : `pricingModelOf` (badge flat / per_seat / usage /
  hybrid / credits), `meteredUnits`, `cheapestCostAtVolume`, `monthlyBaseFee` (réutilisé
  par le worker — une seule définition du fee de base).
- Compare : `GET /api/compare` rend `pricing.model` + `pricing.meters[]` (coûts calculés
  ON READ depuis la ladder capturée, donc changer les volumes du workspace ne
  re-scrape rien). `derive.ts` : `priceReading(col, rates, to, meter?)` — une colonne
  SANS prix subscription comparable entre dans la bande par son coût effectif, marquée
  (`meter` sur le reading, astérisque + légende + barre à opacité réduite + « read at
  10,000 requests/mo »). Sélecteur de volume dans la légende de la lens Price. Une
  colonne qui publie une souscription garde sa bande publiée. **Zéro régression** : les
  32 tests derive d'origine passent inchangés, + 10 nouveaux dont l'égalité stricte
  `priceScale(set, {meter})` === `priceScale(set)` sur un set subscription-only.
- Setting workspace `reference_volumes` (`GET/PATCH /api/settings/reference-volumes`,
  carte dans Settings → General) : liste {unit, qty}, meters canoniques seulement,
  vide = presets. Read-side pur.
- Pricing tab : section **Rate structure** (bandes dépliables, minimum, %),
  `GET /api/competitors/:id/rate-structures` (dernier batch seulement — la série
  complète est déjà l'endpoint pricing-history).

**Fichiers modifiés** : packages/db/schema/{analytics,organizations}.ts + migrations
0056/0057 · packages/shared/{unit-alias,cost-model,price-tier-diff,pricing-model,
pricing-diff}.ts · packages/ai/src/tasks/extract-pricing.ts · apps/workers/src/lib/
{rate-structures,analytics,pricing-signals}.ts + core/extract-pricing.ts ·
apps/api/src/{lib/signal-facts.ts,routes/{compare,competitors,settings}.ts} ·
apps/web/src/{lib/api.ts,lib/queries.ts,components/dashboard/compare/{derive.ts,
lenses.tsx},components/outrival/{signal-facts,reference-volumes-card}.tsx,
app/dashboard/competitors/[id]/competitor-detail/rate-structures.tsx}

**Tests** : typecheck 8/8 ✓ | pnpm test 12/12 ✓ (shared 510 · workers 204 · api 235 ·
web 42 derive dont 32 d'origine inchangés)

**Reste côté humain** : `pnpm db:migrate` sur dev (0055 + 0056 + 0057 — la dev DB
n'a aucune des trois) puis sur prod (0056 + 0057 seulement : **0055 y est déjà
appliquée** depuis le 2026-07-30, `db:migrate` la sautera) ·
vérifier en dev un concurrent à tableau de paliers (bandes dans le pricing tab, puis
`tier_boundary_moved` au scrape suivant si une borne bouge) · PR portant P2 + P3.

**Prochaine session** : P4 — calculator probe (Playwright) + burn rates. NE PAS
commencer sans /clear.

---

## Pricing Intelligence v2 — P4 : calculator probe (2026-07-31)

**Le problème** : une page pricing `dynamic` (calculateur) ne publie AUCUNE liste.
Son prix n'existe que comme la réponse de son calculateur à un volume, donc tout
l'étage d'extraction (structured → cache → heal → IA) n'a rien à extraire : ces
concurrents entraient dans la comparaison en « No pricing captured ». P4 mesure ce
prix en se servant du calculateur public comme un prospect, et écrit
`price_points(method='calculator_probe')` avec la preuve.

**Déclenchement** — `scrape-monitor` enqueue `probe-pricing-calculator` après une
capture pricing LIVE dont `status='dynamic'` ET `signals.hasCalculator` (donc jamais
sur une page qui dit juste « usage-based pricing » en prose, jamais sur backfill,
jamais sur le self). Dédup pg-boss `singletonKey: probe:{competitorId}` +
`singletonSeconds: 86400` = **1 probe/concurrent/jour** quelle que soit la cadence de
scrape. `retryLimit: 0` : un probe est une INTERACTION avec le site de quelqu'un
d'autre, pas un calcul — tous ses échecs (refus, login wall, sélecteurs morts, série
refusée) se reproduisent à l'identique 5 s plus tard. Le probe suivant EST le retry.

**Échelle de stratégie** — le contrôle est trouvé par heuristiques déterministes
(label résolu par `unit-alias` ; un meter non canonique ⇒ **skip complet**, unknown
n'est pas deviné), sinon par la spec cachée du concurrent (`calculator_specs`),
sinon par **un** AI-heal qui ne nomme que des SÉLECTEURS et qui est caché ensuite.
Le total est localisé en diffant le DOM avant/après un mouvement de contrôle :
l'élément dont le MONTANT change EST le total — et ce même mouvement prouve que le
contrôle pilote la page (sans ça, une série plate serait lue comme un prix plat).
Le mouvement de découverte va au bout de la plage demandée, pas au volume voisin :
un plancher mensuel affiche le même total à 1k et à 10k, donc un petit mouvement ne
prouve rien. Un total libellé à l'ANNÉE est refusé plutôt que divisé par 12.

**Endpoint : rejoué, après confirmation** — quand la page calcule côté serveur, le
JSON de son propre XHR devient la source du nombre : pas de formatage, pas de
compteur animé attrapé en cours de tween. Le 1er volume est TOUJOURS piloté et
screenshoté au navigateur ; les suivants sont demandés à cet endpoint en HTTP,
**navigateur fermé** (`strategy=endpoint_replay`).

Décidé sur mesure, pas sur intuition : **38 concurrents `dynamic` sur 172 en prod**
(compté le 2026-07-31), soit ~36 probes/jour en série sur le worker browser qui fait
déjà tourner scrape-monitor à 3 en parallèle sur 8 Go. Quatre garde-fous font que
ce n'est pas « forger des requêtes sur une API privée » : (1) la requête n'est pas
inventée, c'est celle que la PAGE a émise pendant qu'on bougeait son curseur, avec un
seul nombre changé ; (2) GET même-origine dont la quantité est dans la query ; (3)
aucun credential créé, et un en-tête Authorization fait refuser le replay plutôt que
le re-signer ; (4) **confirmation obligatoire** — l'endpoint doit répondre au volume
ancre le montant que le calculateur venait d'afficher, sinon le run finit dans l'UI.
Cette confirmation sert aussi de double lecture (deux transports indépendants).

**La preuve suit le transport** : `price_points.evidence_key` + `evidence_kind` —
`screenshot` (la frame lue) ou `api_response` (requête + corps + chemin du montant +
le couple ancre contre lequel il a été confirmé). Le run garde en plus
`calculator_probe_runs.anchor_screenshot_key`, donc un run rejoué montre toujours la
session réellement ouverte. Renommage fait pendant que 0058 n'était appliquée nulle
part — ça ne serait plus jamais gratuit.

**Jamais un succès vide** — `validateProbeSeries` (@outrival/shared, pur) : monotonie
(égalité tolérée en zone plate/minimum), devise unique, bornes plausibles, et
**double lecture** (bouger le contrôle ailleurs, revenir, redemander la même quantité
→ même total ±0,5 %). Un seul check en échec droppe le run **entier** : une série
crue à moitié calcule une courbe de coût fausse avec assurance. Idem pour la preuve —
un point dont le screenshot n'a pas pu être stocké fait tomber le run.

**Doctrine** — robots.txt avant la 1re requête, UA OutrivalBot, rythme humain
randomisé entre interactions, ~15 interactions max, 90 s de budget. Bannière de
consentement = clic sur SON bouton visible (jamais un cookie posé à sa place, jamais
un noeud supprimé). Captcha / login / paywall / non-2xx = abandon **silencieux** :
le pipeline pricing du jour reste un succès, et `calculator_probe_runs` porte la
raison exacte (sinon « on mesure les calculateurs » serait indiscernable de « on n'y
arrive jamais »).

**Lecture** — au (unit, qty) ÉGAL, le mesuré prime sur le calculé dans
`cheapestCostAtVolume` : le calculé est notre arithmétique sur ce que la page
imprime, le mesuré est la réponse de leur propre calculateur (frais, planchers et
allocations incluses). Cheapest-wins arbitre entre plans PUBLIÉS, pas entre deux
natures de preuve. `comparableMeters` unionne les meters publiés et mesurés — sans
ça, un concurrent 100 % calculateur (aucune ligne `usage` publiée) aurait été mesuré
puis jamais affiché ; compare lui fabrique aussi un `PricingDetail` quand il n'a
aucun plan publié.

**Signal** — delta probe-à-probe à quantité égale ≥5 % → `rate_changed` medium,
≥15 % → high, **jamais critical** (critical bypasse toute la modération et envoie un
email en minutes ; une lecture d'UI n'a pas cette certitude). Ancre synthétique
`pricing_probe` (source_type dédiée : écrire ces snapshots sur le monitor `pricing`
casserait sa dédup par content-hash) → snapshot → change → `generate-signal`.
`human_change_before/_after` = les coûts mesurés exacts (« $80.00 at 100,000 requests
→ $64.00 at 100,000 requests »).

**UI** — indicateur de méthode sur chaque point : lens Price du compare (« measured on
their calculator <date> » vs « computed from their published tiers » + lien
screenshot) et bloc **Cost at volume** du pricing tab. Aucune nouvelle tab. Le
screenshot passe par `GET /api/competitors/:id/calculator-evidence?unit&qty`
(org-scopé, proxy — la clé R2 ne quitte jamais le serveur, comme le visual diff).

**Fichiers** : `packages/shared/src/{calculator-probe,pricing-model,extraction/
calculator-spec}.ts` · `packages/scrapers/src/pricing/calculator/{controls,readings,
endpoint,probe}.ts` + fixtures · `packages/ai/src/tasks/generate-calculator-spec.ts` ·
`packages/db/src/schema/{calculator-specs,analytics,monitors}.ts` + migration **0058**
(colonne `price_points.evidence_screenshot_key`, tables `calculator_specs` /
`calculator_probe_runs`, valeur d'enum `pricing_probe`) · `packages/queue/src/jobs.ts` ·
`apps/workers/src/core/{probe-pricing-calculator,scrape-monitor}.ts` +
`lib/analytics.ts` + `queue/handlers.ts` · `apps/api/src/routes/{compare,competitors}.ts` ·
`apps/web/src/{lib/api.ts,components/dashboard/compare/{derive.ts,lenses.tsx},
app/dashboard/competitors/[id]/competitor-detail/rate-structures.tsx,lib/source-labels.ts}`.

**Deux pièges d'exécution corrigés en passant** : (1) `settle()` déclarait un total
« stabilisé » sur deux lectures égales — juste après un mouvement, la page affiche
encore l'ANCIEN total, donc un poller rapide lisait deux fois la réponse
PRÉCÉDENTE (le recompute debouncé 200-500 ms est la norme). Un plancher
`PRICING_PROBE_SETTLE_MIN_MS` (700 ms) précède désormais le test de stabilité.
(2) Les constantes d'env étaient lues au CHARGEMENT du module : un importeur qui
les pose (le test) arrivait après, donc elles étaient silencieusement ignorées et
chaque probe payait les 2 s de courtoisie inter-domaine prévues pour un vrai site
(fichier de test à 68 s, puis timeout sous charge parallèle). Lues par appel, +
un module d'env importé en premier côté test : 25 s, stable.

**Tests** : typecheck 8/8 ✓ · `pnpm test` 12/12 ✓. 49 tests neufs, dont **9 qui
pilotent un vrai Chromium** — en **opt-in** (`pnpm --filter @outrival/scrapers
test:probe`, `PROBE_LIVE_TESTS=1`), sautés dans la suite par défaut : seuls, ils
passent en ~28 s, mais lancer 9 Chromium pendant que turbo fait tourner 7 packages
en parallèle sur 4 cœurs faisait dépasser n'importe quel timeout (mesuré : un simple
`chromium.launch` à plus de 2 min). Un test correct qui rougit apprend à ignorer la
suite. Ce que ces 9 tests couvrent en propre reste testé à côté (controls / readings
/ endpoint / replay + validateProbeSeries) ; eux seuls prouvent le bout-en-bout
navigateur, à lancer avant de toucher `probe.ts` et à mettre dans son propre lane CI.
Corrigé au passage, côté produit : le budget du probe est devenu un MUR (course
autour du run entier, lancement du navigateur compris) — il n'était vérifié qu'ENTRE
les étapes, donc chaque étape restait non bornée et un probe pouvait garder un slot
de worker browser indéfiniment. Les fixtures couvrent (slider + total JS, endpoint JSON rejoué en HTTP avec preuves mixtes
screenshot/api_response, endpoint protégé par un check Referer ⇒ retombe dans l'UI,
série décroissante ⇒ drop, unité non résolue ⇒ skip, bannière de consentement, double
lecture divergente ⇒ drop, spec cachée rejouée, page absente ⇒ refus). Piège corrigé
au passage : le plan de replay doit être construit sur la requête du volume ANCRE, pas
sur celle du mouvement de découverte — sinon on cherche la quantité d'ancre dans une
URL qui ne l'a jamais portée et toute page à endpoint retombe silencieusement dans
l'UI. Effet de bord corrigé : `scrape-patchright-pool.test.ts`
mockait `playwright` **globalement** (mock.module s'applique au chargement et ne se
désenregistre pas), donc le premier test à vouloir un vrai navigateur recevait un faux
— le mock est devenu un passthrough actif seulement pendant ce fichier, avec le
`launch` réel capturé par `bind` AVANT le mock (sinon récursion infinie).

**Reste côté humain** : `pnpm db:migrate` (0058) sur dev puis prod · vérifier en dev
sur un concurrent à calculateur réel que les points apparaissent avec leur screenshot ·
PR. **NE PAS** enchaîner sur P5 (burn rates, courbe de coût, backfill Wayback) sans
/clear.

---

### 2026-07-31 — Hiring Intelligence v2 — P1 (JD capture + mining) — 1 session

**Objectif** : capturer les corps de JDs (déjà téléchargés dans les réponses ATS,
jetés faute de colonne) et les miner en facts SOURCÉS → signaux `tech_adoption` +
`product_hint`. Phase 1/5 uniquement, rien touché des phases 2-5.

**Réalisé** :
- **Migration 0059** : `job_postings += description_text, remote_mode,
  employment_type, facts_mined_at` · nouvelle table `posting_facts` · nouvelle
  valeur d'enum `source_type = 'job_facts'`.
- **Capture des corps, zéro requête en plus** : mapping par provider dans `ats.ts`
  — Greenhouse (`content`, déjà fetché `content=true`), Lever (`descriptionPlain` +
  les `lists` qui portent le vrai contenu), Ashby (`descriptionPlain`), Workable
  (`description`/`requirements`/`benefits`, déjà `details=true`), Recruitee,
  Personio (sections `<jobDescription>`). Workday/iCIMS/SmartRecruiters/WTTJ ne
  portent pas de corps dans leur payload de liste → `null`, jamais une chaîne vide.
  Best-effort strict : aucun corps manquant ne peut faire échouer un provider.
- **Extracteur batché** (`packages/ai/src/tasks/mine-job-facts.ts`) : ~10 JDs par
  appel, buckets engineering/product/data_ml, NOUVELLES postings seulement, cap 40
  JDs/run, loggé `ai_runs` (`mine_job_facts`).
- **Les 3 gardes sont du CODE, pas du prompt** (`jobs/jd-facts.ts`, pur, 18 tests) :
  (a) substring-check — un `evidence_snippet` absent de la JD droppe le fact ;
  (b) pré-filtre de nouveauté EN+FR+DE — pas de phrase de nouveauté ⇒ aucun
  `product_hint` retenu ; (c) 5 facts max par posting.
- **Signaux** : `tech_adoption` déterministe (même techno sur ≥2 postings distinctes
  → product/medium, une seule fois par techno via `signalled_at`) · `product_hint`
  medium, promu high seulement si corroboré (2e posting ou delta subdomains/docs/
  changelog < 30j) et jamais sur la 1re capture jobs. Anchor `job_facts` DÉDIÉ : la
  chaîne de snapshots de `hiring_shift` porte le hash de dédup de la vélocité.
- **UI** : badges facts sur les postings du Hiring tab (snippet en `title`,
  `product_hint` teinté) + bloc de facts sur le signal, snippet verbatim entre
  guillemets et lien cliquable vers l'annonce.
- **Régression évitée au passage** : `GET /:id/jobs` faisait un `SELECT *` — avec
  `description_text` il aurait expédié jusqu'à 15 ko de prose par poste au
  navigateur. Passé en colonnes explicites.

**Fichiers modifiés** : packages/db/src/schema/{job_postings,posting-facts,monitors,
index}.ts + migration 0059 · packages/shared/src/{constants/sources.ts,sources/
catalog.ts} · packages/scrapers/src/jobs/{jd-facts.ts,ats.ts} + package.json ·
packages/ai/src/tasks/mine-job-facts.ts + index.ts · packages/queue/src/jobs.ts ·
apps/workers/src/{core/{extract-jobs,mine-job-facts}.ts,queue/handlers.ts,
jobs/mine-job-facts.job.ts} · apps/api/src/{lib/signal-facts.ts,routes/
competitors.ts} · apps/web/src/{lib/{api,source-labels}.ts,components/outrival/
signal-facts.tsx,app/dashboard/competitors/[id]/competitor-detail/hiring-tab.tsx}

**Tests** : typecheck 8/8 ✓ | pnpm test 12/12 ✓ (scrapers 126 dont 18 jd-facts
neufs + 8 fixtures JD multi-providers · api 249)

**Reste côté humain** : `pnpm db:migrate` sur dev puis prod (0059) · vérifier en dev
sur un concurrent à board Greenhouse/Lever que les badges apparaissent après un
re-scan jobs, puis qu'un `tech_adoption` sort quand 2 postings citent la même techno.

**Prochaine session** : P2 — géo offline (recherche préalable des briques GeoNames /
`all-the-cities` / `i18n-iso-countries`), `country_code` + `hiring_geo`,
`first_role_in_country` / `new_department_opened` / `hiring_freeze`. NE PAS commencer
sans /clear.
## Pricing Intelligence v2 — P5 : burn rates, courbe de coût, backfill Wayback (2026-07-31)

**La phase qui clôt la card.** Trois choses que le pricing layer ne savait pas dire :
ce qu'une action COÛTE en crédits, ce qu'un concurrent coûte à un volume AUTRE que
les quatre presets, et ce qu'il coûtait AVANT qu'on commence à le regarder.

### 1. Burn rates — la hausse de prix que personne n'imprime

Un produit qui vend des crédits a **deux** prix, et un seul est un nombre sur la page :
ce que coûte un pack, et ce que DÉPENSE une action. Doubler « 1 scan = 1 crédit » divise
par deux ce que le même argent achète, pendant que toutes les colonnes de prix du produit
continuent d'afficher « inchangé ».

- **Table** `credit_burn_rates` (competitor, action VERBATIM, credits, recorded_at =
  le MÊME timestamp de batch que `pricing_history` du run). Migration **0060** (renumérotée au merge : #380 a pris 0059).
- **Extraction** : `credit_burns[{action, credits}]` optionnel sur le zod
  `extract-pricing` — les burns voyagent dans la réponse de l'extraction pricing,
  donc **zéro token supplémentaire**. Conséquence assumée : une page résolue par un
  étage moins cher (structured-first, parser caché, harvest) ne publie aucun burn,
  ce qui se lit « on n'a pas vu de mapping », jamais « le mapping est vide ».
- **Grounding CÔTÉ CODE, en deux portes** (`lib/credit-burns.ts`) : (1) le libellé
  verbatim de l'action doit exister dans le texte de la page ; (2) le chiffre de
  crédits doit être imprimé **en tant que nombre à lui**, dans une fenêtre de 160
  caractères autour de ce libellé. La 2e porte est celle qui compte : un `indexOf`
  nu trouvait « 5 » dans « $599 » et « 1 » dans « 1,000 credits for $99 », donc tout
  petit burn rate se groundait tout seul contre le prix du pack deux lignes plus haut.
  C'est exactement la dérivation que la garde existe pour refuser. Trouvé PAR le test,
  pas avant.
- **Diff** (`packages/shared/src/credit-burn-diff.ts`, frère de `diffPricingBatches` /
  `diffEntitlements` / `diffPriceTiers`) : `credit_burn_changed` **HIGH à la hausse**
  (la hausse invisible), medium à la baisse ; `credit_action_added` / `_removed` low.
  Clé de jointure = le wording de la page, insensible à la casse et aux espaces, et
  rien de plus : un stemming ou des synonymes devineraient que deux actions
  différemment nommées sont la même, et un mauvais match invente un changement de
  taux à partir d'une reformulation. Un côté vide → `[]` (une page qu'on a ratée
  n'est pas un produit qui a cessé de facturer en crédits).
- **Signal** : mêmes règles que P1 exactement — mergé dans le MÊME signal déterministe
  via `routePricingSignal({creditBurnChanges})`, live only, jamais sur backfill,
  jamais sur un premier scrape. `human_change` exact : « OCR — 5 credits » →
  « OCR — 8 credits ».
- **UI** : bloc **Credits** dans le pricing tab (sous Cost at volume), action → coût,
  delta surligné vs le batch précédent avec le sens (`up from` en `text-high`).

### 2. Courbe de coût — là où le classement s'inverse

La lens Price lisait chaque concurrent à **un** volume. Ça les classe en un point et
cache la seule chose qu'un acheteur cherche : où le classement bascule. Un concurrent
le moins cher à 1 000 requêtes est couramment le plus cher à un million.

- `buildCostCurve(rows, tiers, unit)` (`packages/shared/src/pricing-model.ts`) = le
  MÊME `cheapestCostAtVolume` posé à chaque point d'échantillonnage, donc la courbe et
  la ligne au-dessus d'elle ne peuvent pas se contredire.
- **Grille** : échelle 1-2-5 par décade de 1 à 10M, **plus les bornes de l'échelle que
  la page publie**. Les décades donnent une courbe régulière sur un axe log ; les
  bornes sont ce qui la rend VRAIE — une échelle graduated plie exactement là où une
  bande finit, et une courbe échantillonnée sur les seules décades tirerait une droite
  au travers du pli, en gommant le seul détail qu'on vient lire.
- **Les points mesurés (P4) ne sont PAS fondus dans la ligne.** Un probe répond à 4
  volumes ; les épisser dans une ligne calculée la plierait en 4 endroits arbitraires
  et présenterait le résultat comme un modèle continu. Ils se superposent en POINTS :
  plein = mesuré sur leur calculateur, creux = exemple chiffré que la page imprime,
  ligne = notre arithmétique sur leurs paliers. Trois claims, trois marques.
- **Auto-masquage** : un concurrent qui ne facture pas cette unité est ABSENT. Le
  dessiner à plat à son prix d'abonnement serait une affirmation (« voilà ce qu'ils
  coûtent à n'importe quel volume ») qu'il n'a pas faite.
- La courbe n'apparaît qu'à partir de **2** concurrents sur le meter : une ligne seule
  n'est pas une comparaison. Les volumes du workspace sont des repères verticaux.
- Découvert par le test : une échelle **`volume` n'est légitimement PAS monotone** —
  10 000 × $0,10 = $1 000 mais 10 001 × $0,05 = $500,05. Ce n'est ni un bug ni une
  chose à lisser : c'est la falaise qu'un acheteur juste sous une borne paie sans le
  savoir, et l'échantillonnage des bornes est ce qui la rend visible. L'assertion du
  test a été corrigée, pas le modèle.

### 3. Backfill Wayback du pricing — le cold start meurt

Un concurrent ajouté aujourd'hui affichait un point et une promesse. L'Archive détient
déjà trois ans de sa page pricing.

- **Job dédié** `backfill-pricing-history` (`@outrival/queue`, retryLimit 0,
  concurrency **1** — une seule conversation avec web.archive.org à la fois), déclenché
  par le hook backfill EXISTANT sur la première capture pricing. Commande manuelle dev :
  `POST /api/dev/competitors/:id/backfill-pricing` (`force`).
- **Séparé de `backfill-history` plutôt que grossi dedans**, et le seeding pricing lui
  est RETIRÉ : ce job-là interroge l'availability API « qu'y a-t-il de plus proche de
  cette date », un aller-retour par point, et ne peut pas voir que deux de ses points
  sont la même capture. Les laisser cohabiter écrivait deux fois le même batch.
  `backfill-history` garde son diff jour-0 ; l'historique de prix déménage.
  `BACKFILL_PRICING_OFFSETS_DAYS` disparaît.
- **Pipeline** : index CDX (**1** appel, `collapse=timestamp:6`) → `sampleQuarterly`
  (~1 capture/trimestre sur 3 ans, cap 12) → fetch séquentiel espacé → harvest
  déterministe D'ABORD → l'IA en secours **cappée à 4 appels pour TOUT le backfill**
  (au-delà, une capture est sautée, jamais à moitié lue) → `reconcileBillingPeriods` →
  `pricingRatiosPlausible` → `pricing_history(origin='archive')` au timestamp de la
  capture (+ `price_tiers` quand l'étage IA a lu une échelle).
- **L'échantillonnage est STABLE** (première capture du trimestre, pas la plus proche
  d'une cible mobile) : un 2e passage sélectionne les mêmes captures, donc le contrôle
  « j'ai déjà un batch à cette date » les attrape au lieu d'écrire un quasi-doublon.
  Une capture dont le digest est identique à la précédente gardée est sautée — l'Archive
  vient de nous dire que rien n'a bougé.
- **La garantie négative est la feature, et elle est mécanique** : un backfill complet
  écrit de l'historique et **rien d'autre** — aucune row `changes`, aucune row
  `signals`, aucun enqueue. C'est vérifié par test contre un vrai Postgres (PGlite) et
  une Archive mockée. Un signal jamais émis ne laisse aucune trace, donc cette
  garantie-là ne peut pas reposer sur la lecture du code.
- **Ce qui ne s'applique PAS** : le `coverage_regression_guard` ne tourne pas entre deux
  captures Wayback. Cette garde attrape un mé-parse de la page D'AUJOURD'HUI contre la
  capture d'hier. Deux captures à un trimestre d'écart sont des ÉPOQUES différentes :
  une page passée de six paliers à un sur ce trimestre est précisément l'histoire que ce
  job existe pour enregistrer, et la refuser comme un « collapse » supprimerait le point
  le plus intéressant du graphe. Le ratio par capture (`pricingRatiosPlausible`) tourne
  toujours — celui-là juge un batch contre LUI-MÊME, ce qui reste valide entre époques.
- **Politesse** : 1 appel d'index, cap dur de fetches, séquentiel + `PRICING_BACKFILL_GAP_MS`,
  timeout court, abandon silencieux par capture, aucun re-run automatique, jamais de retry.

### 4. `origin` — une règle, appliquée partout

`pricing_history.origin` et `price_tiers.origin` reprennent le vocabulaire de
`snapshots.origin`. Le besoin n'est pas cosmétique : le backfill part sur la PREMIÈRE
capture pricing, en parallèle de `extract-pricing`. Si cette extraction ne sort aucun
plan (page gatée, `parse_failed`), il n'existe aucun batch live — et les rows archive
gagnaient alors `max(recorded_at)`, donc toute la lecture « courant » affichait des prix
de 2024 comme actuels, sans marqueur.

**La règle : les rows archive alimentent la timeline, et rien d'autre.** Toute lecture
qui fait une affirmation — « ils facturent X », « leur prix d'entrée a bougé » — filtre
`origin='live'` : `getPreviousPricing` / `getPreviousPriceTiers`, compare, landscape,
signal-facts (cur ET prev), ask (roster + moves), activity, battle cards, products,
trends, la page competitor. **Une** exception, l'endpoint `/pricing-history`, où les rows
SONT l'affirmation — et là l'UI les marque : point creux, date de capture + « via
Internet Archive » dans le tooltip, et une légende qui n'apparaît que s'il y a quelque
chose à expliquer.

### Fichiers

`packages/db/src/schema/analytics.ts` + migration **0060** (`credit_burn_rates`,
`pricing_history.origin`, `price_tiers.origin`) · `packages/shared/src/{credit-burn-diff,
pricing-model,pricing-diff,index}.ts` · `packages/ai/src/tasks/extract-pricing.ts` +
`index.ts` · `packages/scrapers/src/backfill/{cdx,index}.ts` + `package.json` (subpath) ·
`apps/workers/src/lib/{credit-burns,analytics,pricing-signals}.ts` ·
`apps/workers/src/core/{extract-pricing,backfill-history,backfill-pricing-history}.ts` ·
`packages/queue/src/jobs.ts` + `apps/workers/src/queue/handlers.ts` ·
`apps/api/src/routes/{competitors,compare,dev,activity,battle-cards,products,trends}.ts` +
`lib/{landscape-data,signal-facts,ask/tools}.ts` ·
`apps/web/src/lib/{api,competitor-color}.ts` ·
`apps/web/src/components/dashboard/compare/{cost-curve,derive,lenses}.tsx` ·
`apps/web/src/app/dashboard/competitors/[id]/competitor-detail/{pricing-tab,rate-structures,
chart-line,charts}.tsx` · `.env.example` + `docs/architecture.md`.

### Tests

typecheck **8/8** ✓ · suites **shared 576 · api 249 · workers 225 · web 150**, 0 fail.
Neufs : diff burn rates (8), grounding burn rates (11, dont les deux cas qui ont fait
durcir la garde), CDX + échantillonnage trimestriel (10), courbe de coût (5, dont la
falaise `volume`), job de backfill contre PGlite + Archive mockée (10, dont la garantie
zéro-signal, la dédup à date égale, le cap IA atteint, la page illisible, la capture
implausible, la page de challenge, le self). Le test de `chart-dates` a été resserré :
il comparait la forme entière d'un point, ce qui cassait dès qu'un champ méta s'ajoutait ;
il assure maintenant l'intention (les tiers sur devis n'ajoutent pas de série).

### Reste côté humain

`pnpm db:migrate` (**0060**) sur dev puis prod · vérifier en dev sur un concurrent à crédits réel que le
bloc Credits se remplit, et sur un concurrent fraîchement ajouté que la timeline porte des
points creux · PR.

**La card « Pricing — Intelligence v2 » est COMPLÈTE** (P1 diff/signaux · P2 entitlements ·
P3 tiers + cost model + price_points + réglage workspace · P4 calculator probe + replay
d'endpoint · P5 burn rates + courbe de coût + backfill Wayback).
