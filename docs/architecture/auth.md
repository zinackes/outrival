# Authentification & temps-réel — Outrival

> Better Auth (OTP, OAuth, 2FA, passkeys) + SSE DB-backed.
> Index : `docs/architecture.md`.

## Authentification (patch-19)

Page **unique `/auth`** (groupe `(auth)`, layout qui redirige déjà si session). Plus
de `/login` ni `/register` séparés → redirects 308 (`next.config.ts`). Trois méthodes,
toutes via Better Auth :

- **Code email + lien (primaire)** : entrée unique « Continue with email » (pas
  d'onglets login/signup). La page POST `/api/auth/check-and-send-magic-link` (router
  custom monté **avant** le wildcard `/api/auth/*`, sinon avalé). Le endpoint vérifie
  Turnstile + rate-limit + email (zod strict + anti-disposable) puis appelle
  `auth.api.sendVerificationOTP({ type:"sign-in" })` (plugin Better Auth **emailOTP**,
  remplace `magicLink`). UN seul email Resend (`RESEND_AUTH_FROM` ; le défaut du
  code, `auth@outrival.io`, pointe un domaine qui n'est pas le nôtre, cf.
  `docs/architecture/env.md`), HTML inline
  dark+amber) porte **les deux** : un code 6 chiffres (saisi dans 6 cases sur `/auth`,
  marche cross-device) **et** un bouton « Sign in » → `GET /api/auth/otp-link?email&code`
  (vérifie le code server-side, pose le cookie, 302 `/dashboard` ; échec → 302
  `/auth?error=link_invalid`). Le code/lien (TTL 10 min, single-use, `allowedAttempts:3`)
  fait **login OU signup** indifféremment — le compte est créé au verify s'il n'existe
  pas (`disableSignUp` défaut false), l'utilisateur ne sait jamais lequel a eu lieu.
  La saisie du code vérifie via `POST /api/auth/sign-in/email-otp` (fetch direct,
  `credentials:"include"`). **Anti-enumeration ABSOLUE** : réponse HTTP identique que
  l'email existe ou non (les seuls 400 portent sur la requête : captcha/email invalide,
  jamais sur l'existence).
- **Google OAuth (secondaire)** : `authClient.signIn.social({ provider:"google" })`.
  Callback dérivé de `BETTER_AUTH_URL` → `/api/auth/callback/google`.
- **Email + password (fallback)** : replié sous « Prefer a password? ». Login only
  (les nouveaux comptes ne settent jamais de password via cette UI). `minPasswordLength`
  12 (appliqué seulement au **set**, pas au sign-in → rétrocompat des anciens comptes).

### 2FA (TOTP) + changement d'email — settings security P0

- **Two-factor (authenticator app)** : plugin Better Auth `twoFactor`
  (`allowPasswordless`, issuer "Outrival"). Le plugin n'intercepte nativement que
  `/sign-in/email` + `/sign-in/username` — un hook `hooks.after` dans `lib/auth.ts`
  **étend** sa sign-in partielle aux chemins **email-OTP** et **callback OAuth
  (Google)** : pour un user `twoFactorEnabled`, la session fraîche est détruite et
  remplacée par le cookie de challenge `two_factor` que `/two-factor/verify-totp`
  consomme. **Safe-by-default** : le hook early-return si 2FA non activé → zéro
  impact tant que personne n'opte. Activation **verify-first** (le flag ne passe à
  true qu'après confirmation d'un code → pas de lockout) ; **backup codes** au
  setup, utilisables une fois au sign-in (`/two-factor/verify-backup-code`).
  UI : `settings/security` (enable → QR + clé + backup codes → confirm ; disable),
  étape TOTP sur `/auth` (inline pour email-OTP, `?twofactor=1` pour lien/Google).
  Migration `0007` (`user.two_factor_enabled` + table `two_factor`).
- **Changement d'email self-serve** : `emailOTP({ changeEmail })`. Un code part vers
  le **nouvel** email (`type "change-email"`, anti-enumeration : silence si déjà
  pris), l'email ne bascule qu'après confirmation. UI 2 étapes dans `settings/profile`.
- **Export RGPD + suppression de compte + déconnexion OAuth (P1)** :
  `GET /api/settings/export` assemble côté serveur, **org-scoped**, toute la donnée
  relationnelle (competitors/monitors/signals/digests/products/candidates/battle
  cards/jobs/reviews ; hors snapshots R2 + analytics). `DELETE /api/settings/account`
  = `eraseOrg(detachUsers:false)` (cascade le `users` app) **puis** delete du `user`
  Better Auth (cascade session/account/two_factor) → distinct de "delete workspace"
  (qui garde le login). `POST /api/auth/disconnect-oauth` délie un provider (Google)
  en supprimant la ligne `account` directement — l'`unlink-account` natif exige une
  session < `freshAge` (24h), inutilisable avec nos sessions 30j ; pas de lockout
  car le login email-OTP ne dépend d'aucune ligne `account`.
- **Auth/login P0+P1 (audit connexion)** : toggle show-password sur le fallback
  password · récup mot de passe oublié = lien « sign in with an email code instead »
  (modèle OTP-first, pas de reset-token) · `rateLimit.customRules` Better Auth sur
  `/sign-in/email`, `/sign-in/email-otp` et les verify 2FA (par IP, single-instance) ·
  2FA « trust this device » (checkbox → `trustDevice` ; le hook custom honore le cookie
  trust-device signé sur les chemins email-OTP/Google, pas que password).
- **Passkeys / WebAuthn** : plugin `@better-auth/passkey` (package séparé → bump
  `better-auth` 1.6.11→1.6.22 prérequis). Table `passkey` (migration `0008`), rpID/origin
  dérivés de **WEB_URL** (origine page, pas l'API). UI gated `NEXT_PUBLIC_PASSKEYS_ENABLED`
  (dark par défaut) : « Add a passkey » (Settings → Security, list/add via
  `authClient.passkey.*`, delete via route) + « Sign in with a passkey » sur `/auth`
  (`signIn.passkey()`). Safe-by-default ; **à valider sur staging avec un device réel**
  avant d'activer le flag. **Différé** : idle-timeout
  (longueur de session = décision produit, 30j OK pour la veille), email « nouvel
  appareil » (besoin d'un signal login-complété fiable + persistance device — à bâtir
  avec le journal d'activité), SSO Apple/Microsoft (enregistrement OAuth externe).
- **Settings P2 (polish)** : recherche dans la rail settings (label + keywords) ·
  **re-auth step-up** sur les actions destructives (delete workspace/account) —
  `POST /api/settings/reauth/send` émet un code 6 chiffres single-use, attempt-capped,
  stocké dans la table `verification` (`reauth-<userId>`), exigé en plus du
  type-to-confirm (une session volée seule ne peut plus effacer) · factures Stripe
  in-app (`GET /api/billing/invoices`, best-effort) · fenêtre de rétention du plan +
  liens privacy/terms dans Data. Différé : journal d'activité sécurité (nécessite la
  persistance des events de login ; les sessions actives montrent déjà l'heure de connexion).

Sécurité transverse : Turnstile managed invisible (`lib/turnstile.ts`, bypass dev si pas
de secret) ; rate-limit Upstash par **email ET IP** (`middleware/auth-rate-limit.ts`,
no-op si Upstash absent, 429 identique email/IP) ; check HaveIBeenPwned k-anonymity
(`@outrival/shared` `validatePasswordWithHibp`, fail-open, building block pour un futur
set-password depuis settings). Events PostHog funnel (`auth_magic_link_requested/sent`,
`auth_google_clicked`, `auth_password_option_clicked`) gatés par le consentement (le
helper `track` no-op si pas opt-in). `emailSchema`/`passwordSchema` partagés
client/serveur (`packages/shared/src/validation/`).

> **Setup manuel (hors code)** : créer les credentials Google OAuth (Console Google,
> redirect URI = `{BETTER_AUTH_URL}/api/auth/callback/google` en dev **et** prod), le
> site Turnstile (CF dashboard, mode Managed), et vérifier le domaine d'envoi dans
> Resend (`outrival.app`) PUIS poser `RESEND_AUTH_FROM`/`RESEND_FROM` : les défauts
> du code sont sur `outrival.io`, qui ne nous appartient pas. Sans les clés
> Google/Turnstile, le code dégrade proprement (Turnstile bypass, rate-limit no-op) ;
> sans le bon expéditeur, l'envoi échoue au lieu de dégrader.

## Temps-réel : SSE DB-backed

Route Hono `GET /api/notifications/stream` (auth required) :
- `streamSSE` natif Hono, poll DB 3s + heartbeat
- `onAbort` cleanup, EventSource auto-reconnect côté client
- Composant `<NotificationsBell />` dans le header du dashboard
- Pattern : ~3s de latence, gratuit, scale sur le VPS jusqu'à ~1000 connexions simultanées
- Au-delà : passer à Upstash pub/sub ou un service WebSocket dédié (Phase 9+)

