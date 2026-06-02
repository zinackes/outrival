# Patch 16 — Homepage scraping v2 (diff structuré + scroll + synthèse)

<context>
Audit du pipeline homepage scraping actuel : trois faiblesses critiques qui
produisent du bruit et ratent des signaux importants.

1. DIFF LIGNE-À-LIGNE TROP BÊTE
   Le diff actuel traite le texte rendu comme du contenu brut. Conséquences :
   - Réorganisation de sections = diff massif alors que sémantiquement identique
   - Carousels/témoignages tournants = faux positifs en boucle
   - Changement de H1 (signal stratégique majeur) noyé dans le bruit
   - Pas de notion "où" le changement a eu lieu (hero ≠ footer)
   → Solution : parser le HTML en structure sémantique AVANT de diff. Diff
     section par section, champ par champ.

2. CONTENU SOUS LA FOLD RATÉ
   Beaucoup de homepages modernes utilisent lazy loading / scroll-triggered
   reveal / hydratation tardive. Le networkidle ne suffit pas → on rate
   30-50% du contenu sous la fold (témoignages, pricing teasers, FAQ).
   → Solution : scroll progressif après networkidle, attendre les lazy loads,
     puis capture.

3. PAS DE SYNTHÈSE NARRATIVE DES CHANGEMENTS
   Aujourd'hui après diff on fait juste une classification IA (catégorie +
   sévérité). On obtient "severity: medium, category: positioning_change"
   mais aucune explication contextuelle pour le user.
   → Solution : pour les changements jugés significatifs, ajouter un appel
     IA qui génère une synthèse narrative ("Linear a déplacé son tier Free
     vers 'Education', suggérant un repositionnement enterprise").
     Réservé aux changements significatifs pour maîtriser le coût.

Hors scope (reportés à patch-17) :
- Diff visuel perceptual hash sur les screenshots
- Tracking des claims chiffrés ("15,000 teams")
- Tracking des logos clients et témoignages
- Score de pertinence stratégique composite
- Garde anti-vide basée sur médiane historique
- Apprentissage automatique des patterns volatils

Hors scope (reporté à patch-18) :
- Détection du tech stack (scraper séparé, fréquence mensuelle)

Lire avant : @CLAUDE.md, @docs/architecture.md, @packages/scrapers/CLAUDE.md,
@packages/ai/CLAUDE.md, @PHASES/02-scraping-core.md (pipeline existant),
@PHASES/03-ai-intelligence.md (classifyChange), @PHASES/patch-01-scraping-cost.md
(direct-first, fréquence adaptative), @PHASES/patch-07-scraping-perf.md
(browser pool, conditional fetch), @PHASES/patch-09-ai-cost-optimization.md
(model tier, cache), @PHASES/patch-14-trust-and-clarity.md (humanChange
fields déjà extraits par classifyChange — on enrichit ici, on ne casse pas)
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances + env

```bash
# Parsing HTML structuré (déjà présent probablement via Crawlee, mais on en a besoin standalone)
pnpm add cheerio --filter @outrival/scrapers

# Pas d'autre nouvelle dépendance — node-html-parser pourrait être alternative
# plus rapide, mais cheerio est plus mature et déjà familier.
```

Env :
```
HOMEPAGE_SCROLL_PASSES=2              # nb de passes scroll progressif (descente + remontée)
HOMEPAGE_LAZY_WAIT_MS=2000             # délai d'attente après chaque scroll
HOMEPAGE_NARRATIVE_MIN_SEVERITY=medium # seuil min pour générer une synthèse narrative
                                       # (none|low|medium|high|critical)
```

→ vérifier : pnpm install propre

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Capture améliorée (scroll progressif)

### packages/scrapers/src/lib/render.ts (ou équivalent dans le code existant)

Remplacer la séquence de capture par une version qui révèle le contenu sous la fold :

```typescript
async function captureHomepage(page: Page): Promise {
  // 1. Network idle (comportement actuel)
  await page.waitForLoadState("networkidle", { timeout: 15000 });

  // 2. Scroll progressif pour déclencher les lazy loads
  await scrollThroughPage(page);

  // 3. Capture finale
  const html = await page.content();
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  const screenshotBuffer = await page.screenshot({ fullPage: true, type: "jpeg", quality: 80 });

  // (Le finalUrl, statusCode, etag, lastModified viennent déjà de la réponse principale)

  return { html, text, screenshotBuffer, ... };
}

async function scrollThroughPage(page: Page): Promise {
  const passes = Number(process.env.HOMEPAGE_SCROLL_PASSES ?? 2);
  const waitMs = Number(process.env.HOMEPAGE_LAZY_WAIT_MS ?? 2000);

  for (let pass = 0; pass < passes; pass++) {
    // Descente progressive
    await page.evaluate(async (delay) => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    }, waitMs);

    // Attendre que le lazy content se charge
    await page.waitForTimeout(waitMs);

    // Remontée (pour les sites avec animations bidirectionnelles)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
  }
}
```

JPEG quality 80 au lieu de PNG (réduit la taille R2 de 3-5×, suffisant pour
l'usage humain et le futur diff visuel).

→ vérifier : sur 3 sites SPA-heavy (Linear, Vercel, Notion), le text capturé
  contient maintenant les sections testimonials/FAQ/footer

Commit : `feat(scrapers): progressive scroll capture for lazy-loaded content`

---

## Étape 2 — Parser le HTML en structure sémantique

### packages/scrapers/src/parsers/homepage-structure.ts

Nouveau module qui transforme le HTML rendu en structure typée.

```typescript
import * as cheerio from "cheerio";

export interface HomepageStructure {
  // Métadonnées globales
  title: string;
  metaDescription: string | null;
  canonical: string | null;
  openGraph: {
    title: string | null;
    description: string | null;
    image: string | null;
    type: string | null;
  };

  // Hero (le H1 et son contexte immédiat)
  hero: {
    headline: string | null;       // le H1
    subheadline: string | null;     // texte sous le H1 (premier p ou h2 proche)
    primaryCta: { text: string; href: string } | null;
    secondaryCta: { text: string; href: string } | null;
  };

  // Sections de la page (par H2/H3)
  sections: Array<{
    heading: string;
    level: 2 | 3;
    bodyText: string;               // texte agrégé de la section (sans nav/footer)
    type: SectionType;              // "features" | "pricing" | "testimonials" | "logos" | "faq" | "cta" | "other"
    ctas: Array;
  }>;

  // Navigation et footer (importants à part)
  navigation: {
    items: Array;
  };
  footer: {
    links: Array;
    text: string;                   // texte du footer (legal, copyright, etc.)
  };

  // Signaux additionnels
  socialProof: {
    customerLogos: Array;
    testimonialCount: number;       // juste le count, le tracking détaillé est en patch-17
  };
}

export type SectionType =
  | "features" | "pricing" | "testimonials" | "logos"
  | "faq" | "cta" | "integrations" | "other";

export function parseHomepageStructure(html: string, baseUrl: string): HomepageStructure {
  const $ = cheerio.load(html);

  // 1. Nettoyer le DOM (retirer scripts, styles, SVG, iframes, nav cachée, cookie banners)
  $("script, style, svg, iframe, noscript").remove();
  $("[aria-hidden='true']").remove();
  $('[class*="cookie"], [id*="cookie"]').remove(); // best-effort sur les banners

  // 2. Extraire les métadonnées
  const title = $("title").first().text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? null;
  const canonical = $('link[rel="canonical"]').attr("href") ?? null;
  const openGraph = {
    title: $('meta[property="og:title"]').attr("content") ?? null,
    description: $('meta[property="og:description"]').attr("content") ?? null,
    image: $('meta[property="og:image"]').attr("content") ?? null,
    type: $('meta[property="og:type"]').attr("content") ?? null,
  };

  // 3. Extraire le hero (H1 + contexte)
  const h1 = $("h1").first();
  const hero = {
    headline: h1.text().trim() || null,
    subheadline: extractSubheadline($, h1),
    primaryCta: extractPrimaryCta($, h1, baseUrl),
    secondaryCta: extractSecondaryCta($, h1, baseUrl),
  };

  // 4. Découper en sections par H2
  const sections = extractSections($, baseUrl);

  // 5. Navigation et footer
  const navigation = extractNavigation($, baseUrl);
  const footer = extractFooter($, baseUrl);

  // 6. Social proof
  const socialProof = extractSocialProof($);

  return {
    title, metaDescription, canonical, openGraph,
    hero, sections, navigation, footer, socialProof,
  };
}

// Helpers (à implémenter en gardant pragmatique) :
// - extractSubheadline : prend le premier  ou  qui suit le H1 dans son
//   parent ou son parent immédiat
// - extractPrimaryCta : cherche le premier  ou  "primaire" proche du
//   H1 (heuristiques : classes contenant "primary"/"btn-primary"/"cta", ou
//   premier bouton style after H1)
// - extractSections : pour chaque H2, agrège tout le texte entre ce H2 et le
//   prochain H2 (ou la fin). Classifie le type par heuristique :
//     "pricing" si contient €/$/£ + mots clés (mo|month|yr|year)
//     "testimonials" si contient  ou classes "testimonial"/"quote"
//     "logos" si contient principalement des  sans texte
//     "faq" si contient des  ou patterns Q/R répétés
//     "features" par défaut si liste de paragraphes courts avec icônes
//     "other" sinon
// - extractNavigation :  ou , liste des liens
// - extractFooter : , texte + liens
// - extractSocialProof : carousel de logos détecté par patterns de classes
//   contenant "logo"/"customer"/"trusted-by" ; count de 
```

→ vérifier : sur 5 sites variés (Linear, Vercel, Notion, Stripe, Crayon),
  la structure extraite est cohérente
→ vérifier : tests unitaires sur fixtures HTML

Commit : `feat(scrapers): parse homepage into semantic structure`

---

## Étape 3 — Stockage du snapshot structuré

### packages/db/src/schema/snapshots.ts

Étendre la table snapshots existante avec un champ JSON pour la structure :

```typescript
homepageStructure: jsonb("homepage_structure"),  // nullable, présent uniquement pour les snapshots de type "homepage"
```

Pas de migration de données existantes : les anciens snapshots n'auront pas
ce champ. Les nouveaux scrapes vont le remplir. Fallback gracieux côté diff
(étape 4) si le snapshot précédent n'a pas la structure.

pnpm db:push --filter @outrival/db

→ vérifier : colonne ajoutée

Commit : `feat(db): add homepage_structure jsonb to snapshots`

---

## Étape 4 — Diff structuré

### packages/scrapers/src/diff/homepage-diff.ts

Nouveau module qui diff deux HomepageStructure et produit une liste de
changements typés.

```typescript
export type ChangeKind =
  | "hero_headline_changed"
  | "hero_subheadline_changed"
  | "hero_cta_changed"
  | "section_added"
  | "section_removed"
  | "section_renamed"
  | "section_body_changed"
  | "section_reordered"
  | "navigation_changed"
  | "meta_changed"
  | "social_proof_changed";

export interface StructuredChange {
  kind: ChangeKind;
  field: string;                  // ex: "hero.headline", "sections[features]"
  before: string | null;
  after: string | null;
  bodyDiff?: { added: string[]; removed: string[] }; // pour section_body_changed
}

export function diffHomepages(
  prev: HomepageStructure,
  curr: HomepageStructure,
): StructuredChange[] {
  const changes: StructuredChange[] = [];

  // 1. Hero (le plus stratégique)
  if (prev.hero.headline !== curr.hero.headline) {
    changes.push({
      kind: "hero_headline_changed",
      field: "hero.headline",
      before: prev.hero.headline,
      after: curr.hero.headline,
    });
  }
  // ... idem pour subheadline, primaryCta, secondaryCta

  // 2. Sections — appairage par type + heading similarity
  const sectionDiffs = diffSections(prev.sections, curr.sections);
  changes.push(...sectionDiffs);

  // 3. Navigation
  const navBefore = prev.navigation.items.map(i => i.text).sort();
  const navAfter = curr.navigation.items.map(i => i.text).sort();
  if (JSON.stringify(navBefore) !== JSON.stringify(navAfter)) {
    changes.push({
      kind: "navigation_changed",
      field: "navigation",
      before: navBefore.join(", "),
      after: navAfter.join(", "),
    });
  }

  // 4. Métadonnées (title, description, OG)
  // ... diff champ par champ

  // 5. Social proof (count de logos, count de testimonials — pas le détail ici)
  if (prev.socialProof.customerLogos.length !== curr.socialProof.customerLogos.length) {
    changes.push({
      kind: "social_proof_changed",
      field: "socialProof.customerLogos.count",
      before: String(prev.socialProof.customerLogos.length),
      after: String(curr.socialProof.customerLogos.length),
    });
  }

  return changes;
}

function diffSections(
  prev: HomepageStructure["sections"],
  curr: HomepageStructure["sections"],
): StructuredChange[] {
  // Appairer les sections par similarity (heading + type)
  // - Section dans prev, pas dans curr → "section_removed"
  // - Section dans curr, pas dans prev → "section_added"
  // - Sections appairées : si heading change → "section_renamed"
  //                       si body diff > 10% → "section_body_changed"
  //                       avec bodyDiff: { added: [...], removed: [...] } (diff ligne-à-ligne LOCAL à la section)
  // - Si l'ordre relatif a changé → "section_reordered"
}
```

→ vérifier : un changement de H1 produit "hero_headline_changed"
→ vérifier : ajout d'une section "Pricing" produit "section_added" avec field="sections[pricing]"
→ vérifier : un carousel de témoignages qui tourne NE produit PAS de changement
  (parce que socialProof.testimonialCount est juste un count, pas le contenu)
→ vérifier : réorganisation pure sans modification produit "section_reordered" uniquement

Commit : `feat(scrapers): structural diff between two homepage snapshots`

---

## Étape 5 — Intégration dans scrape-monitor

### apps/workers/src/jobs/scrape-monitor.job.ts

Au moment du traitement d'un scrape homepage :

```typescript
// Après la capture (étape 1) :
const structure = parseHomepageStructure(html, finalUrl);

// Stocker dans le snapshot
await db.insert(snapshots).values({
  // ... champs existants
  homepageStructure: structure,
});

// Si on a un snapshot précédent AVEC structure :
const prevSnapshot = await getLastSnapshot(monitorId);

if (prevSnapshot?.homepageStructure) {
  // Diff structuré
  const structuredChanges = diffHomepages(prevSnapshot.homepageStructure, structure);

  if (structuredChanges.length === 0) {
    // Aucun changement sémantique → ne rien faire (même si le HTML brut a "bougé")
    logger.debug({ monitorId }, "No structural change detected");
    return;
  }

  // Sinon, on continue avec le pipeline IA (classification + synthèse)
  await processStructuredChanges(monitor, structuredChanges);
} else {
  // Fallback : pas de structure précédente (premier scrape OU snapshot pre-patch-16)
  // → utiliser le diff lexical existant pour cette itération uniquement
  // → la prochaine itération aura les deux structures et utilisera le diff structuré
  await processLexicalDiff(monitor, prevSnapshot, html, text);
}
```

Le pipeline IA en aval (étape 6) reçoit maintenant `structuredChanges` au lieu
d'un blob de lignes. Beaucoup plus précis.

→ vérifier : premier scrape post-patch → structure stockée, pas de diff (pas de prev avec structure)
→ vérifier : second scrape post-patch → diff structuré activé
→ vérifier : ancien snapshot lexical + nouveau snapshot structuré → fallback lexical une fois
→ vérifier : pas de régression sur les monitors non-homepage (pricing, jobs, etc.)

Commit : `feat(workers): integrate structured diff in scrape-monitor pipeline`

---

## Étape 6 — Adapter classifyChange aux changements structurés

### packages/ai/src/tasks/classify-change.ts

Aujourd'hui classifyChange reçoit un diff lexical brut. On l'adapte pour
recevoir une liste de StructuredChange et raisonner mieux.

```typescript
export async function classifyStructuredChanges(
  changes: StructuredChange[],
  context: { competitorName: string; sourceUrl: string },
): Promise;
    humanChangeBefore: string;     // pour patch-14 compatibility
    humanChangeAfter: string;
  } | null;
  cached: boolean;
}> {
  // Prompt enrichi qui reçoit la structure typée :
  // "Voici une liste de changements structurés sur la homepage de {competitorName}.
  //  Pour chacun, dis si c'est trivial/minor/major. Puis donne une sévérité
  //  globale et une catégorie. Puis formule le changement principal en
  //  langage naturel (humanChangeBefore/After pour patch-14).
  //
  //  Règles :
  //  - hero_headline_changed est TOUJOURS au moins 'major'
  //  - section_added avec type='pricing' est TOUJOURS au moins 'major'
  //  - navigation_changed seul est 'minor'
  //  - meta_changed seul est 'minor'
  //  - social_proof_changed (count) seul est 'minor'
  //  ..."
  //
  // Modèle : "smart" (llama-3.3-70b) pour bien gérer la structure
  // Cache : oui (déterministe sur l'input)
}
```

La signature retourne maintenant un `perChangeAssessment` qui permet à l'UI
de surfacer les changements individuels (utile pour le panneau
"Pourquoi cet insight ?" du patch-14).

→ vérifier : un changement H1 + nav mineure → severity "high", H1 marqué major,
  nav marquée minor
→ vérifier : humanChangeBefore/After cohérents avec le changement principal
→ vérifier : cache fonctionne sur input identique (patch-09 compatibility)

Commit : `feat(ai): classify structured changes with per-change assessment`

---

## Étape 7 — Synthèse narrative pour les changements significatifs

### packages/ai/src/tasks/narrate-change.ts

Nouveau task IA : pour les changements jugés significatifs (>= seuil
configurable), générer une explication contextuelle.

```typescript
const NARRATIVE_THRESHOLD = process.env.HOMEPAGE_NARRATIVE_MIN_SEVERITY ?? "medium";

export async function narrateChange(input: {
  changes: StructuredChange[];
  classification: ClassificationResult;
  competitor: { name: string; category: string };
}): Promise {
  // Skip si severity < seuil (économie tokens)
  if (severityRank(input.classification.overallSeverity) < severityRank(NARRATIVE_THRESHOLD)) {
    return null;
  }

  // Prompt : "Tu es un analyste stratégique. Voici ce qui a changé sur la
  //          homepage de {competitor.name} (catégorie : {competitor.category}) :
  //          {liste des changements major}.
  //          Explique en 2-3 phrases ce que ce changement suggère
  //          stratégiquement. Ton sobre, factuel. Pas de superlatifs.
  //          Pas de spéculation gratuite. Si tu n'as pas assez d'info pour
  //          dire quelque chose d'utile, dis 'Changement noté, signification
  //          à confirmer.'"
  //
  // Modèle : "smart"
  // PAS de cache (sortie créative et contextuelle)
}

function severityRank(s: string): number {
  return { none: 0, low: 1, medium: 2, high: 3, critical: 4 }[s] ?? 0;
}
```

### Stockage de la narrative

Étendre la table signals existante (patch-14 a déjà humanChangeBefore/After) :
```typescript
narrative: text("narrative"),  // nullable
```

→ vérifier : un changement "medium" déclenche la narration
→ vérifier : un changement "low" ne déclenche PAS la narration (économie)
→ vérifier : ai_run loggé pour chaque appel narrate_change (patch-02)

Commit : `feat(ai): generate strategic narrative for significant changes`

---

## Étape 8 — UI : afficher la narrative

### Le composant signal-card existant (patch-14)

Étendre pour afficher la narrative quand elle est présente, sous le titre
du signal et avant la ligne source. Si pas de narrative (signal pré-patch
ou changement insignifiant), comportement actuel inchangé.

```
┌─ Signal ─────────────────────────────────────────────┐
│  [SEVERITY] Linear · Changement de positionnement    │
│                                                        │
│  ► Linear a remplacé "Project management for teams"   │ ← narrative (nouveau)
│    par "AI-powered project intelligence" et déplacé   │
│    le tier Free vers une offre 'Education', suggérant │
│    un repositionnement enterprise.                    │
│                                                        │
│  Source : homepage · Détecté le 12 mai                │
│  · Pourquoi cet insight ?                              │
└────────────────────────────────────────────────────────┘
```

La narrative est visuellement distincte (icône ► ou citation, italique léger,
amber subtil). Elle ne remplace pas le titre — elle ajoute du contexte.

Dans le panneau "Pourquoi cet insight ?" du patch-14, ajouter aussi la liste
des changements individuels (perChangeAssessment) avec leur significance :

```
CHANGEMENTS DÉTECTÉS

  major   Hero headline
          "Project management for teams" →
          "AI-powered project intelligence"

  major   Nouvelle section : Pricing
          Avant : absente
          Après : tier Free / Pro €19 / Business €49

  minor   Navigation
          Ajout : "Enterprise"
```

→ vérifier : narrative présente s'affiche bien
→ vérifier : narrative absente → fallback gracieux (juste le titre, comme avant)
→ vérifier : panneau "Pourquoi" liste les changements individuels avec significance

Commit : `feat(web): display narrative and per-change breakdown on signals`

---

## Étape 9 — Vérification finale + mesures

```bash
pnpm build && pnpm typecheck
```

Test end-to-end :

### A. Capture sous la fold
1. Scraper Vercel, Linear, Notion (sites SPA-heavy)
2. Vérifier dans le HTML capturé que les sections testimonials/FAQ/footer sont présentes
3. Comparer la taille du text avant/après patch (doit augmenter ~30-50%)

### B. Diff structuré ignore les faux positifs
1. Préparer une fixture HTML A et B où SEUL un carousel de témoignages tourne
2. parseHomepageStructure + diffHomepages → 0 changement structurel
3. (avant patch : ce cas générait du bruit dans le diff lexical)

### C. Diff structuré attrape les vrais signaux
1. Préparer fixture A et B où le H1 change
2. diffHomepages → 1 changement "hero_headline_changed", significance major
3. classifyStructuredChanges → severity "high" minimum
4. narrateChange → narrative générée

### D. Cohabitation avec ancien pipeline
1. Monitor avec un snapshot lexical pré-patch
2. Nouveau scrape post-patch
3. Premier diff = fallback lexical, structure stockée
4. Scrape suivant = diff structuré activé
5. Aucune erreur, aucune régression

### E. Cost et perf
1. Mesurer le temps moyen par scrape avant/après patch
2. Attendu : +3-5s (scroll progressif)
3. Mesurer le ratio narratives générées / signals générés
4. Attendu : ~30-50% (seuil "medium")
5. Vérifier coût Groq via ai_runs

Mettre à jour findings.md :
- Cas observés où le diff structuré rate quelque chose (ajuster patterns)
- Faux positifs persistants (alimenter le filtre)
- Qualité des narratives (sont-elles vraiment utiles ?)
- Coût en tokens et impact sur le budget IA

task_plan.md : patch-16 → complete.
</task>

<constraints>
- DIFF STRUCTURÉ remplace le diff lexical UNIQUEMENT pour les monitors homepage
  (les autres sources : pricing, blog, jobs, reviews — gardent leur diff existant)
- Fallback gracieux : si pas de structure dans le snapshot précédent (pre-patch),
  utiliser le diff lexical pour CETTE itération seulement. Pas de migration de
  données existantes.
- Le parser doit être PUR (cheerio + logique synchrone) — pas d'appel réseau,
  pas de side-effects, testable unitairement
- La narration n'est générée QUE pour les severity >= seuil (par défaut "medium")
  → contrôle du coût IA
- Le classifyStructuredChanges utilise le cache patch-09 (déterministe)
- La narrative n'utilise PAS le cache (sortie créative)
- Compatibilité patch-14 : humanChangeBefore/After toujours générés
- JPEG quality 80 pour les screenshots (réduction R2 patch-07 compatible)
- Sections classifiées heuristiquement : "features", "pricing", "testimonials",
  "logos", "faq", "cta", "integrations", "other"
- Le scroll progressif ne tourne que pour les monitors homepage (pas pour
  pricing, blog, etc. qui sont déjà bien capturés en networkidle)
- Surgical : étendre le pipeline existant sans réécrire la logique de
  scheduling, fréquence adaptative (patch-01), conditional fetch (patch-07),
  ou logging (patch-02)
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@packages/scrapers/CLAUDE.md
@packages/ai/CLAUDE.md
@apps/workers/CLAUDE.md
@PHASES/02-scraping-core.md
@PHASES/03-ai-intelligence.md
@PHASES/patch-01-scraping-cost.md
@PHASES/patch-07-scraping-perf.md
@PHASES/patch-09-ai-cost-optimization.md
@PHASES/patch-14-trust-and-clarity.md
@.claude/skills/crawlee-patterns/SKILL.md
@.claude/skills/ai-pipeline/SKILL.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Scroll progressif activé sur homepage : contenu sous la fold capturé
✓ parseHomepageStructure extrait hero, sections, navigation, footer, socialProof
✓ Tests unitaires du parser sur 5 fixtures variées
✓ Snapshot stocké avec homepageStructure JSON
✓ Fallback gracieux quand pas de structure précédente
✓ diffHomepages produit StructuredChange[] correctement typé
✓ Carousel de témoignages qui tourne → 0 changement structurel (fix faux positif)
✓ Changement de H1 → "hero_headline_changed" + severity major minimum
✓ classifyStructuredChanges retourne overallSeverity + perChangeAssessment
✓ narrateChange ne s'exécute que sur changes >= seuil severity
✓ UI affiche la narrative quand présente, sinon comportement actuel
✓ Panneau "Pourquoi cet insight ?" liste les changements individuels
✓ Pas de régression sur les monitors non-homepage
✓ ai_runs (patch-02) loggue les nouveaux types : classify_structured, narrate_change
✓ task_plan.md patch-16 = complete
</verification>

<commit>
feat(scrapers): progressive scroll capture for lazy-loaded content
feat(scrapers): parse homepage into semantic structure
feat(db): add homepage_structure jsonb to snapshots
feat(scrapers): structural diff between two homepage snapshots
feat(workers): integrate structured diff in scrape-monitor pipeline
feat(ai): classify structured changes with per-change assessment
feat(ai): generate strategic narrative for significant changes
feat(web): display narrative and per-change breakdown on signals
</commit>