# Task Plan — Outrival

Mis à jour automatiquement par Claude Code à chaque session.

## Phases du projet

- [x] Phase 0 — Scaffold monorepo (turbo, tsconfig, packages vides, CI vert)
- [x] Phase 1 — Foundation (monorepo, auth, DB schema, dashboard shell)
- [x] Phase 2 — Scraping Core (Crawlee, diff engine, change feed)
- [x] Phase 3 — Intelligence IA (Groq classify+insight+digest, alertes, cron)
- [x] Phase 4 — Competitor Discovery (Exa.ai, onboarding, overlap scoring)
- [ ] Phase 5 — Enrichissement (jobs, reviews, pricing history, fiche complète)
- [ ] Phase 6 — Battle Cards & Alertes (export PDF, alertes temps-réel)
- [ ] Phase 7 — Monétisation (Stripe, free tier limits, landing page)

## Phase en cours
Phase 5 — Enrichissement (prochaine)

## Étapes session actuelle (Phase 4 — terminée 2026-05-25)

- [x] Étape 0 — Deps (exa-js + EXA_API_KEY + SCRAPINGBEE_API_KEY placeholder)
- [x] Étape 1 — Schéma org : productUrl, productProfile (jsonb), onboardingCompleted
- [x] Étape 2 — packages/ai : analyzeProduct + scoreOverlap (Groq, batché, camelCase)
- [x] Étape 3 — packages/scrapers : findSimilarCompanies (Exa) + quickFetchText (ScrapingBee no-JS) + subpath exports
- [x] Étape 4 — Routes API synchrones : /onboarding/{status,analyze,discover,profile,complete}
- [x] Étape 5 — UI : page client unique 5 étapes (state machine + spinners amber)
- [x] Étape 6 — Garde dashboard layout (redirect /onboarding si !completed)
- [x] Étape 7 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 8 — Mise à jour planning

## Décisions Phase 4

- Tout synchrone (analyze ~7s, discover ~6s) — aucun @trigger.dev/react-hooks
- Seul usage Trigger.dev = premier scrape via /complete (réutilise scrape-monitor)
- Subpath exports @outrival/scrapers/{discovery,quick-fetch} — évite de pull crawlee/playwright dans l'API
- ProductProfile camelCase partout (valueProp, pricingModel) — LLM instruit en camelCase via prompt
- scoreOverlap batché : un seul appel Groq (maxTokens 2048) pour 15 candidats
- Discovery ne crée RIEN en DB — seul /complete crée competitors + monitors
- Pré-coché côté UI uniquement si overlapScore > 60
- ensureUserOrg réutilisé partout — pas de logique org dupliquée

## Étapes session précédente (Phase 3 — terminée)

- [x] Étape 0 — Deps (groq-sdk, @anthropic-ai/sdk, resend, @clickhouse/client)
- [x] Étape 1 — packages/ai pipeline (config, provider, parse, classify, insight, digest)
- [x] Étape 2 — Schéma : slackWebhookUrl, digestEmail, digestEnabled, alertsEnabled sur organizations
- [x] Étape 3 — Jobs classify-change + generate-signal + ClickHouse signal_feed
- [x] Étape 4 — Trigger pipeline IA depuis scrape-monitor après création Change
- [x] Étape 5 — Alertes Slack + email (Resend) via send-alert.job
- [x] Étape 6 — schedule-scraping.job (cron horaire, fréquences realtime/daily/weekly)
- [x] Étape 7 — generate-weekly-digest.job (cron lundi 8h + email Resend)
- [x] Étape 8 — Routes API : signals, digests, settings/notifications
- [x] Étape 9 — UI : feed Signals, page Digests, page Settings
- [x] Étape 10 — pnpm build ✓ + pnpm typecheck ✓ (7/7)
- [x] Étape 11 — Mise à jour planning

## Décisions architecturales
- Pipeline IA 100% Groq pour Phase 3 (llama-3.3-70b-versatile) — swap vers Claude
  prévu en changeant une seule ligne dans `packages/ai/src/config.ts`
- ClickHouse insert (signal_feed) en best-effort : skip + log si CLICKHOUSE_URL non set
- Idempotence Signal : check `signals.changeId` avant insert (classify + generate)
- ClickHouse client dans `apps/workers/src/lib/clickhouse.ts` (workers seul consommateur)
- env aiEnv() lazy : ne parse les vars qu'au premier appel pour ne pas crasher trigger:dev
- Resend `ALERT_FROM` paramétrable via env `RESEND_FROM` (défaut alerts@outrival.io)

## À faire avant Phase 5

- Remplir `EXA_API_KEY` + `SCRAPINGBEE_API_KEY` dans .env.local
- Test E2E onboarding : nouveau compte → URL produit → discovery → sélection → dashboard
- Mesurer la latence réelle des appels /analyze et /discover (cible : <15s combinés)
- Évaluer la qualité de la discovery Exa sur 3-4 produits de catégories différentes

## À faire avant Phase 4 (historique)

- Remplir `GROQ_API_KEY` + `RESEND_API_KEY` dans .env.local
- (optionnel) Remplir `CLICKHOUSE_URL` + `CLICKHOUSE_PASSWORD` + créer table `signal_feed`
- `pnpm db:push --filter @outrival/db` pour appliquer les nouvelles colonnes organizations
- Test E2E : scraper un site modifié → vérifier Signal créé + alerte si high/critical
- Déclencher manuellement `generate-weekly-digest` une fois pour vérifier le flow email

## Blockers
Aucun. Phase 3 livrable end-to-end. Reste creds à fournir pour test runtime.
