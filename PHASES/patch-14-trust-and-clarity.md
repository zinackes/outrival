# Patch 14 — Confiance & clarté UX (divulgation progressive)

<context>
Trois trous UX dans Outrival qui partagent la même cause profonde : on ne pense
pas assez à la CHARGE COGNITIVE du user. On expose trop ou pas assez de la mauvaise
manière. Ce patch les corrige sous un seul principe directeur :

  **DIVULGATION PROGRESSIVE**
  Par défaut, juste assez pour rassurer. Sur clic, un peu plus.
  Le brut reste en backstage admin, jamais devant l'utilisateur.

Trois domaines traités, sous ce principe commun :

1. CONFIANCE DANS UN SIGNAL
   Comment l'user fait confiance à un insight IA ? Aujourd'hui : aucune
   transparence. Solution : 3 niveaux progressifs (inline / sur clic / admin).
   On NE MONTRE JAMAIS de HTML brut au user.

2. DATA FRESHNESS
   L'user voit une donnée sans savoir si elle date d'hier ou de 3 mois.
   Solution : pastilles colorées discrètes par section, tooltip pour le détail.
   Pas de timestamps partout (pollution visuelle).

3. GESTION D'ERREUR
   Aujourd'hui : pas de pattern systématique. Le user voit potentiellement
   des spinners infinis, "Something went wrong", ou rien. Solution : système
   cohérent (ErrorBoundary, toasts, retry) + messages en 3 parties
   (ce qui s'est passé / ce qu'on fait / ce que tu peux faire).

Anti-pattern à éviter absolument : "donner tout, c'est plus transparent".
NON. C'est plus paresseux. La vraie transparence c'est de filtrer pour ne
montrer que ce qui aide à comprendre.

Lire avant : @CLAUDE.md, @docs/architecture.md, @docs/design-system.md,
@PHASES/03-ai-intelligence.md (génération signals), @PHASES/05-enrichissement.md
(monitors, lastRunAt), @PHASES/patch-02-admin-ops.md (admin a déjà la vue brute),
@PHASES/patch-09-ai-cost-optimization.md (cache compatible), @apps/web/CLAUDE.md
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Env

Pas de nouvelle dépendance. Pas de nouvelle variable d'env.

Constantes à ajouter côté shared :
```typescript
// packages/shared/src/constants/freshness.ts
export const FRESHNESS_THRESHOLDS = {
  fresh: 7,     // < 7 jours → vert
  aging: 30,    // 7-30 jours → jaune
  // > 30 jours → rouge
};
```

→ vérifier : pnpm install propre

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Schéma : champ "changement lisible" sur les signals

### packages/db/src/schema/signals.ts (ou table équivalente de Phase 3)

Ajouter deux champs pour stocker le before/after en langage naturel parsé :

```typescript
humanChangeBefore: text("human_change_before"),  // "Standard · 99€/mois"
humanChangeAfter: text("human_change_after"),    // "Standard · 79€/mois"
```

Ces champs sont nullable (les anciens signals pré-patch ne les auront pas,
fallback gracieux côté UI).

pnpm db:push --filter @outrival/db

→ vérifier : colonnes ajoutées

Commit : `feat(db): add human-readable change description to signals`

---

## Étape 2 — Génération du langage naturel à la création du signal

### packages/ai/src/tasks/classify-change.ts

Étendre la sortie de la classification IA pour inclure le before/after en
langage humain. Le prompt doit demander explicitement :

```
"Identifie le changement principal. Décris-le en langage simple :
  - humanChangeBefore : la valeur AVANT, formulée naturellement
  - humanChangeAfter  : la valeur APRÈS, formulée naturellement
Si impossible à extraire proprement, retourne null pour les deux."
```

Exemple de sortie attendue :
```json
{
  "type": "pricing_decrease",
  "severity": "medium",
  "humanChangeBefore": "Standard · 99€/mois",
  "humanChangeAfter": "Standard · 79€/mois"
}
```

Important :
- Le cache (patch-09) reste compatible : même hash de diff → même résultat
- Les anciens signals (avant ce patch) auront ces champs à null → fallback gracieux

### apps/workers/src/jobs/scrape-monitor.job.ts (ou generate-signal job)

À la création du signal, persister humanChangeBefore / humanChangeAfter
depuis la classification.

→ vérifier : un nouveau signal contient les deux champs en langage naturel
→ vérifier : un signal mal extrait (champs null) → géré côté UI sans crash

Commit : `feat(ai): extract human-readable before/after on classification`

---

## Étape 3 — API : endpoint "détail d'un signal"

### apps/api/src/routes/signals.ts

```
GET /api/signals/:id/detail
  authMiddleware. Retourne :
  {
    signal: {
      id, title, insight, severity, detectedAt,
      humanChangeBefore, humanChangeAfter,
      sourceType,           // ex: "pricing"
      sourceUrl,            // URL de la page surveillée (live)
      competitor: { id, name }
    }
  }
```

PAS d'exposition du snapshot R2, PAS de classification brute, PAS de
metadata IA. Juste ce que le user peut consommer.

(Pour les besoins admin / debug, l'endpoint existant /api/admin/... du
patch-02 expose le détail complet incluant le snapshot.)

### apps/api/src/routes/competitors.ts

Ajouter au retour de la fiche concurrent les `lastScrapedAt` par source_type
pour calculer la freshness côté UI :

```typescript
// dans la réponse competitor detail
sources: {
  homepage:  { lastScrapedAt: "...", status: "success" | "failed" },
  pricing:   { lastScrapedAt: "...", status: "success" | "failed" },
  blog:      { lastScrapedAt: "...", status: "success" | "failed" },
  jobs:      { lastScrapedAt: "...", status: "success" | "failed" },
  reviews:   { lastScrapedAt: "...", status: "success" | "failed" },
}
```

→ vérifier : GET signal detail retourne uniquement les infos user-safe
→ vérifier : GET competitor inclut les lastScrapedAt par source

Commit : `feat(api): expose user-safe signal detail and per-source freshness`

---

## Étape 4 — Composant "Pourquoi cet insight ?" (UI)

### apps/web/src/components/outrival/signal-source-line.tsx (NIVEAU 1)

Mini ligne discrète en pied de chaque carte signal :

```typescript
function SignalSourceLine({ signal }: { signal: Signal }) {
  return (
    
      
      Source : page {sourceLabel(signal.sourceType)}
      ·
      Détecté le {formatDate(signal.detectedAt)}
      ·
      <button onClick={() => openWhyPanel(signal.id)} className="hover:text-text underline">
        Pourquoi cet insight ?
      
    
  );
}
```

Sobre, Geist Sans 13px, text-subtle (rgba 0.40). Toujours visible, jamais
intrusif.

### apps/web/src/components/outrival/why-insight-panel.tsx (NIVEAU 2)

Modal ou panneau latéral ouvert sur clic. Contenu strictement :

```
┌─ Pourquoi cet insight ? ───────────────────────────────┐
│                                                          │
│  CHANGEMENT DÉTECTÉ                                      │
│                                                          │
│    Avant     Standard · 99€/mois                        │
│    Après     Standard · 79€/mois                        │
│                                                          │
│  ── Source ──                                            │
│  Page pricing de Linear · linear.app/pricing            │
│  [↗ Voir la page actuelle]                              │
│                                                          │
│  ── Détection ──                                         │
│  Détecté le 12 mai 2026 à 14:32                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

C'est TOUT. Pas de HTML brut. Pas de diff technique. Pas de classification IA.
Le user voit en 5 secondes : *qu'est-ce qui a changé, où ça a été vu, quand*.

Si humanChangeBefore/After sont null (signal pré-patch ou extraction ratée) :
fallback gracieux → afficher "Détail non disponible" + lien vers la page live.
Pas de crash, pas de message d'erreur.

Design Outrival (dark, amber pour le titre, Geist Mono pour les valeurs
chiffrées dans le before/after).

### Intégration

Brancher SignalSourceLine sur chaque carte signal dans :
- Le feed principal du dashboard
- La fiche concurrent (signals d'un concurrent)
- L'email digest (équivalent simplifié : juste la phrase "Source · Détecté le")

→ vérifier : ligne source visible sous chaque signal
→ vérifier : clic "Pourquoi cet insight ?" → panneau avec before/after clair
→ vérifier : signal sans humanChange → fallback propre
→ vérifier : aucun HTML brut visible côté user (grep dans le DOM rendu)

Commit : `feat(web): add progressive signal traceability (source line + why panel)`

---

## Étape 5 — Indicateurs de freshness (UI)

### apps/web/src/components/outrival/freshness-dot.tsx

Composant atomique réutilisable.

```typescript
type FreshnessLevel = "fresh" | "aging" | "stale" | "failed";

function FreshnessDot({ lastScrapedAt, status }: {
  lastScrapedAt: string | null;
  status: "success" | "failed" | null;
}) {
  const level = computeFreshness(lastScrapedAt, status);
  const config = {
    fresh:  { color: "bg-positive",  label: "À jour" },
    aging:  { color: "bg-medium",    label: "Vieillissant" },
    stale:  { color: "bg-high",      label: "Obsolète" },
    failed: { color: "bg-critical",  label: "Échec du dernier scan" },
  }[level];

  return (
    
        {config.label}
        {lastScrapedAt && <> · Dernier scan {formatDateTime(lastScrapedAt)}</>}
      </>
    }>
      
    
  );
}

function computeFreshness(date: string | null, status: string | null): FreshnessLevel {
  if (status === "failed") return "failed";
  if (!date) return "stale";
  const days = (Date.now() - new Date(date).getTime()) / 86400000;
  if (days < FRESHNESS_THRESHOLDS.fresh) return "fresh";
  if (days < FRESHNESS_THRESHOLDS.aging) return "aging";
  return "stale";
}
```

### Intégration dans la fiche concurrent

Pour chaque section (Pricing, Features, Jobs, Reviews) sur la fiche concurrent,
ajouter une pastille à côté du titre :

```jsx

  Pricing
  

```

Pas de timestamp inline visible. Juste la pastille + tooltip au hover.

### Intégration sur la liste de concurrents

Une pastille globale par concurrent (basée sur la freshness la PLUS ANCIENNE
des 4 sources). Permet de repérer en un coup d'œil les concurrents dont la
donnée est obsolète.

→ vérifier : pastilles visibles et cohérentes avec le status réel
→ vérifier : tooltip donne la date exacte au hover
→ vérifier : un scrape failed → pastille rouge avec label clair

Commit : `feat(web): add subtle freshness indicators with progressive tooltip`

---

## Étape 6 — Système d'erreur cohérent

### apps/web/src/components/outrival/error-boundary.tsx

ErrorBoundary React global, monté dans le layout root.

```typescript
class ErrorBoundary extends React.Component {
  // catch des erreurs unhandled
  // envoie à Sentry (patch-04 déjà branché)
  // affiche un écran d'erreur sobre avec :
  //   - "Quelque chose s'est mal passé"
  //   - "Notre équipe a été notifiée"
  //   - [Rafraîchir la page] [Retour au dashboard]
  // PAS de stack trace exposée
}
```

### apps/api/src/lib/errors.ts

Format d'erreur API cohérent (étendre si déjà existant) :

```typescript
{
  error: {
    code: "monitor_unreachable" | "ai_failed" | "rate_limited" | ...,
    message: "Message en français, lisible par un humain",
    userAction?: "retry" | "wait" | "contact",
    retryAfterSeconds?: number,
  }
}
```

PAS de stack trace, PAS de SQL error, PAS de chemin de fichier. Toujours
filtré et humanisé.

### apps/web/src/lib/error-helpers.ts

Helper qui convertit un code d'erreur API en composant utilisateur :

```typescript
const ERROR_CONFIGS: Record = {
  monitor_unreachable: {
    title: "Impossible de joindre le site",
    description: "Nous re-tentons automatiquement dans 1 heure.",
    action: { label: "Réessayer maintenant", type: "retry" },
  },
  ai_failed: {
    title: "L'analyse n'a pas abouti",
    description: "Notre équipe a été notifiée.",
    action: { label: "Réessayer", type: "retry" },
  },
  rate_limited: {
    title: "Trop de requêtes",
    description: "Patientez quelques minutes avant de réessayer.",
    action: null,
  },
  // ... etc
};
```

Trois parties par message : ce qui s'est passé / ce qu'on fait / ce que le user peut faire.

### Toast component (shadcn)

Réutiliser <Toast> de shadcn pour les erreurs transitoires (échec d'une
action utilisateur non bloquante). Toujours en 3 parties.

### États vides + erreurs sur les listes

Pour chaque liste principale (signals feed, concurrents, jobs) :
- État vide propre (avec call-to-action si pertinent)
- État erreur avec retry button
- État chargement (skeleton)

Pas un blanc, pas un spinner infini, pas un message technique.

→ vérifier : déclencher une erreur API → toast avec message humain + action
→ vérifier : déclencher une erreur React → ErrorBoundary affiche l'écran sobre
→ vérifier : aucun message d'erreur technique visible côté user
→ vérifier : Sentry capture toujours bien (patch-04 fonctionne)

Commit : `feat(web): add coherent error handling with progressive disclosure`

---

## Étape 7 — Application transversale (passe de polish)

Une fois les composants prêts (étapes 4, 5, 6), faire une passe transversale
sur les vues principales pour appliquer partout :

```
☐ Dashboard signal feed       SignalSourceLine sous chaque signal
☐ Fiche concurrent            FreshnessDot par section + SignalSourceLine
☐ Battle cards                SignalSourceLine sur les signals cités
☐ Sectoral signals (patch-13) Source line adaptée (multi-concurrents)
☐ My Product (patch-12)       FreshnessDot par section, "Détecté sur votre site"
                              utilise le même whyPanel
☐ Listes (concurrents, jobs)  États empty/loading/error cohérents
☐ Layout root                 ErrorBoundary monté
☐ Settings pages              Toast pour confirmation/erreur
☐ Onboarding (patch-08)       États d'erreur déjà OK, vérifier cohérence
```

Surgical : ne pas réécrire les vues, juste ajouter les composants.

→ vérifier : chaque vue principale a la divulgation progressive appliquée
→ vérifier : cohérence visuelle (les pastilles, les toasts, les panneaux
  utilisent les mêmes composants)

Commit : `feat(web): apply trust and clarity patterns across main views`

---

## Étape 8 — Vérification finale

```bash
pnpm build && pnpm typecheck
```

Test end-to-end :

### Confiance signal
1. Voir un signal → ligne "Source : pricing · Détecté le X · Pourquoi cet insight ?"
2. Click "Pourquoi cet insight ?" → modal avec before/after lisible, lien vers le site
3. Vérifier : AUCUN HTML brut visible, AUCUNE classification IA exposée
4. Signal pré-patch (sans humanChange) → fallback "Détail non disponible" propre

### Freshness
5. Fiche concurrent avec un scrape récent → toutes pastilles vertes
6. Forcer une section à 10 jours → pastille jaune, tooltip donne la date
7. Forcer un échec de scrape → pastille rouge, tooltip "Échec du dernier scan"
8. Aucun timestamp visible inline dans la fiche (juste les pastilles + tooltip)

### Erreur
9. Forcer une erreur API → toast en français, 3 parties, action proposée
10. Forcer une erreur React → ErrorBoundary affiche l'écran sobre, pas de stack
11. Sentry (patch-04) reçoit bien l'erreur côté ops
12. État vide d'une liste → message clair + CTA si pertinent
13. État erreur d'une liste → retry button visible

### Cohérence
14. Mêmes composants utilisés partout (grep `<FreshnessDot` et `<SignalSourceLine`)
15. Mêmes patterns de message (3 parties pour les erreurs)

Mettre à jour findings.md :
- Cas observés en pratique (signaux où l'extraction humanChange a raté)
- Ajustements de seuils freshness selon les retours beta

task_plan.md : patch-14 → complete.
</task>

<constraints>
- DIVULGATION PROGRESSIVE est le principe directeur, partout
- JAMAIS de HTML brut visible dans l'UI user (admin a déjà sa vue brute en patch-02)
- JAMAIS de stack trace, SQL error, ou message technique exposé au user
- JAMAIS de timestamp inline pollution — pastilles + tooltip uniquement
- Messages d'erreur TOUJOURS en 3 parties : passé / présent / action user
- humanChangeBefore/After nullable → fallback gracieux côté UI
- Composants atomiques réutilisables (FreshnessDot, SignalSourceLine, WhyInsightPanel)
- Cohérence visuelle : design system Outrival (dark + amber + Geist Mono pour chiffres)
- Le cache IA (patch-09) reste compatible avec l'extension de classifyChange
- Sentry (patch-04) continue de capturer les erreurs côté ops
- Surgical : étendre les vues existantes, ne pas réécrire
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@docs/design-system.md
@apps/web/CLAUDE.md
@apps/api/CLAUDE.md
@packages/ai/CLAUDE.md
@PHASES/03-ai-intelligence.md
@PHASES/05-enrichissement.md
@PHASES/patch-02-admin-ops.md
@PHASES/patch-04-errors-logs-uptime.md
@PHASES/patch-09-ai-cost-optimization.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Signal détaillé : 3 niveaux progressifs (inline / panel / admin)
✓ Aucun HTML brut visible côté user (grep DOM)
✓ humanChangeBefore/After générés sur nouveaux signals, fallback sur anciens
✓ FreshnessDot avec 4 niveaux (fresh/aging/stale/failed) + tooltip exact
✓ Aucun timestamp inline pollution dans les fiches
✓ ErrorBoundary global monté, écran d'erreur sobre sans stack
✓ Toast component utilisé pour erreurs transitoires
✓ Messages d'erreur tous en 3 parties (passé/présent/action)
✓ Format API errors cohérent (code + message + userAction)
✓ États empty/loading/error sur les listes principales
✓ Composants atomiques réutilisés partout (cohérence visuelle)
✓ Sentry capture toujours bien côté ops
✓ task_plan.md patch-14 = complete
</verification>

<commit>
feat(db): add human-readable change description to signals
feat(ai): extract human-readable before/after on classification
feat(api): expose user-safe signal detail and per-source freshness
feat(web): add progressive signal traceability (source line + why panel)
feat(web): add subtle freshness indicators with progressive tooltip
feat(web): add coherent error handling with progressive disclosure
feat(web): apply trust and clarity patterns across main views
</commit>