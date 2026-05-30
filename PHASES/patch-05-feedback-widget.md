# Patch 05 — Widget feedback / report bug (maison)

<context>
Troisième couche d'observabilité, avant la beta. C'est le canal direct
utilisateur — complémentaire de Sentry (erreurs automatiques) et PostHog
(comportement). Ici : ce que l'utilisateur remarque et veut te signaler.

Un widget léger maison : bouton flottant → modal → capture description +
page actuelle (auto) + erreurs console récentes (auto) + screenshot (optionnel).
Stocké en DB + ping Slack vers toi (ops). La vue riche des feedbacks viendra
dans patch-02 (admin) — ici on pose la capture, le stockage et la notif.

Lire avant : @CLAUDE.md, @docs/architecture.md, @docs/design-system.md,
@apps/web/CLAUDE.md, @apps/api/CLAUDE.md, @packages/db/CLAUDE.md
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances + env

```bash
# Capture de screenshot côté client
pnpm add html2canvas --filter @outrival/web
```

Ajouter dans `.env.local` :
```
OPS_SLACK_WEBHOOK_URL=     # ton webhook Slack perso (ops), distinct des webhooks org
```

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): install html2canvas for feedback screenshots`

---

## Étape 1 — Schéma : table feedback

### packages/db/src/schema/feedback.ts
```typescript
import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export const feedbackTypeEnum = pgEnum("feedback_type", ["bug", "idea", "other"]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["new", "reviewed", "resolved"]);

export const feedback = pgTable("feedback", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").references(() => organizations.id, { onDelete: "set null" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  type: feedbackTypeEnum("type").notNull().default("bug"),
  message: text("message").notNull(),
  pageUrl: text("page_url"),
  consoleErrors: jsonb("console_errors"),    // tableau d'erreurs récentes
  screenshotR2Key: text("screenshot_r2_key"),
  userAgent: text("user_agent"),
  status: feedbackStatusEnum("status").notNull().default("new"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

Ajouter au schema/index.ts. Puis : pnpm db:push --filter @outrival/db

→ vérifier : table feedback dans Drizzle Studio

Commit : `feat(db): add feedback table`

---

## Étape 2 — Helper Slack partagé (packages/shared)

Pour respecter les règles monorepo (api ne peut pas importer workers), mettre
le helper Slack dans shared.

### packages/shared/src/notify.ts
```typescript
export async function sendSlackMessage(webhookUrl: string, text: string): Promise {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // ne jamais faire échouer l'action principale à cause d'une notif
  }
}
```

Réexporter depuis packages/shared/src/index.ts.

(Optionnel, non bloquant : les workers pourront migrer vers ce helper partagé
plus tard. Ne pas forcer le refactor maintenant.)

→ vérifier : pnpm typecheck --filter @outrival/shared

Commit : `feat(shared): add shared slack notification helper`

---

## Étape 3 — Buffer d'erreurs console (client)

### apps/web/src/lib/feedback/error-buffer.ts
Garde en mémoire les dernières erreurs console pour les joindre au feedback.
```typescript
const MAX = 20;
const buffer: Array = [];

export function initErrorBuffer(): void {
  if (typeof window === "undefined") return;

  const push = (msg: string) => {
    buffer.push({ ts: Date.now(), message: msg.slice(0, 500) });
    if (buffer.length > MAX) buffer.shift();
  };

  window.addEventListener("error", (e) =>
    push(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) =>
    push(`Unhandled rejection: ${String(e.reason)}`));

  const orig = console.error;
  console.error = (...args: unknown[]) => {
    push(args.map(String).join(" "));
    orig(...args);
  };
}

export function getRecentErrors() {
  return [...buffer];
}
```

Initialiser initErrorBuffer() tôt (ex: dans un composant client monté dans le layout).

→ vérifier : provoquer une console.error → elle est dans le buffer

Commit : `feat(web): add client-side console error buffer`

---

## Étape 4 — API feedback (apps/api)

### apps/api/src/routes/feedback.ts
```
POST /api/feedback           (authMiddleware — utilisateurs connectés)
  body: {
    type: "bug"|"idea"|"other",
    message: string,
    pageUrl?: string,
    consoleErrors?: Array<{ ts, message }>,
    screenshot?: string,       // data URL JPEG base64 (optionnel)
    userAgent?: string,
  }
  → valider avec Zod (limiter message à ~5000 chars, screenshot à ~2MB)
  → générer l'id
  → si screenshot : décoder le base64, upload sur R2
    clé : feedback/{id}/screenshot.jpg
  → insérer dans la table feedback (orgId + userId depuis la session)
  → sendSlackMessage(OPS_SLACK_WEBHOOK_URL, message formaté) :
    "🐛 [{type}] feedback de {userId} sur {pageUrl}\n{message}"
  → retourner { ok: true }

GET /api/feedback            (owner uniquement — role check)
  → liste basique des feedbacks (la vue riche viendra dans patch-02)
```

Enregistrer le router dans index.ts.

→ vérifier : POST feedback → row créée + screenshot sur R2 + ping Slack reçu

Commit : `feat(api): add feedback submission endpoint with slack ping`

---

## Étape 5 — Widget feedback (apps/web)

### apps/web/src/components/outrival/feedback-widget.tsx ("use client")
- Bouton flottant discret en bas à droite (icône lucide MessageSquarePlus)
- Au clic → modal (shadcn Dialog) :
  - Sélecteur de type : Bug / Idée / Autre (radio ou tabs)
  - Textarea message (placeholder : "Décrivez le bug ou votre idée...")
  - Toggle "Joindre une capture d'écran" (optionnel)
  - Texte discret : "La page actuelle et les erreurs techniques récentes
    sont jointes automatiquement pour nous aider à débuguer."
  - Bouton "Envoyer"
- À l'envoi :
  - Si screenshot activé : html2canvas(document.body) → toDataURL("image/jpeg", 0.7)
    (JPEG qualité 0.7 pour limiter la taille)
  - Rassembler : message, type, window.location.href, getRecentErrors(),
    navigator.userAgent, screenshot
  - POST /api/feedback
  - Toast de confirmation : "Merci, c'est bien reçu 🙏"
  - Fermer le modal

Monter le widget dans le layout dashboard (utilisateurs connectés).
Design Outrival (dark, amber, discret, non intrusif — design-system.md).

→ vérifier : envoyer un feedback avec screenshot depuis l'UI → reçu en DB + Slack
→ vérifier : les erreurs console récentes sont bien jointes

Commit : `feat(web): add feedback widget with screenshot and context capture`

---

## Étape 6 — Vérification finale

```bash
pnpm build && pnpm typecheck
```

Test :
1. Cliquer le bouton flottant → modal s'ouvre
2. Envoyer un bug avec screenshot → row feedback créée
3. Vérifier le screenshot sur R2 (clé feedback/{id}/screenshot.jpg)
4. Vérifier le ping Slack reçu (ops webhook)
5. Provoquer une console.error puis envoyer un feedback → l'erreur est jointe
6. pageUrl + userAgent bien capturés

Mettre à jour findings.md :
- Limites html2canvas observées (images cross-origin, certains CSS)
- Taille moyenne des screenshots JPEG
- Note : vue riche des feedbacks à faire dans patch-02

task_plan.md : patch-05 → complete. Prochain : patch-02 (admin ops).
</task>

<constraints>
- Widget disponible pour les utilisateurs connectés (layout dashboard)
- Screenshot OPTIONNEL et l'utilisateur est informé de ce qui est joint
- Helper Slack dans packages/shared (api ne peut pas importer workers)
- sendSlackMessage ne doit JAMAIS faire échouer la soumission du feedback
- Screenshot en JPEG qualité 0.7 + cap de taille (~2MB) pour limiter le payload
- Valider les inputs avec Zod (cap message + screenshot)
- GET /api/feedback gaté owner uniquement
- La vue riche des feedbacks = patch-02, pas ici
- Design discret et non intrusif (design-system.md)
- Surgical : monter le widget dans le layout sans réécrire le reste
- Un commit par étape
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@docs/design-system.md
@apps/web/CLAUDE.md
@apps/api/CLAUDE.md
@packages/db/CLAUDE.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Le bouton flottant ouvre le modal
✓ Envoi d'un feedback → row en DB avec orgId + userId
✓ Screenshot optionnel uploadé sur R2 quand activé
✓ Ping Slack ops reçu à chaque feedback
✓ Erreurs console récentes + pageUrl + userAgent joints automatiquement
✓ L'échec d'un ping Slack ne fait pas échouer la soumission
✓ GET /api/feedback gaté owner
✓ task_plan.md patch-05 = complete
</verification>

<commit>
chore(deps): install html2canvas for feedback screenshots
feat(db): add feedback table
feat(shared): add shared slack notification helper
feat(web): add client-side console error buffer
feat(api): add feedback submission endpoint with slack ping
feat(web): add feedback widget with screenshot and context capture
</commit>