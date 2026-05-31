# Patch 11 — Détection avancée du pricing

<context>
Le scraper pricing actuel raisonne en binaire : prix trouvé OU pas trouvé.
C'est trompeur — il existe en réalité 7 patterns de pricing distincts, et
"pas trouver" est souvent une information stratégique en soi (un concurrent
qui passe en gated change de positionnement).

Ce patch refond le pricing scraper autour d'une taxonomie à 6 statuts :

  public           Tarifs affichés clairement
  public_partial   Certains tiers visibles, d'autres "Contact us"
  gated_demo       Aucun prix, redirige vers démo / sales
  gated_signup     Aucun prix, nécessite création de compte
  dynamic          Calculateur interactif (impossible à scraper statiquement)
  unknown          Non détecté, raison incertaine

Bénéfices :
- Plus de faux échecs : public_partial et dynamic deviennent des succès partiels
- Signal stratégique nouveau : "pricing repositionné" (public → gated)
- Réduction du bruit promo (Black Friday, early bird, lifetime deals)
- Honnêteté UI : afficher le bon état au lieu de "prix introuvable"

Ce patch couvre la taxonomie + signaux + détection promo + variations promo.
Reportés (voir Notion Roadmap) :
- Variation multi-région (scraping depuis plusieurs IP)
- Suivi multi-produit (Notion = plusieurs SKU, surveiller chaque)
- Parsing usage-based pricing (grilles de tarifs unitaires AWS/OpenAI)

Lire avant : @CLAUDE.md, @docs/architecture.md, @packages/scrapers/CLAUDE.md,
@packages/scrapers/src/scrapers/pricing.ts (le scraper existant), @findings.md,
@PHASES/05-enrichissement.md (Phase 5 où le pricing a été construit),
@PHASES/patch-02-admin-ops.md (logging ai_runs réutilisable)
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Env + dépendances

Pas de nouvelle dépendance. Tout est natif.

Pas de nouvelle variable d'env.

→ vérifier : pnpm install propre

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Schéma : statut + métadonnées pricing

### packages/db/src/schema/competitors.ts (ou la table où le pricing est stocké)

Selon ce qui existe en Phase 5. Si le pricing vit dans un champ JSON sur competitor
ou dans pricingSnapshots, étendre avec ces champs :

```typescript
pricingStatus: text("pricing_status"),       // "public" | "public_partial" | "gated_demo" | "gated_signup" | "dynamic" | "unknown"
pricingObservedRegion: text("pricing_observed_region"),  // ex: "FR" (la région d'où on scrape)
pricingPromotional: boolean("pricing_promotional").notNull().default(false),
pricingDemoUrl: text("pricing_demo_url"),    // URL du formulaire/Calendly si gated_demo
pricingNote: text("pricing_note"),           // note libre ("Enterprise sur demande", etc.)
pricingManualOverride: boolean("pricing_manual_override").notNull().default(false),
```

Si la structure existe différemment (ex: champ JSON), adapter pour intégrer ces
métadonnées au même niveau que les tiers.

### ClickHouse pricing_history (Phase 5)

Étendre pricing_history pour tracker l'évolution du statut au fil du temps :
```sql
ALTER TABLE pricing_history
  ADD COLUMN status String DEFAULT 'unknown',
  ADD COLUMN promotional UInt8 DEFAULT 0,
  ADD COLUMN observed_region String DEFAULT 'FR';
```

(Adapter selon la structure exacte créée en Phase 5.)

pnpm db:push --filter @outrival/db
pnpm ch:setup

→ vérifier : champs ajoutés dans Drizzle Studio et ClickHouse

Commit : `feat(db): add pricing status taxonomy fields`

---

## Étape 2 — Recherche multi-URL de la page pricing

### packages/scrapers/src/scrapers/pricing/discover-url.ts

Fonction qui cherche la "vraie" page de pricing avec une cascade.

```typescript
export interface PricingPageCandidate {
  url: string;
  source: "direct" | "homepage_section" | "nav" | "footer";
}

const DIRECT_PATHS = [
  "/pricing", "/tarifs", "/plans", "/price", "/prix",
  "/pricing/", "/tarifs/", "/plans/",
];

export async function discoverPricingUrl(
  baseUrl: string,
  homepageHtml: string,
): Promise {
  const base = new URL(baseUrl);

  // 1. Essayer les URLs directes par convention
  for (const path of DIRECT_PATHS) {
    const candidate = new URL(path, base).toString();
    if (await isReachable(candidate)) {
      return { url: candidate, source: "direct" };
    }
  }

  // 2. Chercher un lien "pricing" / "tarifs" dans le HTML de la homepage
  // Parser le HTML (cheerio ou regex selon ce qui est utilisé ailleurs)
  // Chercher  contenant "pricing"|"tarifs"|"plans"|"prix"
  const navMatch = findNavPricingLink(homepageHtml, base);
  if (navMatch) {
    return { url: navMatch, source: "nav" };
  }

  // 3. Chercher dans le footer
  const footerMatch = findFooterPricingLink(homepageHtml, base);
  if (footerMatch) {
    return { url: footerMatch, source: "footer" };
  }

  // 4. Détecter une section pricing sur la homepage elle-même
  if (hasHomepagePricingSection(homepageHtml)) {
    return { url: baseUrl, source: "homepage_section" };
  }

  return null;
}

function isReachable(url: string): Promise {
  // HEAD request, considérer 2xx comme reachable
}
```

Hooks utilitaires (findNavPricingLink, findFooterPricingLink, hasHomepagePricingSection)
à implémenter avec cheerio. Les patterns à matcher :
- Texte de lien : /pricing|tarifs|plans|prix/i
- Section : éléments avec id/class contenant "pricing", "plans", "tarifs"

→ vérifier : sur un échantillon de 10 sites variés, l'URL trouvée est correcte

Commit : `feat(scrapers): multi-strategy pricing URL discovery`

---

## Étape 3 — Détection des signaux dans le HTML

### packages/scrapers/src/scrapers/pricing/signals.ts

Trois détecteurs purs, sortie booléenne + détails.

```typescript
export interface PricingSignals {
  hasPriceTokens: boolean;            // €/$/£/¥ + chiffres + période
  hasGatedKeywords: boolean;          // "Contact sales", "Book a demo", etc.
  hasCalculator: boolean;             // inputs/sliders interactifs
  hasSignupWall: boolean;             // "Sign up to see pricing"
  hasPromotionalText: boolean;        // "Black Friday", "Limited time", etc.
  priceMatches: string[];             // tous les "€29/mois" trouvés
  gatedMatches: string[];             // tous les "Contact sales" trouvés
  promoMatches: string[];             // tous les indicateurs promo
}

const CURRENCY_PATTERNS = [
  /[€$£¥]\s?\d+[\d.,]*(\s?\/\s?(mo|month|mois|yr|year|an))?/gi,
  /\d+[\d.,]*\s?[€$£¥](\s?\/\s?(mo|month|mois|yr|year|an))?/gi,
];

const GATED_KEYWORDS = [
  /\bcontact\s+(us|sales|nous)\b/i,
  /\bbook\s+(a\s+)?demo\b/i,
  /\brequest\s+(a\s+)?(quote|demo|pricing)\b/i,
  /\btalk\s+to\s+sales\b/i,
  /\bget\s+(a\s+)?quote\b/i,
  /\bcustom\s+pricing\b/i,
  /\bpricing\s+on\s+request\b/i,
  /\bdemander\s+une?\s+d[ée]mo\b/i,
  /\bnous\s+contacter\b/i,
  /\bsur\s+demande\b/i,
];

const CALCULATOR_INDICATORS = [
  /]*type=["']?(number|range)/i,
  /]*name=["']?(users|seats|events|requests|volume)/i,
  /how\s+many\s+(users|seats|events|requests)/i,
  /estimate\s+your\s+(cost|price|bill)/i,
  /pricing\s+calculator/i,
];

const PROMO_INDICATORS = [
  /\blimited\s+time\b/i,
  /\bblack\s+friday\b/i,
  /\bcyber\s+monday\b/i,
  /\bend\s+of\s+year\b/i,
  /\bearly\s+bird\b/i,
  /\blifetime\s+deal\b/i,
  /\b\d+%\s+off\b/i,
  /\bpromo\b/i,
  /\bsave\s+[€$£¥]\d+/i,
];

const SIGNUP_WALL = [
  /sign\s+up\s+(to|for|and)\s+(see|view|access|get)\s+(pricing|prices|plans)/i,
  /create\s+(an\s+)?account\s+to\s+(see|view|access)/i,
];

export function detectPricingSignals(html: string): PricingSignals {
  // Extraire le texte visible (cheerio.text() après removal des scripts/styles)
  const text = extractVisibleText(html);

  return {
    hasPriceTokens: CURRENCY_PATTERNS.some(p => p.test(text)),
    priceMatches: extractAllMatches(text, CURRENCY_PATTERNS),
    hasGatedKeywords: GATED_KEYWORDS.some(p => p.test(text)),
    gatedMatches: extractAllMatches(text, GATED_KEYWORDS),
    hasCalculator: CALCULATOR_INDICATORS.some(p => p.test(html)),  // sur HTML brut pour 
    hasSignupWall: SIGNUP_WALL.some(p => p.test(text)),
    hasPromotionalText: PROMO_INDICATORS.some(p => p.test(text)),
    promoMatches: extractAllMatches(text, PROMO_INDICATORS),
  };
}
```

→ vérifier : tests unitaires sur fixtures HTML représentatives
  (page Linear publique, page Crayon gated, page Segment avec calculator)

Commit : `feat(scrapers): pricing signal detectors`

---

## Étape 4 — Logique de détermination du statut

### packages/scrapers/src/scrapers/pricing/determine-status.ts

```typescript
export type PricingStatus =
  | "public"
  | "public_partial"
  | "gated_demo"
  | "gated_signup"
  | "dynamic"
  | "unknown";

export interface StatusDecision {
  status: PricingStatus;
  reasoning: string;       // pour debug et findings.md
}

export function determineStatus(signals: PricingSignals): StatusDecision {
  // 1. Signup wall = priorité (même si chiffres présents)
  if (signals.hasSignupWall && !signals.hasPriceTokens) {
    return { status: "gated_signup", reasoning: "Signup wall + no public prices" };
  }

  // 2. Calculator détecté
  if (signals.hasCalculator) {
    // Peut coexister avec "starting at €X" → tout de même dynamic
    return { status: "dynamic", reasoning: "Calculator inputs detected" };
  }

  // 3. Combinaison prix + gated
  if (signals.hasPriceTokens && signals.hasGatedKeywords) {
    return { status: "public_partial", reasoning: "Some tiers public, others gated (sales contact)" };
  }

  // 4. Prix uniquement
  if (signals.hasPriceTokens && !signals.hasGatedKeywords) {
    return { status: "public", reasoning: "Public pricing fully visible" };
  }

  // 5. Gated uniquement
  if (!signals.hasPriceTokens && signals.hasGatedKeywords) {
    return { status: "gated_demo", reasoning: "No prices, sales contact required" };
  }

  // 6. Rien détecté
  return { status: "unknown", reasoning: "No price tokens, no gated keywords, no calculator" };
}
```

→ vérifier : matrice de tests couvrant les 6 statuts

Commit : `feat(scrapers): pricing status determination logic`

---

## Étape 5 — Refonte du scraper pricing principal

### packages/scrapers/src/scrapers/pricing/index.ts

Le scraper retourne maintenant une structure riche.

```typescript
export interface PricingResult {
  status: PricingStatus;
  observedRegion: string;            // "FR" pour le moment (notre VPS)
  promotional: boolean;
  tiers: PricingTier[];              // ce qu'on a pu extraire (peut être partiel)
  demoUrl: string | null;
  note: string | null;
  rawHtmlRef: string;                // référence R2 pour le HTML brut (debug)
  signals: PricingSignals;            // pour audit
}

export async function scrapePricing(
  competitorUrl: string,
  homepageHtml: string,
): Promise {
  // 1. Trouver l'URL pricing
  const candidate = await discoverPricingUrl(competitorUrl, homepageHtml);

  if (!candidate) {
    return {
      status: "unknown",
      observedRegion: process.env.SCRAPER_REGION ?? "FR",
      promotional: false,
      tiers: [],
      demoUrl: null,
      note: "Aucune page pricing trouvée",
      rawHtmlRef: "",
      signals: emptySignals(),
    };
  }

  // 2. Scraper la page candidate (réutilise scrapePage du patch-07 avec preferProxy, etc.)
  const pageHtml = candidate.source === "homepage_section"
    ? homepageHtml
    : (await scrapePage(candidate.url)).html;

  // 3. Détecter les signaux
  const signals = detectPricingSignals(pageHtml);

  // 4. Déterminer le statut
  const decision = determineStatus(signals);

  // 5. Extraire les tiers (best-effort selon le statut)
  const tiers = decision.status === "public" || decision.status === "public_partial"
    ? extractTiers(pageHtml, signals)
    : decision.status === "dynamic"
      ? extractStartingPrice(pageHtml, signals)
      : [];

  // 6. Extraire l'URL de demo si gated_demo
  const demoUrl = decision.status === "gated_demo"
    ? extractDemoUrl(pageHtml)
    : null;

  // 7. Note humaine
  const note = buildNote(decision, signals);

  return {
    status: decision.status,
    observedRegion: process.env.SCRAPER_REGION ?? "FR",
    promotional: signals.hasPromotionalText,
    tiers,
    demoUrl,
    note,
    rawHtmlRef: "",  // rempli si l'appelant upload sur R2
    signals,
  };
}
```

Surgical : remplacer l'implémentation de scrapePricing existante, garder
la signature publique compatible quand possible. Si la structure de retour
change, mettre à jour les callers en conséquence (scrape-monitor).

→ vérifier : test du nouveau scraper sur 10 sites variés couvrant les 6 statuts
→ vérifier : les tiers sont correctement extraits sur les sites publics

Commit : `feat(scrapers): refactor pricing scraper around status taxonomy`

---

## Étape 6 — Intégration dans scrape-monitor + ne pas générer de signal sur promo

### apps/workers/src/jobs/scrape-monitor.job.ts

Quand le monitor est de type "pricing" :
- Appeler le nouveau scrapePricing
- Stocker pricingStatus + pricingObservedRegion + pricingPromotional + pricingDemoUrl + pricingNote
- Logger dans pricing_history (ClickHouse) avec le statut
- Comparer le statut au snapshot précédent → générer signal si transition (voir étape 7)

CRITIQUE : si pricingPromotional = true, **NE PAS générer de signal "le prix a changé"**.
Logger en debug et skip le pipeline de signal pour cette itération.

```typescript
if (pricingResult.promotional) {
  logger.debug({ competitorId }, "Promotional pricing detected, skipping signal generation");
  // stocker quand même le snapshot pour traçabilité, mais pas de signal
  return;
}
```

→ vérifier : un site avec "Black Friday" → snapshot stocké, AUCUN signal
→ vérifier : retour à un prix normal après promo → signal seulement si différence avec
  le pré-promo (pas avec le pendant-promo)

Commit : `feat(workers): integrate pricing taxonomy and skip promotional signals`

---

## Étape 7 — Signal "pricing repositionné" (transition de statut)

### packages/ai/src/tasks/generate-signal.ts (ou nouveau fichier dédié)

Détecter les transitions de statut significatives entre deux snapshots :

```typescript
export function detectPricingRepositioning(
  previous: PricingStatus,
  current: PricingStatus,
): { significant: boolean; type: string; severity: "high" | "medium" } | null {
  // Transition stratégique majeure
  if (previous === "public" && (current === "gated_demo" || current === "gated_signup")) {
    return {
      significant: true,
      type: "pricing_gated",
      severity: "high",
      // → "X a retiré ses prix publics : probable repositionnement enterprise"
    };
  }

  // Inverse : passage du gated au public (souvent SaaS qui se démocratise)
  if ((previous === "gated_demo" || previous === "gated_signup") && current === "public") {
    return {
      significant: true,
      type: "pricing_public",
      severity: "medium",
      // → "X a rendu ses prix publics : probable repositionnement self-serve"
    };
  }

  // Passage statique → dynamique (souvent introduction usage-based)
  if ((previous === "public" || previous === "public_partial") && current === "dynamic") {
    return {
      significant: true,
      type: "pricing_usage_based",
      severity: "medium",
      // → "X est passé sur un pricing usage-based"
    };
  }

  return null;
}
```

Dans le pipeline IA, si une transition est détectée → générer un signal avec
contexte explicite. Le prompt IA reçoit le previous/current status pour
formuler le "so what".

→ vérifier : forcer une transition public → gated_demo → signal généré avec
  type "pricing_gated" et severity "high"

Commit : `feat(ai): detect pricing status repositioning signals`

---

## Étape 8 — UI fiche concurrent : affichage par statut

### apps/web/src/components/outrival/competitor-pricing-card.tsx

Adapter l'affichage selon pricingStatus :

```typescript
function PricingCard({ competitor }: { competitor: Competitor }) {
  const { pricingStatus, tiers, pricingDemoUrl, pricingNote, pricingObservedRegion } = competitor;

  switch (pricingStatus) {
    case "public":
      return ;

    case "public_partial":
      return (
        <PartialPricingDisplay
          tiers={tiers}
          note={pricingNote /* "Enterprise sur demande" */}
          region={pricingObservedRegion}
        />
      );

    case "gated_demo":
      return (
        <GatedDemoCard
          demoUrl={pricingDemoUrl}
          note={pricingNote /* "Stratégie enterprise probable" */}
        />
      );

    case "gated_signup":
      return ;

    case "dynamic":
      return (
        <DynamicPricingCard
          tiers={tiers /* "Starting at €X/mo" */}
          note={pricingNote}
        />
      );

    case "unknown":
      return (
        <UnknownPricingCard
          onManualOverride={() => openManualOverrideModal(competitor.id)}
        />
      );
  }
}
```

Chaque variante = un sous-composant simple. Style Outrival (dark + amber + Geist Mono pour les chiffres).

### Override manuel pour status "unknown"

Modal avec formulaire : statut + tiers + URL démo + note. Sauvegarde avec
pricingManualOverride = true. Une fois override = true, ne plus écraser
automatiquement par les scrapes (l'utilisateur a la main).

Bouton "Re-tenter une détection automatique" pour annuler l'override si besoin.

→ vérifier : chaque statut s'affiche correctement
→ vérifier : override manuel sauvegardé et respecté par les scrapes suivants

Commit : `feat(web): adapt competitor pricing card to status taxonomy`

---

## Étape 9 — Vérification finale + mesures

```bash
pnpm build && pnpm typecheck && pnpm ch:setup
```

Test end-to-end sur 10 concurrents représentatifs des 6 statuts :

1. **Linear** (public)         → status `public`, tiers extraits
2. **Notion** (public_partial)  → status `public_partial`, Enterprise "Contact us"
3. **Crayon** (gated_demo)      → status `gated_demo`, demoUrl extrait
4. **Segment** (dynamic)        → status `dynamic`, starting price extrait
5. **Un site avec "Black Friday"** → promotional = true, AUCUN signal généré
6. **Un site Cloudflare-protected** → fallback proxy, scrape réussit
7. **Un site obscur** (unknown) → bouton "Renseigner manuellement" visible
8. **Override manuel sur unknown** → sauvegardé, respecté par scrape suivant
9. **Transition forcée public → gated_demo** → signal "pricing_gated" généré
10. **Détection région** → pricingObservedRegion = "FR" sur tous

Mettre à jour findings.md :
- Patterns observés par site
- Cas limites rencontrés (faux positifs gated, faux négatifs calculator)
- Ajustements nécessaires aux regex
- Taux de "unknown" observé (signal d'amélioration future)

task_plan.md : patch-11 → complete.
</task>

<constraints>
- Le scraper retourne TOUJOURS une PricingResult avec un statut (jamais null)
- "unknown" est un statut valide, pas une erreur
- pricingPromotional = true → AUCUN signal de changement de prix généré
- Région d'observation toujours notée (transparence utilisateur)
- pricingManualOverride = true → ne JAMAIS écraser automatiquement
- Les regex de gated/promo sont en FR ET EN (Outrival cible FR-first mais l'écosystème SaaS est EN)
- Surgical : refondre le scraper pricing sans casser scrape-monitor (signature compatible)
- Les transitions de statut significatives génèrent des signaux avec severity adaptée
- Ne PAS implémenter ici : multi-région, multi-produit, usage-based pricing complexe (en Later/Backlog)
- Tests sur fixtures réelles avant de considérer le patch validé
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@packages/scrapers/CLAUDE.md
@packages/scrapers/src/scrapers/pricing.ts (existant à refondre)
@.claude/skills/crawlee-patterns/SKILL.md
@.claude/skills/clickhouse/SKILL.md
@findings.md
@PHASES/05-enrichissement.md
@PHASES/patch-02-admin-ops.md (logging pour audit du scraper)
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Schéma étendu (pricingStatus + champs associés en Postgres et ClickHouse)
✓ Recherche multi-URL : 10 sites variés → URL pricing correctement trouvée
✓ Détection signaux : prix, gated keywords, calculator, signup wall, promo
✓ Détermination du statut : matrice complète testée (6 statuts)
✓ Linear → public, Notion → public_partial, Crayon → gated_demo, Segment → dynamic
✓ "Black Friday" détecté → promotional = true, AUCUN signal généré
✓ Transition public → gated_demo → signal "pricing_gated" severity high
✓ UI : chaque statut affiché correctement avec composant adapté
✓ Override manuel sur "unknown" : sauvegardé, respecté par scrapes suivants
✓ Région d'observation toujours visible côté UI
✓ findings.md mis à jour avec observations terrain
✓ task_plan.md patch-11 = complete
</verification>

<commit>
feat(db): add pricing status taxonomy fields
feat(scrapers): multi-strategy pricing URL discovery
feat(scrapers): pricing signal detectors
feat(scrapers): pricing status determination logic
feat(scrapers): refactor pricing scraper around status taxonomy
feat(workers): integrate pricing taxonomy and skip promotional signals
feat(ai): detect pricing status repositioning signals
feat(web): adapt competitor pricing card to status taxonomy
</commit>