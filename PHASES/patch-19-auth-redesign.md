# Patch 19 — Refonte auth (login/register) et sécurité

<context>
Refonte complète du flow d'authentification d'Outrival. Aujourd'hui c'est
probablement du email + password classique généré par Phase 1, fonctionnel
mais générique. Pour un produit B2B premium avec une promesse "veille
concurrentielle premium", l'auth est la première impression et elle doit
être à la hauteur.

Trois axes simultanés :

1. MÉTHODES D'AUTH MODERNISÉES
   - Magic link par email (primaire, friction min, aligné avec digest email)
   - Google OAuth (secondaire, 95% des fondateurs SaaS l'ont)
   - Email + password (fallback, replié dans "Préférez un mot de passe ?")
   Better Auth supporte les trois nativement.

2. SÉCURITÉ RENFORCÉE
   - Anti-enumeration : réponse identique pour email connu/inconnu
   - Rate limiting strict (Redis Upstash déjà branché)
   - Cloudflare Turnstile invisible (anti-bot)
   - Validation Zod stricte sync client/backend
   - HaveIBeenPwned check sur passwords (si utilisés)
   - Pas d'emails jetables (mailinator, tempmail, etc.)

3. UI ASYMÉTRIQUE SOBRE
   - Page unique /auth (détecte login vs register automatiquement)
   - Wordmark Outrival, pas un blob de logo
   - Hiérarchie claire : email primaire > Google > password
   - Pas de marketing copy split-screen générique
   - Pas d'orbe, pas de gradient violet, pas de "Welcome back!"
   - Tagline subtile : "Accédez à votre veille concurrentielle"
   - Design system Outrival (dark + amber + General Sans/Geist)

Pas dans ce patch (en Backlog si besoin futur) :
- SSO Enterprise (SAML/OIDC)
- Apple Sign-In
- Passkeys / WebAuthn (intéressant mais Better Auth en preview, pas urgent)
- GitHub OAuth (pourrait être pertinent pour la persona "developing" du
  patch-08 mais reportable)

Lire avant : @CLAUDE.md, @docs/architecture.md, @docs/design-system.md,
@PHASES/01-foundation.md (auth actuelle via Better Auth), @apps/api/CLAUDE.md,
@apps/web/CLAUDE.md, @PHASES/patch-14-trust-and-clarity.md (divulgation
progressive, messages d'erreur), @PHASES/patch-03-analytics-posthog.md
(funnel events sign_up et login)
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances + env

```bash
# Better Auth a déjà magic link et OAuth plugins
# Si pas installés, ajouter :
pnpm add better-auth --filter @outrival/api  # déjà présent normalement
# Vérifier qu'on a les plugins magic-link et social

# HaveIBeenPwned check (k-anonymity, pas d'API key nécessaire)
# Utilise un fetch natif vers api.pwnedpasswords.com — pas de package
```

Env :
```
# Google OAuth (créer dans Google Cloud Console)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://outrival.io/api/auth/callback/google

# Cloudflare Turnstile (gratuit, créer le site sur Cloudflare dashboard)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# Anti-disposable emails (liste hardcodée d'abord, fichier externe possible plus tard)
# Pas de variable nécessaire

# Rate limiting (Upstash déjà branché via Redis)
AUTH_RATE_LIMIT_EMAIL=3        # max tentatives par email par fenêtre
AUTH_RATE_LIMIT_IP=10          # max tentatives par IP par fenêtre
AUTH_RATE_LIMIT_WINDOW_MIN=15  # fenêtre en minutes
```

Setup Google OAuth (manuel, hors code) :
1. Aller sur https://console.cloud.google.com
2. Créer un projet "Outrival" si pas déjà fait
3. APIs & Services → Credentials → Create OAuth Client ID
4. Type : Web application
5. Authorized redirect URIs : http://localhost:3000/api/auth/callback/google (dev) + URL prod
6. Récupérer CLIENT_ID et CLIENT_SECRET → variables d'env

Setup Cloudflare Turnstile :
1. Aller sur https://dash.cloudflare.com → Turnstile
2. Add Site → outrival.io
3. Mode : Managed (auto, défi seulement si suspect)
4. Récupérer Site Key (public) et Secret Key

→ vérifier : pnpm install propre, env vars définies

Commit : `chore: setup google oauth and turnstile env`

---

## Étape 1 — Configuration Better Auth étendue

### packages/auth/src/index.ts (ou apps/api/src/lib/auth.ts selon structure existante)

Étendre la config Better Auth pour activer magic link + Google + garder password.

```typescript
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@outrival/db";
import { sendMagicLinkEmail } from "@outrival/shared/emails";  // Resend déjà branché

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),

  // Email + password (fallback, conservé)
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,  // simplifie l'UX, on vérifie via magic link si besoin
    minPasswordLength: 12,             // pas 8, on est en 2026
    // Pas de complexity rules infâmes — passphrase ou long suffit
  },

  // Social providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  // Plugins
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url, token }, request) => {
        // Send via Resend (déjà branché)
        await sendMagicLinkEmail({
          to: email,
          magicLinkUrl: url,
          // ne PAS inclure d'info sur l'existence du compte (anti-enumeration)
        });
      },
      // Expiration courte pour sécurité
      expiresIn: 600,  // 10 minutes
    }),
  ],

  // Sécurité
  rateLimit: {
    enabled: true,
    window: 15 * 60,                    // 15 minutes
    max: 10,                             // 10 tentatives par IP par window
  },

  // Session
  session: {
    expiresIn: 60 * 60 * 24 * 30,       // 30 jours
    updateAge: 60 * 60 * 24,            // refresh le token tous les jours
  },
});
```

→ vérifier : auth.client peut envoyer un magic link à un email test
→ vérifier : flow OAuth Google fonctionne en dev (redirect callback)
→ vérifier : flow email + password fonctionne toujours

Commit : `feat(auth): enable magic link, google oauth, modernized password rules`

---

## Étape 2 — Email template magic link

### packages/shared/src/emails/magic-link.tsx

Template React Email pour le magic link, design Outrival.

```typescript
import { Html, Head, Body, Container, Heading, Text, Button, Link, Hr } from "@react-email/components";

export function MagicLinkEmail({ magicLinkUrl, expiresInMinutes = 10 }: {
  magicLinkUrl: string;
  expiresInMinutes?: number;
}) {
  return (
    
      
      
        
          {/* Wordmark */}
          
            out
            rival
          

          
            Votre lien de connexion
          

          
            Cliquez sur le bouton ci-dessous pour vous connecter à Outrival.
            Ce lien expire dans {expiresInMinutes} minutes et ne peut être utilisé qu'une seule fois.
          

          
            Se connecter à Outrival →
          

          
            Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :
            
            
              {magicLinkUrl}
            
          

          

          
            Si vous n'avez pas demandé ce lien, vous pouvez ignorer cet email — votre compte reste sécurisé.
          
        
      
    
  );
}
```

Helper d'envoi :

```typescript
import { Resend } from "resend";
import { render } from "@react-email/render";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendMagicLinkEmail({ to, magicLinkUrl }: { to: string; magicLinkUrl: string }) {
  await resend.emails.send({
    from: "Outrival ",
    to,
    subject: "Votre lien de connexion à Outrival",
    html: render(),
  });
}
```

→ vérifier : email reçu avec design dark + amber, lien fonctionnel
→ vérifier : domain auth@outrival.io vérifié dans Resend (sinon spam)

Commit : `feat(emails): magic link email template with outrival design`

---

## Étape 3 — Anti-disposable email + validation Zod stricte

### packages/shared/src/validation/email.ts

```typescript
import { z } from "zod";

// Liste hardcodée des domaines jetables les plus courants
// Source : disposable-email-domains (npm) si on veut une liste exhaustive
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com",
  "throwaway.email", "tempmail.com", "trashmail.com", "yopmail.com",
  "fakeinbox.com", "dispostable.com", "maildrop.cc", "sharklasers.com",
  "getnada.com", "tempail.com", "tmpmail.org",
  // ... à enrichir par observation
]);

export const emailSchema = z.string()
  .trim()
  .toLowerCase()
  .min(3, "Email trop court")
  .max(254, "Email trop long")
  // Regex stricte (pas juste présence du @)
  .regex(
    /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/,
    "Format d'email invalide"
  )
  .refine(
    (email) => {
      const domain = email.split("@")[1];
      return !DISPOSABLE_DOMAINS.has(domain);
    },
    { message: "Les emails temporaires ne sont pas acceptés" }
  );

// Schéma de l'input de la page auth
export const authInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).optional(),  // optionnel : magic link possible
  turnstileToken: z.string().min(1, "Vérification anti-bot requise"),
});
```

→ vérifier : tests unitaires sur cas valides/invalides/disposables

Commit : `feat(validation): strict email schema with disposable domain filter`

---

## Étape 4 — HaveIBeenPwned check pour passwords

### packages/shared/src/validation/password.ts

```typescript
import { createHash } from "node:crypto";

/**
 * Vérifie si un mot de passe a fui dans des breaches connus.
 * Utilise k-anonymity : on envoie les 5 premiers chars du SHA-1 hash,
 * pas le password en clair.
 */
export async function isPasswordPwned(password: string): Promise {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return false;  // fail open : si HIBP est down, on accepte

    const text = await response.text();
    const lines = text.split("\n");

    for (const line of lines) {
      const [hashSuffix] = line.split(":");
      if (hashSuffix.trim() === suffix) {
        return true;  // password trouvé dans une breach
      }
    }
    return false;
  } catch {
    return false;  // fail open en cas d'erreur réseau
  }
}

// Schéma password avec check HIBP + règles minimales
import { z } from "zod";

export const passwordSchema = z.string()
  .min(12, "12 caractères minimum")
  .max(128, "128 caractères maximum")
  // Pas de complexity rules infâmes — la longueur suffit
  // Le check HIBP se fait à la soumission (async)
  ;

export async function validatePasswordWithHibp(password: string): Promise {
  const basic = passwordSchema.safeParse(password);
  if (!basic.success) {
    return { valid: false, reason: basic.error.issues[0].message };
  }
  if (await isPasswordPwned(password)) {
    return {
      valid: false,
      reason: "Ce mot de passe a été compromis dans une fuite de données connue. Choisissez-en un autre.",
    };
  }
  return { valid: true };
}
```

→ vérifier : password "password123" → pwned = true
→ vérifier : password unique fort → pwned = false
→ vérifier : HIBP down → fail open (pas de blocage)

Commit : `feat(validation): password validation with haveibeenpwned check`

---

## Étape 5 — Rate limiting auth-specific

### apps/api/src/middleware/auth-rate-limit.ts

```typescript
import { redis } from "@outrival/shared";
import { createMiddleware } from "hono/factory";

const EMAIL_MAX = Number(process.env.AUTH_RATE_LIMIT_EMAIL ?? 3);
const IP_MAX = Number(process.env.AUTH_RATE_LIMIT_IP ?? 10);
const WINDOW_SEC = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MIN ?? 15) * 60;

export const authRateLimit = createMiddleware(async (c, next) => {
  const body = await c.req.json().catch(() => ({}));
  const email = body.email?.toLowerCase();
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";

  // 1. Rate limit par IP (toujours)
  const ipKey = `ratelimit:auth:ip:${ip}`;
  const ipCount = await redis.incr(ipKey);
  if (ipCount === 1) await redis.expire(ipKey, WINDOW_SEC);
  if (ipCount > IP_MAX) {
    return c.json({
      error: {
        code: "rate_limited",
        message: "Trop de tentatives. Patientez 15 minutes.",
      }
    }, 429);
  }

  // 2. Rate limit par email (si fourni)
  if (email) {
    const emailKey = `ratelimit:auth:email:${email}`;
    const emailCount = await redis.incr(emailKey);
    if (emailCount === 1) await redis.expire(emailKey, WINDOW_SEC);
    if (emailCount > EMAIL_MAX) {
      // Pas de message différent — anti-enumeration
      return c.json({
        error: {
          code: "rate_limited",
          message: "Trop de tentatives. Patientez 15 minutes.",
        }
      }, 429);
    }
  }

  await next();
});
```

Appliquer ce middleware sur toutes les routes auth (login, register, magic link request).

→ vérifier : 4ème tentative sur même email → 429
→ vérifier : 11ème tentative sur même IP → 429
→ vérifier : window expire → compteur reset

Commit : `feat(api): auth-specific rate limiting per email and ip`

---

## Étape 6 — Vérification Turnstile côté backend

### apps/api/src/lib/turnstile.ts

```typescript
export async function verifyTurnstileToken(token: string, ip: string): Promise {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    // En dev sans Turnstile configuré, on bypass
    console.warn("TURNSTILE_SECRET_KEY not set, bypassing verification (dev only)");
    return true;
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ip,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const result = await response.json() as { success: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
```

Appliquer la vérification sur les routes auth (avant tout traitement).

→ vérifier : token valide → 200
→ vérifier : token invalide ou absent → 400
→ vérifier : en dev sans clé Turnstile → bypass silencieux

Commit : `feat(api): cloudflare turnstile token verification`

---

## Étape 7 — Endpoint unifié de check d'email (anti-enumeration)

### apps/api/src/routes/auth.ts

Endpoint qui détermine intelligemment si on doit afficher le flow login ou
register, SANS révéler l'existence de l'email.

```
POST /api/auth/check-and-send-magic-link
  Body: { email, turnstileToken }

  Étapes (toutes silencieuses pour l'extérieur) :
  1. Vérifier rate limit (middleware)
  2. Vérifier Turnstile (middleware)
  3. Valider email avec emailSchema
  4. Vérifier si l'email existe en base
  5. Si existe → envoyer magic link (login)
     Si n'existe pas → créer un compte minimal + envoyer magic link (register inline)
  6. RETOURNER LA MÊME RÉPONSE dans les deux cas :
     { ok: true, message: "Si cet email est valide, un lien vous a été envoyé." }
```

Le frontend reçoit le même message dans les deux cas → impossible pour un
attaquant de savoir si un email est dans la base.

```typescript
authRouter.post("/check-and-send-magic-link",
  authRateLimit,
  async (c) => {
    const body = await c.req.json();

    // Vérifier Turnstile
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const turnstileOk = await verifyTurnstileToken(body.turnstileToken, ip);
    if (!turnstileOk) {
      return c.json({
        error: { code: "captcha_failed", message: "Vérification anti-bot échouée. Réessayez." }
      }, 400);
    }

    // Valider email
    const parsed = emailSchema.safeParse(body.email);
    if (!parsed.success) {
      // Erreur générique pour ne pas leak la raison spécifique
      return c.json({
        error: { code: "invalid_email", message: "Cet email n'est pas accepté." }
      }, 400);
    }
    const email = parsed.data;

    // Vérifier si l'utilisateur existe
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      // Login : envoyer magic link
      await auth.api.signInMagicLink({ body: { email } });
    } else {
      // Register inline : créer le compte minimal + magic link
      await auth.api.signUp({
        body: { email, password: crypto.randomUUID() },  // password aléatoire, jamais utilisé
      });
      await auth.api.signInMagicLink({ body: { email } });
    }

    // RÉPONSE IDENTIQUE dans les deux cas (anti-enumeration)
    return c.json({
      ok: true,
      message: "Si cet email est valide, un lien de connexion vous a été envoyé.",
    });
  }
);
```

→ vérifier : email existant → magic link envoyé, réponse "Si valide..."
→ vérifier : email inexistant → compte créé + magic link envoyé, MÊME réponse
→ vérifier : email malformé → erreur générique
→ vérifier : on ne peut PAS deviner si un email existe depuis la réponse HTTP

Commit : `feat(api): unified auth endpoint with anti-enumeration guarantee`

---

## Étape 8 — Page /auth unifiée

### apps/web/src/app/auth/page.tsx

Une seule page, sans tabs login/register.

```typescript
"use client";
import { useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState(null);
  const [showPasswordOption, setShowPasswordOption] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleMagicLink = async () => {
    if (!turnstileToken) {
      setErrorMessage("Validation anti-bot en cours...");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/auth/check-and-send-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("sent");
      } else {
        setStatus("error");
        setErrorMessage(data.error?.message ?? "Une erreur est survenue.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Connexion impossible. Réessayez.");
    }
  };

  const handleGoogleSignIn = () => {
    window.location.href = "/api/auth/sign-in/google";
  };

  const handlePasswordLogin = async () => {
    // Flow classique email + password via Better Auth client
    // ... appel auth.signIn.email() avec password
    // Si email inexistant → message générique
  };

  return (
    
      
        {/* Wordmark Outrival */}
        
          out
          rival
        

        {/* Titre subtil */}
        
          Accédez à votre veille
        
        

        {/* État envoyé */}
        {status === "sent" ? (
          <SuccessState email={email} onReset={() => setStatus("idle")} />
        ) : (
          <>
            {/* Email primary */}
            
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@votre-entreprise.com"
                autoComplete="email"
                className="w-full px-4 py-3 bg-surface border border-border rounded-md text-white focus:border-amber-500 focus:outline-none transition-colors"
                onBlur={() => validateEmailInline(email)}
              />

              {!showPasswordOption ? (
                <button
                  onClick={handleMagicLink}
                  disabled={!email || status === "sending"}
                  className="w-full px-4 py-3 bg-amber-500 text-bg font-semibold rounded-md hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  {status === "sending" ? "Envoi..." : "→ Recevoir le lien de connexion"}
                
              ) : (
                <>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Votre mot de passe"
                    autoComplete="current-password"
                    className="w-full px-4 py-3 bg-surface border border-border rounded-md text-white"
                  />
                  
                    Se connecter
                  
                </>
              )}
            

            {/* Divider */}
            
              
              ou
              
            

            {/* Google OAuth */}
            
              
              Continuer avec Google
            

            {/* Toggle password option */}
            <button
              onClick={() => setShowPasswordOption(!showPasswordOption)}
              className="mt-6 text-sm text-text-muted hover:text-white transition-colors"
            >
              ↳ {showPasswordOption ? "Utiliser le magic link" : "Préférez un mot de passe ?"}
            

            {/* Erreur */}
            {status === "error" && (
              {errorMessage}
            )}

            {/* Turnstile invisible */}
            
          </>
        )}

        {/* Footer subtil */}
        
          En vous connectant, vous acceptez nos conditions d'utilisation et notre politique de confidentialité.
        
      
    
  );
}

function SuccessState({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    
      
        Vérifiez votre email
        
          Si {email} est un email valide, un lien de connexion vient d'être envoyé.
        
        
          Le lien expire dans 10 minutes.
        
      
      
        ← Utiliser un autre email
      
    
  );
}
```

Validation inline au blur (pas au keystroke, pas agressif) :

```typescript
function validateEmailInline(email: string): string | null {
  if (!email) return null;
  const result = emailSchema.safeParse(email);
  if (!result.success) return result.error.issues[0].message;
  return null;
}
```

→ vérifier : page chargée → wordmark + champ email + bouton magic link + Google + toggle password
→ vérifier : email submit → état "vérifiez votre email"
→ vérifier : Google click → redirige vers OAuth Google
→ vérifier : toggle password → champ password apparaît, magic link disparaît
→ vérifier : email invalide au blur → message d'erreur
→ vérifier : Turnstile invisible se charge en bas (visible que si défi)
→ vérifier : responsive mobile

Commit : `feat(web): unified auth page with magic link primary and google oauth`

---

## Étape 9 — Suppression de l'ancien register / login séparés

Si Phase 1 a créé des pages `/login` et `/register` séparées, les supprimer
et rediriger vers `/auth`.

```typescript
// apps/web/src/app/login/page.tsx → supprimer
// apps/web/src/app/register/page.tsx → supprimer
// apps/web/src/middleware.ts (ou layout) → ajouter redirect /login → /auth, /register → /auth
```

Vérifier les liens internes dans l'app qui pointent vers `/login` ou `/register`
et les mettre à jour.

→ vérifier : ancienne URL /login → 308 redirect vers /auth
→ vérifier : ancienne URL /register → 308 redirect vers /auth
→ vérifier : aucun lien interne ne pointe encore vers les anciennes URLs

Commit : `refactor(web): consolidate login and register into unified /auth`

---

## Étape 10 — Funnel events PostHog (patch-03 compatible)

### apps/web/src/app/auth/page.tsx (modification)

Ajouter les events PostHog aux moments clés (compatible patch-03, gating
consentement) :

```typescript
import { track } from "@/lib/posthog/events";

// Au submit magic link
track("auth_magic_link_requested", { method: "magic_link" });

// Au click Google
track("auth_google_clicked");

// Au toggle password
track("auth_password_option_clicked");

// Sur success state (= magic link envoyé)
track("auth_magic_link_sent");

// Sur callback OAuth Google success
track("auth_google_completed");
```

Côté backend, événements pour distinguer login vs register :

```typescript
// dans /api/auth/check-and-send-magic-link
if (existingUser) {
  posthogServer.capture({ distinctId: existingUser.id, event: "user_logged_in", properties: { method: "magic_link" } });
} else {
  posthogServer.capture({ distinctId: newUserId, event: "user_signed_up", properties: { method: "magic_link" } });
}
```

→ vérifier : flow magic link → events visibles dans PostHog
→ vérifier : flow Google → events visibles
→ vérifier : pas de tracking avant consentement (patch-03 strict)

Commit : `feat(analytics): track auth funnel events for posthog`

---

## Étape 11 — Vérification finale + tests

```bash
pnpm build && pnpm typecheck
```

Test end-to-end exhaustif :

### A. Magic link
1. Page /auth → entrer email valide → "Recevoir le lien"
2. Vérifier email reçu avec design Outrival
3. Click sur le lien → connecté à Outrival
4. Vérifier session active 30 jours

### B. Google OAuth
1. Click "Continuer avec Google"
2. Authentification Google → callback
3. Compte créé automatiquement si nouveau
4. Session active

### C. Email + password fallback
1. Toggle "Préférez un mot de passe ?"
2. Si nouveau compte : pas de flow direct (le password n'est jamais setté volontairement)
   → on doit avoir un flow "set password" depuis settings après login magic link
3. Si compte existant avec password : login fonctionne

### D. Anti-enumeration
1. Soumettre email d'un compte existant → réponse "Si valide, lien envoyé"
2. Soumettre email inexistant → MÊME réponse
3. Soumettre email mal formé → réponse générique
4. Aucune façon de distinguer un email connu d'un inconnu depuis le réseau

### E. Rate limiting
1. 4 tentatives sur même email en 15min → 429 sur la 4ème
2. 11 tentatives sur même IP en 15min → 429 sur la 11ème
3. Wait 15min → compteurs reset

### F. Validation
1. Email mal formé (pas de @) → erreur générique
2. Email disposable (mailinator.com) → erreur générique
3. Password trop court (<12) → erreur
4. Password compromis (HIBP) → erreur "Ce mot de passe a été compromis"

### G. Captcha
1. Soumettre sans Turnstile valide → 400 captcha_failed
2. Turnstile invisible se charge automatiquement
3. Bot detection déclenche défi visible si comportement suspect

### H. UI/UX
1. Wordmark "out" + "rival" amber visible
2. Layout asymétrique (pas centré bête)
3. Hiérarchie email > Google > password respectée
4. Pas d'orbe, pas de gradient violet
5. Responsive mobile fonctionnel
6. Focus ring amber sur les inputs
7. Tagline "Accédez à votre veille" + barre amber

### I. Cohérence patch-14
1. Messages d'erreur en 3 parties (passé / présent / action)
2. Pas de stack trace exposée
3. Erreur API formatée comme convention patch-14

### J. PostHog (patch-03)
1. Consent banner s'affiche AVANT tout tracking
2. Si refus → aucun event auth tracké
3. Si accept → events apparaissent dans PostHog

### K. Migrations
1. Anciens users avec compte email+password → peuvent toujours se connecter
2. Anciens users peuvent passer au magic link sans setup
3. URLs /login et /register redirigent vers /auth

Mettre à jour findings.md :
- Domain Resend vérifié pour @outrival.io
- Google OAuth callback URLs configurées (dev + prod)
- Turnstile site configuré
- Taux d'utilisation magic link vs Google vs password observé en beta
- Faux positifs disposable email à corriger (liste à enrichir)

task_plan.md : patch-19 → complete.
</task>

<constraints>
- Anti-enumeration ABSOLUE : impossible de savoir si un email existe depuis la réponse
- Réponses identiques pour login et register inline
- Magic link expire en 10 minutes (Better Auth config)
- Rate limit Redis (Upstash déjà branché)
- Turnstile invisible (mode managed), pas de friction normale
- Email format strict + anti-disposable
- Password 12+ chars + HIBP check (fail open si HIBP down)
- Page UNIQUE /auth, pas de /login ni /register séparés
- Design Outrival (asymétrique sobre, dark + amber, General Sans/Geist)
- Wordmark "out" + "rival" amber, jamais un logo blob
- Pas de stock illustration, pas d'orbe, pas de gradient violet-bleu
- Better Auth pour TOUT (magic link + Google + password)
- Resend pour les emails magic link (déjà branché)
- Events PostHog respectent le consentement (patch-03)
- Messages d'erreur en 3 parties (patch-14)
- Compatibilité backward : anciens comptes email+password continuent de fonctionner
- Redirections 308 pour les anciennes URLs /login et /register
- Pas de SSO Enterprise, pas de Apple, pas de GitHub, pas de Passkeys (Backlog)
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@docs/design-system.md
@apps/api/CLAUDE.md
@apps/web/CLAUDE.md
@PHASES/01-foundation.md
@PHASES/patch-03-analytics-posthog.md
@PHASES/patch-04-errors-logs-uptime.md
@PHASES/patch-14-trust-and-clarity.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Magic link fonctionne end-to-end (envoi + click + session)
✓ Google OAuth fonctionne end-to-end
✓ Password en fallback toujours fonctionnel (rétrocompatibilité)
✓ Anti-enumeration vérifiée : impossible de distinguer email connu/inconnu
✓ Rate limiting effectif (par email + par IP)
✓ Turnstile invisible se déclenche silencieusement
✓ HIBP check sur passwords (fail open si timeout)
✓ Disposable emails rejetés (mailinator, tempmail, etc.)
✓ Page /auth unique, /login et /register redirigent
✓ UI conforme design-system.md (asymétrique sobre, dark + amber, wordmark)
✓ Validation Zod sync client/backend
✓ Events PostHog après consentement
✓ Messages d'erreur en 3 parties (patch-14 convention)
✓ Mobile responsive
✓ Anciens comptes email+password fonctionnent toujours
✓ task_plan.md patch-19 = complete
</verification>

<commit>
chore: setup google oauth and turnstile env
feat(auth): enable magic link, google oauth, modernized password rules
feat(emails): magic link email template with outrival design
feat(validation): strict email schema with disposable domain filter
feat(validation): password validation with haveibeenpwned check
feat(api): auth-specific rate limiting per email and ip
feat(api): cloudflare turnstile token verification
feat(api): unified auth endpoint with anti-enumeration guarantee
feat(web): unified auth page with magic link primary and google oauth
refactor(web): consolidate login and register into unified /auth
feat(analytics): track auth funnel events for posthog
</commit>