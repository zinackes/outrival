# Task Plan — Outrival

Mis à jour automatiquement par Claude Code à chaque session.

## Phases du projet

- [x] Phase 0 — Scaffold monorepo (turbo, tsconfig, packages vides, CI vert)
- [x] Phase 1 — Foundation (monorepo, auth, DB schema, dashboard shell)
- [x] Phase 2 — Scraping Core (Crawlee, diff engine, change feed)
- [x] Phase 3 — Intelligence IA (Groq classify+insight+digest, alertes, cron)
- [x] Phase 4 — Competitor Discovery (Exa.ai, onboarding, overlap scoring)
- [x] Phase 5 — Enrichissement (jobs, reviews, pricing history, fiche complète)
- [x] Phase 6 — Battle Cards & Alertes (export PDF, alertes temps-réel SSE)
- [x] Phase 7 — Monétisation (Stripe, free tier limits, gating, paywalls)

## Phase en cours
Phases core terminées. Patch-04 (observabilité Sentry + pino + health checks)
appliqué le 2026-05-27. Reste landing page + polish global via Claude Design
(hors phases Claude Code).

## Patches appliqués

- [x] patch-01 — Scraping cost optimization (direct-first + adaptive reschedule)
- [x] patch-04 — Errors, logs & uptime (Sentry + pino + health checks profonds)
- [x] patch-03 — PostHog analytics + session replay (terminé 2026-05-27)
- [x] patch-05 — Widget feedback (terminé 2026-05-27)
- [~] patch-07 — Perf scraping (PARTIEL, 2026-05-31) : gzip R2 + conditional fetch
      (blog/changelog) faits. Étapes 2/4/5 (browser pool, undici, domain throttle)
      SKIP — no-op sur runtime Trigger.dev à machine isolée/run. Détails + à-revisiter
      dans findings.md § "Patch 07".
- [x] patch-08 — Onboarding par stade de projet (implémenté 2026-05-31 — complete)
- [ ] patch-02 — Admin ops (prochain — vue riche feedbacks + ops dashboard)

## Étapes patch-08 (implémentées 2026-05-31 — commits laissés à l'utilisateur)

Working tree avait 102 fichiers WIP non commités au démarrage → décision utilisateur
"j'implémente, tu commites". Aucun commit fait par Claude. Détails dans findings.md
§ "Patch-08".

- [x] 0 — deps unpdf@1.6.2 + mammoth@1.12.0 dans @outrival/api
- [x] 1 — schéma org : projectStage, onboardingStep, onboardingSkipped + db:push (applied)
- [x] 2 — packages/ai/src/profile/ : fromDescription/fromDocument/fromRepo/fromUrl (purs)
- [x] 3 — routes /analyze-{url,description,document,repo} + /progress + /skip + helpers
          lib/github.ts + lib/extract-document.ts ; /analyze→/analyze-url (rename)
- [x] 4 — detectTemporaryUrl dans packages/shared/src/url.ts
- [x] 5 — onboarding-form.tsx réécrit (5 écrans) + page.tsx (resume + redirect guard)
- [x] 6 — OnboardingBanner + garde dashboard (completed OU skipped)
- [x] 7 — section re-onboarding dans WorkspaceSettingsForm (concurrents préservés)
- [x] 8 — zéro-stockage : sentry beforeSend + pino redact (req.body/*.file) + audit code
- [x] 9 — logique analyze isolée de l'auth (helpers réutilisables) — documenté
- [x] 10 — typecheck 7/7 ✓ + build 7/7 ✓ ; test E2E runtime = manuel (creds requis)

### Décisions patch-08

- packages/ai reste PUR : fetch (quickFetch/unpdf/mammoth/GitHub) côté API, ai ne reçoit
  que texte/artefacts. fromUrl = wrapper typé sur analyzeProduct.
- ProductProfile = type UNIQUE (réexporté depuis tasks/analyze-product), pas de duplicat.
- Discovery sans URL : findSimilarCompanies(productUrl: string|null) — query sémantique
  pilote Exa, URL sert juste à exclure le domaine propre.
- Resume : redirect dashboard seulement si completed && step==="done" → laisse passer skip
  + re-onboarding. Liste de concurrents non persistée → resume discover re-run discovery.
- Re-onboarding logé dans WorkspaceSettingsForm (pas de page settings/profile dédiée).

## Étapes patch-05 (terminées 2026-05-27)

- [x] Étape 0 — pnpm add html2canvas --filter @outrival/web + env OPS_SLACK_WEBHOOK_URL
- [x] Étape 1 — Schéma DB : table feedback + enums type/status + db:push --force
              (drop simultané des colonnes orphelines patch-03 :
              changes.summary, monitors.last_failed_at, monitors.last_error)
- [x] Étape 2 — packages/shared/notify.ts : sendSlackMessage helper (silencieux)
- [x] Étape 3 — apps/web/src/lib/feedback/error-buffer.ts : buffer 20 entrées
              (window.error + unhandledrejection + console.error wrapper)
- [x] Étape 4 — apps/api/src/routes/feedback.ts :
              · POST authMiddleware + Zod (5000 chars + screenshot 2MB cap)
              · screenshot data URL → R2 (feedback/{id}/screenshot.{jpg|png})
              · sendSlackMessage best-effort vers OPS_SLACK_WEBHOOK_URL
              · GET owner-only (db.users.role === "owner")
- [x] Étape 5 — apps/web/src/components/outrival/feedback-widget.tsx :
              · Bouton flottant fixed bottom-right (MessageSquarePlus)
              · Dialog shadcn : 3 tabs (bug/idea/other) + textarea + checkbox
                screenshot + texte d'info auto-capture (pageUrl + erreurs)
              · html2canvas dynamic import + JPEG q=0.7 + cast `(mod.default ?? mod)`
              · toast sonner confirmation
              · initErrorBuffer() au mount (idempotent)
              · monté dans dashboard/layout.tsx
- [x] Étape 6 — pnpm typecheck 6/7 ✓ (web a toujours les 16 erreurs
              pré-existantes patch-03, 0 nouvelle erreur introduite par patch-05)

## Décisions patch-05

- `sendSlackMessage()` dans @outrival/shared/notify (api ne peut pas importer
  workers — règles monorepo). Silencieux par design : try/catch swallow,
  ne JAMAIS faire échouer le POST feedback à cause d'un Slack down
- OPS_SLACK_WEBHOOK_URL distinct des `organizations.slackWebhookUrl` des orgs.
  À remplir en prod avec un webhook ops perso (Slack workspace privé)
- R2 best-effort sur le screenshot : si l'upload fail, on continue sans
  (insert feedback row sans screenshotR2Key) — l'utilisateur a quand même
  envoyé son message
- Le screenshot est OPTIONNEL et désactivé par défaut. Texte d'info explicite
  dans la modal : "La page actuelle et les erreurs techniques récentes sont
  jointes automatiquement" → opt-in éclairé
- html2canvas en dynamic import pour ne pas peser sur le bundle initial
  (~50KB gzipped). Chargé seulement quand l'utilisateur clique "Joindre une
  capture" ET clique Envoyer
- Buffer console : 20 entrées max, message tronqué à 500 chars. Wrap
  console.error + listen window error/unhandledrejection. initErrorBuffer()
  protégé par `installed = true` flag → safe à appeler plusieurs fois
- drizzle.config.ts modifié : auto-load .env.local via dotenv + tablesFilter
  pour exclure les tables Better Auth (user/session/account/verification).
  Sans ça, db:push planté sur prompts TTY introuvables. Le `--force` lors du
  push a aussi dropé les 3 colonnes orphelines patch-03 (changes.summary,
  monitors.last_failed_at, monitors.last_error) — cleanup de dette ratifié
  par l'utilisateur
- Vue riche feedbacks (filtres, table, statuts) reportée à patch-02 (admin ops)
- 16 erreurs TS pré-existantes du web restent — out of scope patch-05

## Étapes patch-03 (terminées 2026-05-27)

- [x] Étape 0 — posthog-js (@outrival/web) + posthog-node (@outrival/api,
              @outrival/workers) + env vars stub NEXT_PUBLIC_POSTHOG_KEY/HOST
              + POSTHOG_API_KEY/HOST → eu.i.posthog.com
- [x] Étape 1 — apps/web/src/lib/consent.ts (cookie ph_consent 6 mois) +
              components/outrival/consent-banner.tsx (Accepter/Refuser, design neutre)
- [x] Étape 2 — apps/web/src/lib/posthog/provider.tsx (init Cloud EU,
              opt_out_capturing_by_default, person_profiles "identified_only",
              maskAllInputs + data-ph-mask) + pageview.tsx (manual App Router
              capture) + integration root layout avec Suspense +
              data-ph-mask sur billing/settings/email user-menu
- [x] Étape 3 — apps/web/src/lib/posthog/events.ts (track/identify/reset
              gated par has_opted_in_capturing) + identify-sync.tsx server-driven
              + identifyUser sur login/signup + posthog.reset() sur logout
              (user-menu + onboarding signout)
- [x] Étape 4 — 10 events funnel client : user_signed_up, onboarding_*
              (started/product_analyzed/competitors_found/completed),
              competitor_added, scrape_triggered, battle_card_generated,
              paywall_shown + paywall_cta_clicked centralisés dans PaywallDialog
- [x] Étape 5 — apps/api/src/lib/posthog.ts + plan_upgraded/plan_cancelled
              dans stripe-webhook (distinctId = owner user de l'org) +
              apps/workers/src/lib/posthog.ts + signal_generated dans
              generate-signal.job avec shutdownPostHog() en fin de run
- [x] Étape 6 — useFeatureFlagEnabled("kill-switch-discovery") sur
              handleProfileConfirm — bloque l'appel Exa avec message de fallback
- [x] Étape 7 — pnpm typecheck ✓ pour shared/db/ai/scrapers/api/workers (6/7)
              · @outrival/web a 16 erreurs TS pré-existantes (lastFailedAt,
                lastError, refreshCompetitorSummary, classifyChange, stats,
                ChangeRow.summary/monitorUrl, CompetitorSignal.monitorUrl/
                sourceType, topbar.compact) — WIP utilisateur antérieur
                à patch-03, sans rapport avec PostHog. À nettoyer dans
                un commit séparé (l'API/types/components ont divergé)

## Décisions patch-03

- PostHog Cloud EU (eu.i.posthog.com) obligatoire — RGPD
- OPT-IN strict : opt_out_capturing_by_default true. Aucun event ni session
  replay avant clic "Accepter". Helper track() gate sur posthog.__loaded
  ET has_opted_in_capturing()
- person_profiles "identified_only" → pas de profil pour visiteurs anonymes
- userId comme seul distinctId — JAMAIS l'email comme propriété de personne
- maskAllInputs + maskTextSelector "[data-ph-mask]" sur session replay :
  appliqué sur user-menu email, section billing complète, settings
  notifications (digestEmail, slack webhook URL)
- Provider no-op si NEXT_PUBLIC_POSTHOG_KEY absent ou contient "REPLACE_ME"
  → dev local fonctionne sans key
- Server-side : flushAt=1 + flushInterval=0 + flush après chaque capture
  pour ne pas perdre d'events. Workers : shutdownPostHog() en fin de run
- pnpm.overrides {"@opentelemetry/api": "1.9.0"} ajouté au root package.json
  pour éviter le clash de versions drizzle-orm peer-resolution (trigger.dev
  pin 1.9.0, sentry pin 1.9.1). Sans override, workers typecheck échoue
  avec "Types have separate declarations of a private property"
- Better Auth : drizzleAdapter(db, { provider: "pg" }) sans schema option
  — Better Auth gère ses propres tables (user/session/account/verification),
  les passer comme schema requérait des exports drizzle inexistants
- Feature flag de démo : "kill-switch-discovery" — bloque l'appel Exa
  pendant l'onboarding avec message "Discovery temporarily disabled"
- distinctId server-side = owner user de l'org (premier user créé par
  createdAt ascending). Multi-user (business plan) viendra plus tard
- signal_generated track en fin de generate-signal.job, AVANT le shutdown.
  Pas de batch — chaque signal flush immédiatement

## Étapes patch-04 (terminées 2026-05-27)

- [x] Étape 0 — pino + @sentry/node + @sentry/esbuild-plugin + @sentry/nextjs
              installés + env vars stub LOG_LEVEL + SENTRY_DSN_* + SENTRY_AUTH_TOKEN
              + SENTRY_ORG dans .env.example et .env.local
- [x] Étape 1 — packages/shared/src/logger.ts (pino + redact PII) +
              childLogger helper + export depuis index.ts +
              remplacement console.error → logger.error dans clickhouse-safe.ts
              et stripe-webhook.ts (surgical, points critiques)
- [x] Étape 2 — apps/api/src/lib/sentry.ts (init Node SDK, enabled prod only,
              tracesSampleRate 0.1, sendDefaultPii false) + import en TOUT
              PREMIER dans index.ts + app.onError → captureException + logger.error
- [x] Étape 3 — apps/workers/src/lib/sentry.ts (idem API) + hook global
              onFailure dans trigger.config.ts → Sentry.captureException avec
              tags taskId+runId + @sentry/esbuild-plugin gated sur
              SENTRY_AUTH_TOKEN+SENTRY_ORG+NODE_ENV=production
- [x] Étape 4 — Next.js 16 pattern moderne (pas le wizard) :
              · src/instrumentation.ts (server/edge runtime detection)
              · src/instrumentation-client.ts (client init)
              · withSentryConfig dans next.config.ts (source maps automatiques)
              · Session Replay Sentry désactivé (replays*SampleRate: 0)
              · @sentry/nextjs ^10.54.0
- [x] Étape 5 — apps/api/src/routes/health.ts étendu :
              · GET /health/live (no deps, pour uptime monitors)
              · GET /health/ready (db SELECT 1 requis + clickhouse ping optionnel,
                redis skipped — Upstash retiré Phase 6) → 200/503
- [x] Étape 6 — findings.md : section Patch-04 complète (Sentry config,
              uptime monitoring TODO externe, règles Slack conservatrices,
              env vars à remplir en prod)
- [x] Étape 7 — Axiom log shipping : reporté (optionnel, free tier Coolify+Trigger.dev suffit)
- [x] Étape 8 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)

## Décisions patch-04

- Sentry DSN/Auth Token : stub dans .env.example/.env.local. À remplir en prod
  via dashboard Sentry (3 projets : outrival-api, outrival-workers, outrival-web)
- Next.js : pattern `src/instrumentation*.ts` (Next 15+) plutôt que
  `sentry.*.config.ts` au root (incompatible avec tsconfig rootDir=src)
- Wizard `pnpm dlx @sentry/wizard@latest -i nextjs` NON exécuté (modifie trop
  de fichiers, config manuelle plus chirurgicale)
- `console.error` remplacé chirurgicalement uniquement aux points critiques —
  workers utilisaient déjà logger de @trigger.dev/sdk
- `withSentryConfig` au lieu d'un import direct — gère source maps + tunneling
  + bundling auto en prod
- `tracesSampleRate: 0.1` (10%) pour rester dans le free tier Sentry
  (5k events/mois). Ajustable selon volume réel
- Session Replay Sentry DÉSACTIVÉ — PostHog patch-03 fera le replay
- `sendDefaultPii: false` partout — pas d'auto-capture des emails/IP/headers
- Redact pino : couvre passwords, tokens, apiKeys, secrets, auth headers,
  cookies, emails, stripeCustomerId, DATABASE_URL
- Health check `/ready` : db requis (503 si fail), clickhouse optionnel
  (200 + status "skipped" si CLICKHOUSE_URL absent — bon pour dev local)
- Hook onFailure global Trigger.dev (deprecated mais fonctionnel) — l'API
  recommended `tasks.onFailure` runtime sera adoptée si besoin de plus de
  granularité par job

## À faire avant beta (externe — utilisateur)

- Créer org Sentry + 3 projets → coller DSN dans .env prod
- Générer SENTRY_AUTH_TOKEN (Internal Integration scope: project:releases)
- Configurer Better Stack ou UptimeRobot :
  · monitor `https://api.outrival.io/health/live` (1/min)
  · monitor `https://outrival.io` (1/min)
  · alerte → email + Slack #alerts
- Sentry → Slack integration + règles conservatrices :
  · nouvelle issue → notif #alerts
  · pic >10 events/5 min même issue → notif #alerts
  · PAS d'alerte sur chaque occurrence (alert-fatigue)
- Test E2E avec NODE_ENV=production en local :
  · erreur API → visible dans outrival-api
  · job qui throw → visible dans outrival-workers
  · erreur client → visible dans outrival-web avec source maps
  · couper la DB → /health/ready → 503

## Étapes session actuelle (Phase 7 — terminée 2026-05-25)

- [x] Étape 0 — Install stripe + STRIPE_* placeholders dans .env.example/.env.local
- [x] Étape 1 — packages/shared : PLAN_LIMITS + PLAN_PRICING + PLAN_LABELS +
              types Plan, BillingPeriod, AlertChannel, PlanFeature
- [x] Étape 2 — apps/api/src/lib/plan.ts (helpers) + gating dans routes
              competitors, onboarding, candidates, battle-cards, settings
              + send-alert.job (notif RT + slack channel)
              → codes structurés : plan_limit_competitors, plan_locked_feature,
                plan_locked_source, plan_locked_frequency, plan_locked_channel
- [x] Étape 3a — DB schema : organizations.stripeSubscriptionId +
              billingPeriodEnum + organizations.planPeriod → db:push
- [x] Étape 3b — Routes Stripe :
              · apps/api/src/lib/stripe.ts (lazy getStripe + price ↔ plan map)
              · routes/billing.ts (GET, POST checkout, POST portal)
              · routes/stripe-webhook.ts (signature + 4 events handled)
              · monté à `/api/stripe/webhook` AVANT les autres `/api/*`
- [x] Étape 4 — UI billing : composant BillingDashboard (Client) +
              page /dashboard/settings/billing + lien depuis Settings
              · plan actuel + usage avec barre + tableau 4 plans + toggle period
              · redirect vers Stripe URL + ?status=success → toast + refresh
              · ApiError class dans lib/api.ts pour porter le code structuré
- [x] Étape 5 — Paywalls : PaywallDialog + paywallFromError(err)
              branchés sur 5 call sites :
              · createCompetitor (competitors page)
              · completeOnboarding (onboarding page)
              · addCandidate (candidates page)
              · generateBattleCard (battle-card-tab)
              · updateNotificationSettings (notification-settings-form)
- [x] Étape 6 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 7 — Mise à jour planning

## Décisions Phase 7

- PLAN_LIMITS = source unique de vérité dans @outrival/shared (utilisé par
  api gating, web billing UI, paywalls, et workers send-alert)
- business.maxCompetitors = Number.POSITIVE_INFINITY ; UI affiche "illimité"
  et envoie `limit: null` côté JSON (Number.POSITIVE_INFINITY n'est pas
  serializable JSON, le helper `Number.isFinite(...)` est utilisé)
- Webhook monté à `/api/stripe/webhook` AVANT les routes `/api/*` (Hono ne
  cause pas de body-consumption issue avec les middlewares actuels mais
  pattern défensif). Pas dans authMiddleware → signature Stripe = preuve
- Stripe SDK v22 : `apiVersion: "2026-04-22.dahlia"` (la version du doc
  était trop ancienne). Types via inference (`InstanceType<typeof Stripe>`,
  `Extract<EventType, {type:"x"}>["data"]["object"]`) pour contourner la
  shape pénible du namespace export en CJS
- Customer Stripe créé à la première checkout (lazy) — pas de pre-creation
  au signup. metadata.orgId présent sur Customer + Session + Subscription
  → 3 sources de vérité pour retrouver l'org dans le webhook
- Le webhook gère 4 events : checkout.session.completed,
  customer.subscription.created/updated/deleted. Pour created/updated, on
  re-derive le plan depuis le priceId du subscription via lookupPlanByPriceId.
  Pour deleted, repasse en free + clear subscriptionId + planPeriod
- ApiError côté web : nouvelle classe qui porte `status`, `code` (string),
  `data` (payload JSON parsé). paywallFromError(e) renvoie null pour les
  non-paywalls → fallback à l'erreur classique
- PaywallDialog : un seul composant pour tous les codes plan_* avec
  switch sur reason.code → bon copy en français + bouton "Voir les plans"
  qui link vers /dashboard/settings/billing. Position fixed, fermable
- Gating send-alert.job (workers) : si !realtimeAlerts → pas d'insert
  notification (donc free user ne voit pas la bell). Slack/webhook
  filtrés par `isChannelAllowed`. Email digestEmail reste toujours envoyé
  (channel "email" autorisé sur tous les plans)
- Stripe en mode test pour cette phase ; les vraies clés + price IDs
  seront remplies par l'utilisateur dans .env.local avant le test E2E

## À tester (runtime)

- Compte free : tenter d'ajouter un 3e concurrent → paywall "limit_competitors"
- Compte free : tenter de générer une battle card → paywall "locked_feature"
- Settings : tenter de sauver une URL Slack en free → paywall "locked_channel"
- Stripe test mode (carte 4242 4242 4242 4242) :
  1. Créer 3 produits Starter/Pro/Business avec prix monthly + yearly
  2. Coller les price IDs dans .env.local
  3. Souscrire au plan Pro depuis /dashboard/settings/billing
  4. Au retour ?status=success → toast + refresh → org.plan = pro
  5. Vérifier qu'on peut ajouter jusqu'à 15 concurrents et générer une battle card
  6. Ouvrir le Customer Portal → annuler l'abonnement
  7. Vérifier que org.plan repasse en free via webhook subscription.deleted

## Étapes session précédente (Phase 6 — terminée 2026-05-25)

## Étapes session actuelle (Phase 6 — terminée 2026-05-25)

- [x] Étape 1 — Schémas DB : battle_cards, notifications (+ enum), competitor_candidates (+ enum) + db:push
- [x] Étape 2 — packages/ai : generateBattleCard (Groq via AI_CONFIG.insights, Zod schema)
- [x] Étape 3 — Workers : generate-battle-card.job (gather context → Groq → upsert → Playwright PDF → R2)
              + lib/battle-card-html.ts (template A4 Outrival dark/amber)
              + getBytesFromR2 helper (packages/shared) + playwright en dep workers
- [x] Étape 4 — API : 4 routes /api/competitors/:id/battle-card (GET, generate, PATCH, GET pdf)
- [x] Étape 5 — UI : onglet "Battle Card" + composant BattleCardTab (édition inline,
              polling 3s pendant génération, DL PDF, régénérer)
- [x] Étape 6 — Notifications SSE :
              · send-alert.job : insert notification (surgical, 7 lignes)
              · routes/notifications.ts : list, unread-count, read, read-all, stream(SSE)
              · components/notifications-bell.tsx + header dans dashboard layout
              · DB-backed, latence ~3s, EventSource auto-reconnect
- [x] Étape 7 — detect-new-competitors.job (cron `0 20 * * 0`) :
              · findSimilarCompanies + scoreOverlap pour chaque org onboardée
              · dedup par URL ET hostname normalisé (existing + seen candidates)
              · insert candidate + notification si overlap > 65
              · routes/candidates.ts (list, add, dismiss)
              · /dashboard/candidates + entrée sidebar "Détections"
- [x] Étape 8 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 9 — Mise à jour planning

## Décisions Phase 6

- Temps-réel via SSE DB-backed (`hono/streaming.streamSSE`) — pas d'Upstash
  pub/sub ni service payant. Latence 2-3s amplement suffisante pour veille
- PDF Playwright via `chromium.launch({headless:true})` + page.pdf({format:"A4"})
  → buffer → upload R2 (jamais en DB). Régénération uniquement à la demande
- Helper `getBytesFromR2(key) → Uint8Array` ajouté à @outrival/shared
  (au lieu de string) pour servir binaires via Response Hono
- battleCardsRouter monté à `/api/competitors` à côté de competitorsRouter
  (deux routers même prefix, dispatch par chemin distinct `/:id/battle-card`)
- Dedup candidates double-vérifié : exact URL set + normalized hostname set
  (sans www) car Exa retourne parfois différents formats pour le même site
- send-alert modif surgical : 7 lignes en plus (insert dans table notifications)
  pour ne pas casser la robustesse Slack/email existante
- Battle card content = jsonb editable inline (pas de schéma de validation
  duplicaté côté UI, juste Zod côté API)
- Bell + toast positionnés en `position:fixed bottom-right` pour les toasts,
  dropdown ancré au bouton bell dans le header (z-50)

## Étapes session précédente (Phase 5 — terminée 2026-05-25)

- [x] Étape 0 — Deps (@clickhouse/client ajouté à @outrival/db)
- [x] Étape 1 — Tables ClickHouse (client partagé `ch` + ensureClickhouseTables + script `pnpm ch:setup`)
- [x] Étape 2 — Schéma : competitors.aiSummary + aiSummaryUpdatedAt
- [x] Étape 3 — packages/ai : extract-pricing, extract-jobs, extract-reviews, competitor-summary (Groq)
- [x] Étape 4 — packages/scrapers : jobs (Playwright + ATS detection), g2-reviews + capterra-reviews (ScrapingBee premium)
- [x] Étape 5 — Workers : 4 nouveaux jobs + routing surgical depuis scrape-monitor
- [x] Étape 6 — API : 6 sous-routes /:id/{jobs,job-trends,reviews,review-scores,pricing-history,signals} + enrichissement /:id
- [x] Étape 7 — UI : fiche concurrent complète (5 onglets, recharts dark amber)
- [x] Étape 8 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 9 — Mise à jour planning

## Décisions Phase 5

- Client ClickHouse partagé dans `packages/db/src/clickhouse.ts` (proxy lazy)
  pour permettre l'usage depuis l'API ET les workers
- Workers conservent leur propre `lib/clickhouse.ts` avec logger Trigger.dev
  (helpers insert best-effort par table : pricing_history, job_counts,
  review_scores, signal_feed)
- API : helper `chQuery` best-effort retourne [] si CLICKHOUSE_URL absent
  → la fiche concurrent reste fonctionnelle sans ClickHouse provisioned
- Reviews : on stocke praises et complaints dans la table `reviews` Postgres
  avec `author = "praise" | "complaint"` (pas idéal, à normaliser Phase 6+)
- Routing scrape-monitor 100% surgical : 4 lignes en plus pour brancher
  pricing/jobs/g2/capterra vers les jobs d'extraction
- Tabs custom (pas de shadcn Tabs installé) — design flat + underline amber
- Recharts pour pricing timeline, job trends, review scores
- G2 / Capterra forcés via ScrapingBee premium_proxy + render_js=true
- Détection ATS (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters)
  stockée dans metadata.atsDetected mais non utilisée pour scraper l'iframe
  (Phase 6+ si besoin)

## Étapes session précédente (Phase 4 — terminée 2026-05-25)

- [x] Étape 0 — Deps (exa-js + EXA_API_KEY + SCRAPINGBEE_API_KEY placeholder)
- [x] Étape 1 — Schéma org : productUrl, productProfile (jsonb), onboardingCompleted
- [x] Étape 2 — packages/ai : analyzeProduct + scoreOverlap (Groq, batché, camelCase)
- [x] Étape 3 — packages/scrapers : findSimilarCompanies (Exa) + quickFetchText (ScrapingBee no-JS) + subpath exports
- [x] Étape 4 — Routes API synchrones : /onboarding/{status,analyze,discover,profile,complete}
- [x] Étape 5 — UI : page client unique 5 étapes (state machine + spinners amber)
- [x] Étape 6 — Garde dashboard layout (redirect /onboarding si !completed)
- [x] Étape 7 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 8 — Mise à jour planning

## Décisions architecturales

- Pipeline IA 100% Groq pour Phase 3 (llama-3.3-70b-versatile) — swap vers
  Claude prévu en changeant une seule ligne dans `packages/ai/src/config.ts`
- ClickHouse insert best-effort partout : skip + log si CLICKHOUSE_URL non set
- Idempotence Signal : check `signals.changeId` avant insert (classify + generate)
- Phase 5 : ClickHouse client partagé dans packages/db (proxy lazy)
- env aiEnv() lazy : ne parse les vars qu'au premier appel pour ne pas crasher trigger:dev
- ProductProfile camelCase partout (Phase 4)
- Discovery ne crée RIEN en DB — seul /complete crée competitors + monitors
- Pour les sources G2/Capterra : URL fournie par l'utilisateur via monitor.config
  (auto-discovery G2 URL = Phase 6 si besoin)

## À faire avant Phase 6

- Provisionner ClickHouse Cloud + lancer `pnpm ch:setup` une fois pour
  créer les 4 tables (pricing_history, job_counts, review_scores, signal_feed)
- Test E2E : ajouter monitors pricing+jobs+g2_reviews sur un concurrent réel,
  scraper manuellement, vérifier les onglets de la fiche
- Mesurer la fiabilité du scraping G2/Capterra via ScrapingBee
- Évaluer la qualité de l'extraction Groq sur des pages réelles
  (pricing structuré, jobs par département, top complaints reviews)
- Déclencher refresh-competitor-summary manuellement → vérifier aiSummary
- Vérifier la détection des offres fermées (réexécuter extract-jobs deux fois
  avec un job supprimé entre les deux)

## Blockers

Aucun. Phase 5 livrable end-to-end. Reste creds ClickHouse à fournir pour
runtime + URLs G2/Capterra par concurrent (monitor.config) à configurer
côté UI (Phase 6).

---

# Patch 11 — Détection avancée du pricing (taxonomie 6 statuts)

## Session du 2026-06-01

## Objectif
Remplacer le binaire "prix trouvé / pas trouvé" par une taxonomie à 6 statuts
(public · public_partial · gated_demo · gated_signup · dynamic · unknown),
détecter les promos pour ne JAMAIS générer de signal de changement de prix
quand promotional=true, et générer un signal "pricing repositionné" sur
transition de statut. Validé sur fixtures HTML réelles (Linear, Notion,
Crayon, Segment), pas seulement en théorie.

## Phase en cours
Post-MVP — Patch 11 (s'appuie sur le pricing construit en Phase 5)

## Réalité du code vs hypothèses du patch (divergences à acter)
Le patch décrit des chemins/structure supposés de Phase 5 qui ne correspondent
pas au code réel. Adaptations :

1. Scraper réel = `packages/scrapers/src/pricing/pricing.scraper.ts`
   (pas `scrapers/pricing.ts`). Il ne fait QUE fetch le HTML (Playwright).
2. L'extraction des tiers n'est PAS dans le scraper : elle vit dans le job
   worker `extract-pricing.job.ts` + l'IA `packages/ai/extractPricing()`,
   qui écrit dans ClickHouse `pricing_history`. → On NE met pas `tiers` dans
   le scraper ; les tiers restent extraits par l'IA dans le worker.
3. Aucune donnée pricing sur `competitor` aujourd'hui → les 6 champs de statut
   vont sur la table `competitors` (Postgres), conformément à l'option du patch.
4. Pas de `competitor-pricing-card.tsx` : le `PricingTab` est inline dans
   `app/dashboard/competitors/[id]/page.tsx` (~l.1439). On y ajoute une carte
   statut + override manuel.
5. Aucun test runner dans le repo (pas de vitest). Bun 1.3.13 dispo →
   `bun test` zero-config dans le package scrapers + fixtures HTML réelles.
6. cheerio n'est pas dép directe → `pnpm add cheerio --filter @outrival/scrapers`.
7. `PricingStatus` (type) + `detectPricingRepositioning()` → `@outrival/shared`
   (importable scrapers/workers/web), PAS packages/ai. Les détecteurs HTML
   (signals, determine-status, discover-url) restent dans scrapers.
8. `signals.changeId` est notNull + FK → tout signal s'accroche à une `change`.
   Donc pour un changement sur monitor pricing, scrape-monitor route vers UN
   seul résultat : promo→aucun signal · transition→signal repositionné ·
   sinon→classify-change générique. (Évite la race de double-signal sur le
   même changeId.)

## Étapes (1 commit par étape)
- [ ] Étape 1 — Schéma : 6 champs pricing sur `competitors` (pricingStatus,
      pricingObservedRegion, pricingPromotional, pricingDemoUrl, pricingNote,
      pricingManualOverride) + ClickHouse pricing_history (status, promotional,
      observed_region) via CREATE étendu + ALTER ... ADD COLUMN IF NOT EXISTS.
      db:push + ch:setup. → `feat(db): add pricing status taxonomy fields`
- [ ] Étape 2 — `@outrival/shared` : type `PricingStatus` + `detectPricingRepositioning(prev, current)`.
      → `feat(shared): pricing status type + repositioning detector`
- [ ] Étape 3 — scrapers/pricing/discover-url.ts : cascade direct(HEAD)→nav→footer→homepage_section
      (cheerio). + dép cheerio. → `feat(scrapers): multi-strategy pricing URL discovery`
- [ ] Étape 4 — scrapers/pricing/signals.ts : detectPricingSignals (regex FR+EN,
      price/gated/calculator/signup/promo) + infra bun test + fixtures réelles.
      → `feat(scrapers): pricing signal detectors`
- [ ] Étape 5 — scrapers/pricing/determine-status.ts : determineStatus (6 statuts)
      + matrice de tests. → `feat(scrapers): pricing status determination logic`
- [ ] Étape 6 — Brancher la découverte dans pricing.scraper.ts (signature
      `scrape()` inchangée) + helper pur `analyzePricingHtml(html)` exporté pour
      le worker. → `feat(scrapers): refactor pricing scraper around status taxonomy`
- [ ] Étape 7 — Workers : scrape-monitor (pricing) calcule analyse sur result.html,
      stocke les champs competitor (sauf manualOverride), route promo/transition/
      générique, passe status+promo à extract-pricing (qui tague les lignes CH).
      → `feat(workers): integrate pricing taxonomy and skip promotional signals`
- [ ] Étape 8 — Signal repositionné : generate-signal (ou trigger dédié) reçoit
      le contexte prev→current pour formuler insight/so_what.
      → `feat(ai): detect pricing status repositioning signals`
- [ ] Étape 9 — UI : carte statut dans PricingTab (6 variantes) + modal override
      manuel + route API PATCH pricing + affichage région.
      → `feat(web): adapt competitor pricing card to status taxonomy`
- [ ] Étape 10 — Vérif finale : build+typecheck+ch:setup, fixtures passent,
      findings.md + task_plan.md à jour.

## Décisions prises
- Détection lancée dans scrape-monitor (sur result.html en mémoire) car le
  promo-gate ET le routing de transition doivent décider AVANT classify-change.
  Les tiers restent extraits par l'IA dans extract-pricing.
- Fixtures = HTML rendu réel capturé via le scraper Playwright existant
  (sites JS-heavy → un curl statique renverrait un shell sans prix → faux unknown).

## Blockers
- Capture de fixtures = lancer Playwright (4 pages). MEMORY: full `pnpm dev`
  OOM la VM WSL 7.4GB → capture en isolé (4 fetch), pas tout le stack.
