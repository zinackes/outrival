# Patch 08 — Onboarding par stade de projet

<context>
Refonte de l'étape 1 de l'onboarding pour accepter quatre stades de projet :
idée brute, document/pitch, en développement (GitHub), produit en ligne (URL).
Chaque stade débloque un mode d'input adapté, mais tous convergent vers le même
productProfile. À partir de l'étape 2, le flow reste identique (validation,
discovery, sélection, monitoring).

Objectifs au-delà du chemin nominal :
- Robustesse : chaque mode peut dégrader vers Description si échec
- Liberté : navigation arrière, reprise après fermeture, recommencer plus tard
- Confiance : mode Document en zéro-stockage avec promesse visible
- Continuité : première session guidée après l'étape 5, pas un mur vide
- Futur-proof : analyze/discover isolés des sessions auth pour un mode public futur

Décision clé : pour le mode Document, AUCUN stockage du fichier. Extraction en
mémoire uniquement, document libéré dès la réponse. Seul le productProfile validé
par l'utilisateur est persisté. C'est un argumentaire de confiance fort à exposer
clairement dans l'UI.

Lire avant : @CLAUDE.md, @docs/architecture.md, @apps/api/CLAUDE.md,
@apps/web/CLAUDE.md, @packages/ai/CLAUDE.md, @.claude/skills/ai-pipeline/SKILL.md,
@PHASES/04-competitor-discovery.md (le flow existant que ce patch refond)
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances + env

```bash
# Parsing de documents (mode pitch deck / spec)
pnpm add unpdf mammoth --filter @outrival/api

# Rien d'autre — GitHub utilise l'API publique sans SDK
```

Aucune nouvelle variable d'environnement.

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): add unpdf and mammoth for document analysis`

---

## Étape 1 — Schéma : stade + persistance du progrès

### packages/db/src/schema/organizations.ts
Ajouter aux colonnes existantes :
```typescript
projectStage: text("project_stage"),  // "idea" | "document" | "developing" | "live"
onboardingStep: text("onboarding_step"),  // "stage" | "input" | "profile" | "discover" | "monitoring" | "done"
onboardingSkipped: boolean("onboarding_skipped").notNull().default(false),
```

projectStage permet de retrouver et d'adapter l'expérience. onboardingStep permet
la reprise. onboardingSkipped autorise l'accès au dashboard sans avoir complété.

pnpm db:push --filter @outrival/db

→ vérifier : colonnes ajoutées dans Drizzle Studio

Commit : `feat(db): add project stage and onboarding progress to organizations`

---

## Étape 2 — Adaptateurs productProfile (packages/ai)

Quatre fichiers, sortie commune type ProductProfile. Garder packages/ai pur
(pas d'accès DB).

### packages/ai/src/profile/from-description.ts
Prompt Groq qui prend une description textuelle + tags catégoriels optionnels +
inspirations optionnelles → retourne ProductProfile.

```typescript
export async function fromDescription(input: {
  description: string;
  category?: string;        // tag sélectionné (B2B SaaS, DevTools, etc.)
  inspirations?: string[];  // 0-3 noms ou URLs de produits cités
}): Promise {
  // Prompt : transformer la description + tags + inspirations en ProductProfile
  // (catégorie, audience, value_prop, pricing_model)
  // Si inspirations fournies, les mentionner dans le prompt pour ancrer le ton
}
```

### packages/ai/src/profile/from-document.ts
Prend le texte déjà extrait (le caller a fait l'extraction PDF/DOCX en mémoire).
```typescript
export async function fromDocument(extractedText: string): Promise {
  // Garder uniquement les 10000 premiers caractères significatifs
  // (skip répétitions, table des matières)
  // Prompt Groq → ProductProfile
}
```

### packages/ai/src/profile/from-repo.ts
Prend des artefacts GitHub (README, package.json, structure /src) en input
structuré → ProductProfile.
```typescript
export interface RepoArtifacts {
  readme: string | null;
  packageJson: Record | null;
  topLevelDirs: string[];
  envExample: string | null;
  docsExcerpt: string | null;
}

export async function fromRepo(artifacts: RepoArtifacts): Promise {
  // Construire un prompt qui aide Groq à inférer le produit depuis le code
  // - dependencies dans package.json signalent la stack et donc le type de produit
  // - structure /src signale les features
  // - README est la source primaire de la promesse produit
}
```

### packages/ai/src/profile/from-url.ts
Wrapper du flow existant (quickFetchText + analyzeProduct) — pour homogénéiser
la surface d'API. Aucune logique nouvelle, juste un re-export typé.

### packages/ai/src/profile/index.ts
Export commun + type ProductProfile partagé.

→ vérifier : pnpm typecheck --filter @outrival/ai
→ vérifier : chaque adaptateur testé unitairement avec un input représentatif retourne un ProductProfile cohérent

Commit : `feat(ai): add four product profile adapters with shared output type`

---

## Étape 3 — Routes API par mode (apps/api)

Refactor apps/api/src/routes/onboarding.ts pour exposer une route par mode,
toutes convergeant vers le même format de réponse.

### POST /api/onboarding/analyze-description
authMiddleware. Body : `{ description, category?, inspirations? }`.
Appelle fromDescription. Stocke org.productProfile + projectStage = "idea".
Retourne `{ profile }`.

### POST /api/onboarding/analyze-document
authMiddleware. Multipart/form-data avec file.
Contraintes critiques :
- Max 10MB (middleware Hono bodyLimit)
- Headers de réponse : `Cache-Control: no-store`
- Le fichier n'est JAMAIS écrit sur disque ni uploadé sur R2
- Extraction texte en mémoire :
  - PDF → unpdf (extractText)
  - DOCX → mammoth (extractRawText)
  - .md / .txt → directement
- Appelle fromDocument(text)
- Le Buffer est garbage-collecté à la sortie de la fonction
- Stocke org.productProfile + projectStage = "document"
- Retourne `{ profile }`

Important : ne JAMAIS logger le contenu du fichier (Sentry, pino). Le path
de cette route doit être dans la config de redaction pour ne pas leaker
le binary dans les logs.

### POST /api/onboarding/analyze-repo
authMiddleware. Body : `{ repoUrl }` (ex: https://github.com/user/repo).
Étapes :
1. Valider l'URL (GitHub uniquement, parse owner/repo)
2. Fetch via API GitHub publique (rate limit 60/h sans token, OK pour MVP) :
   - GET /repos/{owner}/{repo} → infos basiques + default branch
   - GET /repos/{owner}/{repo}/readme → README brut
   - GET /repos/{owner}/{repo}/contents/package.json (si présent)
   - GET /repos/{owner}/{repo}/contents/ (top-level)
   - GET /repos/{owner}/{repo}/contents/.env.example (si présent)
   - GET /repos/{owner}/{repo}/contents/docs (si présent, 1-2 fichiers principaux)
3. Construire RepoArtifacts
4. fromRepo(artifacts) → ProductProfile
5. Stocke org.productProfile + projectStage = "developing"
6. Retourne `{ profile }`

Gestion d'erreurs (toutes les routes) :
- Si l'analyse retourne null ou échoue → 422 avec `{ error, fallback: "description" }`
- Le frontend propose alors de basculer en mode description sans recommencer

### POST /api/onboarding/analyze-url
Existant. Renommer pour cohérence (analyze → analyze-url). Garder projectStage = "live".

### PATCH /api/onboarding/profile
Existant, inchangé. Permet l'édition manuelle du profil après analyse.

### PATCH /api/onboarding/progress
Body : `{ step: "stage"|"input"|"profile"|"discover"|"monitoring"|"done" }`.
Met à jour org.onboardingStep. Appelé par le frontend à chaque transition.

### POST /api/onboarding/skip
Set onboardingSkipped = true + onboardingCompleted = true.
Permet à l'utilisateur d'accéder au dashboard sans avoir complété.
Retourne `{ ok }`.

→ vérifier : chaque endpoint testé avec un input réel retourne un profile valide
→ vérifier : l'endpoint document ne laisse aucune trace fichier (vérifier disque + R2)
→ vérifier : l'endpoint repo gère les repos privés (404 → retour explicite)

Commit : `feat(api): add per-mode onboarding endpoints with graceful fallback`

---

## Étape 4 — Détection d'URL temporaire (qualité d'input)

### apps/api/src/lib/url-quality.ts
Helper réutilisable.
```typescript
const TEMPORARY_HOSTS = [
  "localhost", "127.0.0.1", "0.0.0.0",
  ".vercel.app",   // previews (mais pas le domaine custom)
  ".netlify.app",
  ".ngrok.io", ".ngrok-free.app",
  ".replit.dev",
];

export function detectTemporaryUrl(url: string): { temporary: boolean; reason?: string } {
  try {
    const u = new URL(url);
    if (TEMPORARY_HOSTS.some((h) => u.hostname.endsWith(h) || u.hostname === h)) {
      return { temporary: true, reason: "Cette URL semble temporaire (preview ou local)" };
    }
    return { temporary: false };
  } catch {
    return { temporary: false };
  }
}
```

Utilisé par le frontend à l'étape 1 mode "live" pour afficher un warning (pas
un blocage) : *"On dirait une URL temporaire. Voulez-vous plutôt utiliser le
mode 'En développement' avec votre repo ?"*

Réexporter depuis packages/shared (utilisable côté client aussi).

Commit : `feat(shared): add temporary url detection helper`

---

## Étape 5 — UI onboarding refondu (apps/web)

### apps/web/src/app/(onboarding)/onboarding/page.tsx
State machine côté client. Persiste la progression via PATCH /onboarding/progress
à chaque transition d'étape. À l'arrivée, lit org.onboardingStep pour reprendre
où l'utilisateur s'était arrêté.

### Header global de l'onboarding
- Barre de progression visible : "Étape X sur 5"
- Engagement initial affiché brièvement à l'étape 1 : "Configuration en moins de 3 minutes"
- Bouton "Recommencer" toujours présent en haut à droite (reset le state)
- Bouton "Quitter pour l'instant" qui appelle POST /onboarding/skip

### Étape 1 — Choisir son stade

Question : *"Où en êtes-vous avec votre projet ?"*

Quatre cartes cliquables (design Outrival, dark + amber, layout en grille 2x2) :

```
○ J'ai une idée à explorer
  Décrivez votre concept en quelques mots

○ J'ai un pitch ou un brief
  Uploadez votre pitch deck ou business plan

○ Je suis en train de le développer
  Connectez votre repo GitHub public

○ Mon produit est en ligne
  Donnez-nous votre URL
```

Au clic d'une carte, l'utilisateur passe à l'étape 1-bis (le formulaire spécifique
au mode).

### Étape 1-bis — Le formulaire du mode choisi

**Mode "idée"** :
- Textarea description (300 caractères suggérés)
- Sélecteur catégorie (autocomplete avec suggestions : B2B SaaS, DevTools, Marketplace, Consumer, Fintech, Productivity, AI/ML, Healthcare, Education, autres)
- Input optionnel "Vous vous inspirez de..." (jusqu'à 3 noms ou URLs)
- Bouton "Analyser"
- POST /onboarding/analyze-description

**Mode "document"** :
- Zone de drop / sélection fichier (PDF, DOCX, MD, TXT, max 10MB)
- 🔒 Encadré visible et rassurant :
  > *"Votre document est analysé en mémoire et ne sera jamais stocké.*
  > *Seul le profil produit extrait sera sauvegardé."*
- Bouton "Analyser"
- POST /onboarding/analyze-document (multipart)

**Mode "developing"** :
- Input URL repo GitHub (validation : pattern github.com/owner/repo)
- Texte d'aide : *"Le repo doit être public. Vous pourrez connecter vos repos privés plus tard."*
- Bouton "Analyser"
- POST /onboarding/analyze-repo

**Mode "live"** :
- Input URL produit
- Détection à la saisie via detectTemporaryUrl → si temporaire, banner :
  *"On dirait une URL temporaire. Voulez-vous plutôt utiliser le mode 'En développement' ?"* + bouton "Changer de mode"
- Bouton "Analyser"
- POST /onboarding/analyze-url

### Loading state pendant l'analyse
- Spinner amber centré
- Message adapté au mode :
  - Description → "Analyse de votre concept..."
  - Document → "Lecture de votre document..."
  - GitHub → "Lecture de votre repo..."
  - URL → "Analyse de votre site..."
- ~3 à 15 secondes selon le mode

### Fallback en cas d'échec
Si la route retourne 422 avec `fallback: "description"` :
- Toast d'erreur explicite : *"L'analyse automatique n'a pas abouti."*
- Modal proposant : *"Décrivez plutôt votre produit en quelques mots"*
- Bouton "Continuer en mode description" → bascule sur le formulaire idée
  AVEC le contenu pré-rempli si on a quelque chose d'utilisable (ex: nom du repo)

### Étape 2 — Validation/édition du profil
Inchangé du flow actuel. Tous les champs éditables. Bouton "← Modifier" toujours
présent pour revenir à l'étape 1-bis du même mode.

### Étape 3 — Discovery
POST /onboarding/discover (existant). Loading. Liste des concurrents avec
overlap scores.

Nouveauté : si **tous les overlap < 30** :
- Banner amber en haut : *"On n'a pas trouvé de concurrents évidents."*
- Boutons proposés :
  - *"Affiner mon profil"* → retour étape 2
  - *"Ajouter manuellement"* → ouvre le champ d'ajout manuel
- L'utilisateur peut quand même cocher des concurrents si certains lui parlent

Champ "+ Ajouter un concurrent manuellement" toujours présent (URL + nom).

### Étape 4 — Préférences de monitoring (simplifiée)

Repenser cette étape pour réduire la friction.

Choix par défaut intelligents pré-cochés :
- Fréquence : "Quotidien" (par défaut)
- Sources : homepage + pricing + blog (cochées par défaut)

Affichage compact, le user peut juste valider sans rien lire en détail.

Lien discret : *"Personnaliser les préférences avancées"* (replie les options
détaillées, type fréquence par concurrent, alertes Slack, etc. — accessibles
ailleurs dans settings)

Bouton "Continuer" toujours actif.

### Étape 5 — Confirmation + première session

POST /onboarding/complete (existant).

Page d'accueil post-onboarding :
```
✓ Configuration terminée

Vos concurrents sont en cours d'analyse.
Le premier snapshot est lancé. Vous verrez les premiers signaux apparaître
dans le feed dans quelques minutes.

[Indicateur live des scrapes en cours : "3/4 concurrents analysés"]

Votre premier digest hebdomadaire vous sera envoyé lundi prochain.

Prochaines étapes recommandées :
□ Configurer votre webhook Slack pour les alertes temps-réel
□ Inviter un coéquipier
□ Personnaliser votre fréquence de monitoring

[Bouton] Aller au dashboard
```

Cette page est l'**onboarding complet** — pas une page transitoire. Elle se
réaffiche tant que les premiers scrapes ne sont pas tous finis.

→ vérifier : flow complet pour chaque mode (idée, document, GitHub, URL)
→ vérifier : navigation arrière fonctionne, pas de perte de state
→ vérifier : fermer l'onglet et revenir → reprend où l'utilisateur s'était arrêté
→ vérifier : skip fonctionne et autorise l'accès au dashboard
→ vérifier : URL temporaire détectée déclenche le warning

Commit : `feat(web): refactor onboarding with stage selection and four input modes`

---

## Étape 6 — Mode skip avec bannière de complétion

Cas du user qui a cliqué "Quitter pour l'instant" à l'onboarding.

### apps/web/src/components/outrival/onboarding-banner.tsx
Bannière persistante en haut du dashboard si :
- onboardingSkipped = true ET productProfile = null

Contenu :
> ⚠️ *"Complétez votre configuration pour activer la veille concurrentielle"*
> [Bouton] Compléter maintenant → renvoie sur /onboarding

Masquer la bannière dès que productProfile existe (l'utilisateur a fini par
configurer).

### apps/web/src/app/(dashboard)/layout.tsx
Modifier le check de l'étape 1 (Phase 4 actuelle) :
- Si onboardingCompleted = true OU onboardingSkipped = true → autoriser l'accès
- Sinon → redirect /onboarding (comme avant)

Surgical : ajouter la condition skip dans le check existant.

→ vérifier : skip → accès dashboard avec bannière
→ vérifier : compléter l'onboarding → bannière disparaît

Commit : `feat(web): add skip-onboarding mode with completion banner`

---

## Étape 7 — Re-onboarding depuis settings

Pour les users qui veulent changer de mode après coup (ex: leur projet a évolué,
ils sont passés d'idée à URL).

### apps/web/src/app/(dashboard)/settings/profile/page.tsx
Section "Profil produit" affichant :
- Le productProfile actuel (catégorie, audience, valeur, modèle)
- Le projectStage actuel
- Bouton "Mettre à jour mon profil produit" → reset onboardingStep + redirect /onboarding
  (mais sans toucher aux concurrents déjà suivis)

Important : recommencer l'onboarding NE supprime PAS les concurrents existants.
L'utilisateur peut juste re-analyser et raffiner sa découverte.

→ vérifier : re-onboarding depuis settings, les concurrents existants restent

Commit : `feat(web): add profile re-onboarding from settings`

---

## Étape 8 — Précautions techniques pour le mode Document

Implémenter strictement la promesse zéro-stockage.

### apps/api/src/index.ts
Vérifier que la route /api/onboarding/analyze-document a :
```typescript
app.post("/api/onboarding/analyze-document",
  bodyLimit({ maxSize: 10 * 1024 * 1024 }),  // 10MB
  authMiddleware,
  async (c) => {
    c.header("Cache-Control", "no-store");
    // ... extraction en mémoire, jamais d'écriture
  }
);
```

### apps/api/src/lib/sentry.ts (ou la config Sentry du patch-04)
Ajouter à la config Sentry :
```typescript
beforeSend(event) {
  if (event.request?.url?.includes("/onboarding/analyze-document")) {
    // ne pas envoyer le body de cette route à Sentry
    if (event.request) event.request.data = "[REDACTED — document upload]";
  }
  return event;
}
```

### packages/shared/src/logger.ts (le pino du patch-04)
Ajouter à la config redact :
- Ajouter `req.body` aux paths redactés pour les routes d'upload
- Vérifier qu'aucun middleware de logging ne capture le multipart raw

### Documentation
Ajouter dans findings.md une note explicite :
- Route document : aucun stockage, jamais
- Vérifié : pas de log du contenu, pas de Sentry du body, no-cache
- Garbage collection du Buffer à la sortie de la requête

→ vérifier : upload d'un PDF → analyser le système (disque, R2, logs, Sentry)
   → aucune trace du document
→ vérifier : faire planter volontairement la route → erreur dans Sentry SANS
   contenu du fichier

Commit : `feat(api): enforce zero-storage guarantees for document upload`

---

## Étape 9 — Architecture isolable pour mode public futur

Les routes analyze-* et discover ne doivent pas être trop couplées à l'auth
de session, pour permettre une exposition publique future (mode "validez votre
idée sans compte").

### Vérification structurelle
Lire chacune des routes /api/onboarding/analyze-* et /discover :
- L'authMiddleware ne doit servir qu'à récupérer orgId pour stocker le résultat
- La logique d'analyse (call à fromDescription/fromDocument/fromRepo/fromUrl)
  doit être facilement extractible
- Refactorer si nécessaire pour que la logique soit dans des helpers
  réutilisables, et les routes soient de fines couches d'auth + stockage

Aucune nouvelle route publique à créer dans CE patch — juste s'assurer que le
terrain est prêt.

Documenter dans findings.md :
- Les helpers analyzeFromX sont réutilisables sans session auth
- Pour exposer en public plus tard : nouvelle route /api/public/analyze-idea
  avec rate-limit Upstash par IP + captcha invisible Turnstile

Commit : `refactor(api): isolate analysis logic from auth coupling`

---

## Étape 10 — Vérification finale

```bash
pnpm build && pnpm typecheck && pnpm dev && pnpm trigger:dev
```

Test end-to-end exhaustif :

### A. Mode "idée"
1. Onboarding depuis nouveau compte
2. Choisir "J'ai une idée"
3. Décrire : "Outil pour suivre les concurrents d'une startup B2B SaaS"
4. Sélectionner catégorie "B2B SaaS" + inspirations "Linear, Crayon"
5. Profil cohérent généré
6. Suite normale jusqu'à la fin

### B. Mode "document"
1. Upload un PDF de pitch deck réel
2. Profil extrait
3. Vérifier sur le serveur : aucun fichier sur disque, rien sur R2
4. Vérifier les logs : aucune trace du contenu

### C. Mode "developing"
1. Coller une URL de repo GitHub public (ex: github.com/anthropic/anthropic-cookbook)
2. Profil extrait depuis README + package.json
3. Cohérence du profil avec le contenu du repo

### D. Mode "live"
1. URL temporaire (localhost ou vercel preview) → warning affiché
2. URL réelle → flow normal

### E. Navigation et reprise
1. Démarrer en mode idée, aller à l'étape 3
2. Cliquer "← Modifier le profil"
3. Modifier, revenir étape 3 → discovery refaite
4. Fermer l'onglet, rouvrir → reprend à l'étape 3

### F. Échec gracieux
1. Forcer une erreur sur l'analyse repo (URL inexistante)
2. Fallback proposé → bascule mode description
3. Continue le flow normalement

### G. Skip
1. Cliquer "Quitter pour l'instant" à l'étape 2
2. Arriver sur le dashboard avec bannière persistante
3. Cliquer "Compléter maintenant" → revient sur /onboarding

### H. Pas de concurrents trouvés
1. Décrire un produit ultra-niche
2. Discovery retourne overlap < 30 pour tous
3. Banner s'affiche, propose d'affiner ou d'ajouter manuellement

### I. Re-onboarding depuis settings
1. Settings → Profil produit → "Mettre à jour mon profil"
2. Re-faire onboarding en mode différent
3. Vérifier : concurrents existants préservés

### J. Première session
1. Compléter l'onboarding
2. Page de confirmation avec indicateur live des scrapes
3. Recommandations suivantes affichées

### K. Documentation
Mettre à jour findings.md :
- Note explicite sur le zéro-stockage du mode Document
- Vérifications faites
- Heuristiques d'URL temporaire
- Architecture isolable pour public futur

task_plan.md : patch-08 → complete.
</task>

<constraints>
- Mode Document : ZÉRO stockage. Jamais sur disque. Jamais sur R2. Jamais en log.
- Tous les adaptateurs convergent vers le même type ProductProfile
- packages/ai reste PUR (pas d'accès DB, c'est l'API qui stocke)
- Persistance d'onboardingStep à chaque transition (PATCH /onboarding/progress)
- Navigation arrière toujours possible sans perte de state
- Fallback gracieux : chaque mode peut basculer vers Description en cas d'échec
- Skip-mode autorise l'accès au dashboard avec bannière non-bloquante
- Recommencer l'onboarding NE supprime PAS les concurrents existants
- Detection d'URL temporaire = WARNING, jamais blocage
- Defaults intelligents à l'étape monitoring (préférences avancées repliées)
- Surgical : refactor de l'onboarding sans casser le code post-onboarding (dashboard, fiches, signals)
- Aucun couplage fort à la session pour les routes analyze-* (futur mode public)
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@apps/api/CLAUDE.md
@apps/web/CLAUDE.md
@packages/ai/CLAUDE.md
@packages/db/CLAUDE.md
@.claude/skills/ai-pipeline/SKILL.md
@PHASES/04-competitor-discovery.md
@PHASES/patch-04-errors-logs-uptime.md (pour la config Sentry/pino redaction)
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Schema étendu avec projectStage, onboardingStep, onboardingSkipped
✓ Les 4 modes d'onboarding produisent un productProfile valide
✓ Mode Document : aucun fichier stocké (disque, R2, log, Sentry vérifiés)
✓ Mode GitHub : extraction depuis repo public via API GitHub
✓ URL temporaire détectée et warning affiché (pas blocage)
✓ Navigation arrière entre étapes sans perte de state
✓ Fermer / rouvrir l'onglet → reprise sur la bonne étape
✓ Échec d'analyse → fallback gracieux vers mode Description
✓ Skip → dashboard accessible avec bannière de complétion
✓ Re-onboarding depuis settings sans perdre les concurrents
✓ Pas de concurrents trouvés → banner d'affinement + ajout manuel
✓ Defaults intelligents à l'étape monitoring (préférences repliées)
✓ Page post-onboarding avec indicateur live + recommandations
✓ Architecture isolable pour exposition publique future documentée
✓ task_plan.md patch-08 = complete
</verification>

<commit>
chore(deps): add unpdf and mammoth for document analysis
feat(db): add project stage and onboarding progress to organizations
feat(ai): add four product profile adapters with shared output type
feat(api): add per-mode onboarding endpoints with graceful fallback
feat(shared): add temporary url detection helper
feat(web): refactor onboarding with stage selection and four input modes
feat(web): add skip-onboarding mode with completion banner
feat(web): add profile re-onboarding from settings
feat(api): enforce zero-storage guarantees for document upload
refactor(api): isolate analysis logic from auth coupling
</commit>