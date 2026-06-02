# Patch 17 — Homepage enrichments (visuel, claims, social proof, score, garde-fous)

<context>
Suite directe de patch-16 (diff structuré + scroll + narrative). Six
améliorations qui rendent le scraping homepage encore plus précis et plus
résilient, mais qui ne sont PAS critiques pour la beta — d'où le report
initial en Later. Faisable post-beta ou maintenant si on veut couvrir tous
les cas.

Les six améliorations :

1. DIFF VISUEL via perceptual hash sur les screenshots
   → détecte les redesigns que le diff texte rate
   → léger (pHash en ~50ms, pas de ML)

2. TRACKING DES CLAIMS CHIFFRÉS ("15,000 teams", "99.9% uptime")
   → détecte les évolutions business revendiquées
   → extraction par regex + matching dans le temps

3. TRACKING DES LOGOS CLIENTS ET TÉMOIGNAGES (apparitions/disparitions)
   → détecte les nouveaux gros clients annoncés / churns médiatiques
   → matching par alt text et nom des auteurs

4. SCORE DE PERTINENCE STRATÉGIQUE composite
   → poids(section) × ampleur × récence
   → permet de surfacer/silence intelligemment

5. GARDE ANTI-VIDE basée sur MÉDIANE HISTORIQUE
   → évite de masquer des vraies réductions de contenu
   → compare aux 5 derniers snapshots, pas juste au dernier

6. APPRENTISSAGE AUTO des patterns volatils par site
   → remplace les regex hardcodées
   → s'adapte à chaque concurrent dans le temps

Pas dans ce patch : tech stack (patch-18 séparé).

Lire avant : @CLAUDE.md, @docs/architecture.md, @packages/scrapers/CLAUDE.md,
@packages/ai/CLAUDE.md, @PHASES/02-scraping-core.md,
@PHASES/patch-01-scraping-cost.md, @PHASES/patch-07-scraping-perf.md,
@PHASES/patch-09-ai-cost-optimization.md, @PHASES/patch-14-trust-and-clarity.md,
@PHASES/patch-16-homepage-scraping-v2.md (prérequis)
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances + env

```bash
# Image hashing léger (perceptual hash)
pnpm add sharp --filter @outrival/scrapers
# sharp est probablement déjà installé pour les screenshots — vérifier d'abord
```

Env :
```
ENRICHMENTS_PHASH_THRESHOLD=15            # distance Hamming au-dessus = redesign détecté
ENRICHMENTS_VOLATILE_THRESHOLD=5          # nombre de scrapes consécutifs où une ligne diffère = volatile
ENRICHMENTS_VOLATILE_RESET=10             # nombre de scrapes stables pour redevenir analysable
ENRICHMENTS_ANTIVOID_THRESHOLD=0.3        # ratio par rapport à la médiane des 5 derniers
ENRICHMENTS_RELEVANCE_MIN_SCORE=0.5       # score minimum pour qu'un changement génère un signal
```

→ vérifier : pnpm install propre

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Perceptual hash sur les screenshots

### packages/scrapers/src/lib/phash.ts

Hash perceptuel d'une image (dHash 64-bit). Détecte les changements visuels
même si le texte est identique.

```typescript
import sharp from "sharp";

/**
 * Calcule un dHash (difference hash) 64-bit d'une image.
 * Deux images visuellement similaires auront un hash avec peu de bits différents.
 */
export async function computePerceptualHash(buffer: Buffer): Promise {
  // 1. Resize en 9x8 grayscale
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 2. Comparer chaque pixel à son voisin de droite → bit
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x];
      const right = data[y * 9 + x + 1];
      if (left < right) {
        hash |= 1n << BigInt(y * 8 + x);
      }
    }
  }
  return hash;
}

/**
 * Distance de Hamming entre deux hashes (nombre de bits différents).
 * 0 = identique, 64 = complètement différent.
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}
```

### Stockage du hash sur le snapshot

#### packages/db/src/schema/snapshots.ts

```typescript
screenshotPhash: text("screenshot_phash"),  // hex string du bigint
```

(text plutôt que bigint pour portabilité Postgres ↔ JS — convertir au passage)

pnpm db:push --filter @outrival/db

### Intégration dans scrape-monitor

À la capture du screenshot, calculer et stocker le pHash :

```typescript
const screenshotBuffer = await page.screenshot({ fullPage: true, type: "jpeg", quality: 80 });
const phash = await computePerceptualHash(screenshotBuffer);

await db.insert(snapshots).values({
  // ... champs existants
  screenshotPhash: phash.toString(16),  // hex
});
```

### Détection de redesign visuel

Au moment du diff (après le diff structuré de patch-16) :

```typescript
const prevPhash = BigInt("0x" + prevSnapshot.screenshotPhash);
const currPhash = BigInt("0x" + currentSnapshot.screenshotPhash);
const distance = hammingDistance(prevPhash, currPhash);

const threshold = Number(process.env.ENRICHMENTS_PHASH_THRESHOLD ?? 15);

if (distance > threshold && structuredChanges.length < 3) {
  // Beaucoup de changement visuel, peu de changement structurel
  // → probable redesign sans copy change
  structuredChanges.push({
    kind: "visual_redesign",
    field: "screenshot",
    before: `phash: ${prevSnapshot.screenshotPhash}`,
    after: `phash: ${currentSnapshot.screenshotPhash}`,
    metadata: { hammingDistance: distance },
  });
}
```

→ vérifier : 2 screenshots quasi identiques → distance 0-5, pas de signal
→ vérifier : changement de palette de couleurs → distance ~20-30, signal redesign
→ vérifier : redesign complet → distance > 40, signal redesign + structuré

Commit : `feat(scrapers): perceptual hash for visual redesign detection`

---

## Étape 2 — Extraction des claims chiffrés

### packages/scrapers/src/parsers/numeric-claims.ts

```typescript
export interface NumericClaim {
  rawText: string;            // "15,000+ teams using us"
  value: number;              // 15000
  unit: string | null;        // "teams", "%", null
  context: string;            // "using us"
  pattern: ClaimPattern;
}

export type ClaimPattern =
  | "user_count"      // "X users", "X teams", "X customers"
  | "uptime"          // "X% uptime", "X% reliability"
  | "scale"           // "X million tasks", "X billion events"
  | "satisfaction"    // "X% satisfaction", "rated X stars"
  | "savings"         // "save X%", "X hours saved"
  | "other_metric";

const PATTERNS: Array<{ regex: RegExp; pattern: ClaimPattern; parser: (m: RegExpMatchArray) => Partial }> = [
  {
    regex: /([\d,]+)\s*(?:k|K|\+)?\s*(teams|users|customers|companies|developers|businesses)\b/g,
    pattern: "user_count",
    parser: (m) => ({ value: parseCount(m[1]), unit: m[2] }),
  },
  {
    regex: /(\d{2,3}(?:\.\d+)?)\s*%\s*(uptime|reliability|availability)/gi,
    pattern: "uptime",
    parser: (m) => ({ value: parseFloat(m[1]), unit: "%", context: m[2] }),
  },
  {
    regex: /([\d,.]+)\s*(million|billion|M|B)\s*(tasks|events|requests|messages|transactions)/gi,
    pattern: "scale",
    parser: (m) => ({ value: parseScale(m[1], m[2]), unit: m[3] }),
  },
  {
    regex: /(\d{2,3})\s*%\s*(satisfaction|happy|rated)/gi,
    pattern: "satisfaction",
    parser: (m) => ({ value: parseFloat(m[1]), unit: "%", context: m[2] }),
  },
  {
    regex: /save\s*(\d+)\s*%/gi,
    pattern: "savings",
    parser: (m) => ({ value: parseFloat(m[1]), unit: "%", context: "savings" }),
  },
];

export function extractNumericClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  for (const { regex, pattern, parser } of PATTERNS) {
    for (const match of text.matchAll(regex)) {
      const partial = parser(match);
      if (partial.value !== undefined && !isNaN(partial.value)) {
        claims.push({
          rawText: match[0],
          value: partial.value,
          unit: partial.unit ?? null,
          context: partial.context ?? match[0],
          pattern,
        });
      }
    }
  }
  // Dédoublonner par (pattern + unit + context)
  return dedupe(claims);
}

function parseCount(raw: string): number {
  return parseInt(raw.replace(/,/g, ""), 10);
}

function parseScale(raw: string, unit: string): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  return unit.toLowerCase().startsWith("b") ? n * 1e9 : n * 1e6;
}
```

### Stockage et historique

#### packages/db/src/schema/numeric-claims.ts

Table ClickHouse dédiée pour le tracking historique (append-only, parfait
pour les time-series) :

```sql
CREATE TABLE IF NOT EXISTS numeric_claims (
  competitor_id String,
  monitor_id String,
  pattern String,           -- user_count, uptime, scale, ...
  unit String,
  context String,
  value Float64,
  raw_text String,
  observed_at DateTime DEFAULT now()
) ENGINE = MergeTree() ORDER BY (competitor_id, pattern, observed_at)
```

Ajouter à ensureClickhouseTables(). pnpm ch:setup.

### Intégration

Dans scrape-monitor, après le parsing de la structure (patch-16) :

```typescript
import { extractNumericClaims } from "@outrival/scrapers/parsers";

// Extraire les claims du texte de la homepage
const claims = extractNumericClaims(structure.hero.headline + "\n" +
                                     structure.hero.subheadline + "\n" +
                                     structure.sections.map(s => s.bodyText).join("\n"));

// Stocker chaque claim observé
for (const claim of claims) {
  await ch.insert({
    table: "numeric_claims",
    values: [{
      competitor_id: monitor.competitorId,
      monitor_id: monitor.id,
      pattern: claim.pattern,
      unit: claim.unit ?? "",
      context: claim.context,
      value: claim.value,
      raw_text: claim.rawText,
    }],
    format: "JSONEachRow",
  });
}
```

### Détection de variation significative

Au diff, comparer les claims actuels aux derniers de chaque pattern :

```sql
-- Pour chaque (pattern, unit, context), récupérer la dernière valeur
SELECT pattern, unit, context, argMax(value, observed_at) as last_value
FROM numeric_claims
WHERE competitor_id = {competitorId}
GROUP BY pattern, unit, context
```

Comparer avec les claims du scrape actuel. Si une variation > 20% sur un
claim user_count ou scale → ajouter à structuredChanges :

```typescript
structuredChanges.push({
  kind: "numeric_claim_changed",
  field: `claim.${pattern}.${context}`,
  before: `${prevValue} ${unit}`,
  after: `${currValue} ${unit}`,
  metadata: { variation: (currValue - prevValue) / prevValue },
});
```

→ vérifier : "10,000 teams" → "50,000 teams" génère un signal numeric_claim_changed
→ vérifier : variation < 20% → pas de signal (bruit normal)
→ vérifier : un nouveau claim qui n'existait pas avant → signal "claim_appeared"

Commit : `feat(scrapers): extract and track numeric claims over time`

---

## Étape 3 — Tracking des logos clients et témoignages

### packages/scrapers/src/parsers/social-proof.ts

Enrichir l'extraction existante (patch-16 stocke juste le count) pour
extraire la liste détaillée.

```typescript
export interface CustomerLogo {
  alt: string;           // "Acme Corp"
  src: string;           // URL absolue
  normalized: string;    // "acme corp" (lowercase, trim, espaces réduits)
}

export interface Testimonial {
  quote: string;          // texte du témoignage
  author: string | null;  // nom de l'auteur si trouvé
  authorTitle: string | null;
  company: string | null;
  normalized: string;     // hash du quote pour matching
}

export function extractCustomerLogos($: cheerio.CheerioAPI): CustomerLogo[] {
  // Heuristiques :
  // - Sections avec class/id contenant "logo", "customer", "trusted-by", "clients"
  // - Images avec alt text non-vide
  // - Pas de favicons (filtrer par taille via src ou parent context)

  const logos: CustomerLogo[] = [];
  const sections = $('[class*="logo"], [class*="customer"], [class*="trusted"], [class*="client"]');

  sections.find("img[alt]").each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    const src = $(el).attr("src");
    if (alt && src && alt.length > 1 && alt.length < 50) {
      logos.push({
        alt,
        src: resolveUrl(src, baseUrl),
        normalized: alt.toLowerCase().trim().replace(/\s+/g, " "),
      });
    }
  });

  return dedupeByNormalized(logos);
}

export function extractTestimonials($: cheerio.CheerioAPI): Testimonial[] {
  // Heuristiques :
  // - 
  // - Classes "testimonial", "quote", "review"
  // - Pattern texte court (50-500 chars) + nom dans cite/figcaption/author

  const testimonials: Testimonial[] = [];

  $('blockquote, [class*="testimonial"], [class*="quote"]').each((_, el) => {
    const quote = $(el).find("p").first().text().trim() || $(el).text().trim();
    if (quote.length < 30 || quote.length > 1000) return;

    const author = $(el).find("cite, [class*='author'], [class*='name']").first().text().trim() || null;
    // ... extraire title et company de manière similaire

    testimonials.push({
      quote,
      author,
      authorTitle: null,  // optional
      company: null,
      normalized: hashQuote(quote),
    });
  });

  return testimonials;
}

function hashQuote(quote: string): string {
  // Hash stable de la quote (premiers 100 chars normalisés)
  return crypto.createHash("sha1")
    .update(quote.toLowerCase().replace(/\s+/g, " ").slice(0, 100))
    .digest("hex")
    .slice(0, 16);
}
```

### Mise à jour de HomepageStructure (patch-16)

Étendre le type pour stocker la liste détaillée :

```typescript
socialProof: {
  customerLogos: CustomerLogo[];      // au lieu de juste un array d'alt/src basique
  testimonials: Testimonial[];         // au lieu de juste un count
  stats: string[];                     // les claims chiffrés en clair (joins avec numeric_claims)
};
```

### Diff enrichi des logos et témoignages

Dans diffHomepages, ajouter le matching par `normalized` :

```typescript
// Logos
const prevLogos = new Set(prev.socialProof.customerLogos.map(l => l.normalized));
const currLogos = new Set(curr.socialProof.customerLogos.map(l => l.normalized));

const newLogos = [...currLogos].filter(l => !prevLogos.has(l));
const removedLogos = [...prevLogos].filter(l => !currLogos.has(l));

if (newLogos.length > 0) {
  changes.push({
    kind: "customer_logo_added",
    field: "socialProof.customerLogos",
    before: null,
    after: newLogos.join(", "),
  });
}
if (removedLogos.length > 0) {
  changes.push({
    kind: "customer_logo_removed",
    field: "socialProof.customerLogos",
    before: removedLogos.join(", "),
    after: null,
  });
}

// Idem pour testimonials (matching par normalized hash)
```

Important : les témoignages qui **tournent dans un carousel** auront un
hash différent à chaque scrape. Pour éviter les faux positifs, ne signaler
un témoignage "disparu" que s'il était absent depuis ≥ 3 scrapes consécutifs
(stocker l'historique d'apparition).

Compromis pragmatique : sur les logos, fiable et utile. Sur les témoignages,
peut générer du bruit — à monitorer en beta et désactiver si trop bruyant.

→ vérifier : ajout d'un logo Salesforce → signal "customer_logo_added"
→ vérifier : carousel de testimonials qui tourne → pas de signaux (matching par hash)
→ vérifier : disparition durable d'un logo (3+ scrapes) → signal "customer_logo_removed"

Commit : `feat(scrapers): track customer logos and testimonials over time`

---

## Étape 4 — Score de pertinence stratégique

### packages/scrapers/src/scoring/relevance.ts

Score composite qui aide à décider quels changements méritent vraiment un
signal vs lesquels rester en silence.

```typescript
export interface RelevanceScore {
  score: number;          // 0-1
  components: {
    sectionWeight: number;
    magnitude: number;
    recency: number;
  };
}

const SECTION_WEIGHTS: Record = {
  "hero.headline": 1.0,
  "hero.subheadline": 0.9,
  "hero.primaryCta": 0.85,
  "hero.secondaryCta": 0.7,
  "sections[pricing]": 0.95,
  "sections[features]": 0.75,
  "sections[testimonials]": 0.4,
  "sections[logos]": 0.5,
  "sections[faq]": 0.3,
  "sections[other]": 0.5,
  "navigation": 0.7,
  "footer": 0.2,
  "meta.title": 0.8,
  "meta.description": 0.6,
  "openGraph": 0.4,
  "socialProof.customerLogos": 0.6,
  "socialProof.testimonials": 0.4,
  "visual_redesign": 0.7,
  "numeric_claim_changed": 0.65,
};

export function scoreRelevance(
  change: StructuredChange,
  context: { previousChangesInLast7Days: number },
): RelevanceScore {
  const sectionWeight = SECTION_WEIGHTS[change.field] ?? 0.5;

  // Magnitude : ratio de caractères changés pour les changements de texte
  const magnitude = computeMagnitude(change);

  // Recency : un concurrent qui change peu → un changement vaut plus
  // Un concurrent qui change tous les jours → chaque changement vaut moins
  const recency = 1 / (1 + context.previousChangesInLast7Days * 0.2);

  const score = sectionWeight * magnitude * recency;

  return { score: Math.min(1, score), components: { sectionWeight, magnitude, recency } };
}

function computeMagnitude(change: StructuredChange): number {
  if (change.kind === "visual_redesign") return 1.0;
  if (change.kind === "section_added" || change.kind === "section_removed") return 1.0;
  if (change.kind === "numeric_claim_changed") {
    const variation = change.metadata?.variation ?? 0;
    return Math.min(1, Math.abs(variation) * 2);  // 50% de variation = magnitude max
  }
  // Default : ratio de caractères modifiés / total
  const beforeLen = (change.before ?? "").length;
  const afterLen = (change.after ?? "").length;
  const total = Math.max(beforeLen, afterLen, 1);
  return Math.min(1, Math.abs(afterLen - beforeLen) / total + 0.3);
}
```

### Intégration dans scrape-monitor

Après le diff structuré, scorer chaque changement et filtrer :

```typescript
const minScore = Number(process.env.ENRICHMENTS_RELEVANCE_MIN_SCORE ?? 0.5);

// Compter les changements récents pour calculer la recency
const previousChangesInLast7Days = await countRecentChanges(monitor.competitorId, 7);

const scoredChanges = structuredChanges.map(change => ({
  change,
  relevance: scoreRelevance(change, { previousChangesInLast7Days }),
}));

const significantChanges = scoredChanges.filter(s => s.relevance.score >= minScore);
const ignoredChanges = scoredChanges.filter(s => s.relevance.score < minScore);

if (significantChanges.length === 0) {
  logger.debug({ monitorId, ignoredCount: ignoredChanges.length },
    "All changes below relevance threshold");
  // Stocker les changes ignorés en debug mais ne pas générer de signal
  return;
}

// Continuer le pipeline IA seulement sur significantChanges
```

→ vérifier : un changement de H1 → score > 0.7 → passe
→ vérifier : un changement de footer → score < 0.3 → filtré
→ vérifier : concurrent qui change tous les jours → recency baisse → moins de signaux

Commit : `feat(scoring): relevance score to filter low-impact changes`

---

## Étape 5 — Garde anti-vide basée sur médiane historique

### packages/scrapers/src/lib/anti-void.ts

Remplacer la garde actuelle (comparaison au dernier snapshot) par une
comparaison à la médiane des 5 derniers.

```typescript
export interface AntiVoidDecision {
  isVoid: boolean;
  reason?: string;
  shouldRetry: boolean;
}

export async function checkAntiVoid(
  monitorId: string,
  currentContentSize: number,
  db: Database,
): Promise {
  // Récupérer la taille des 5 derniers snapshots réussis
  const recent = await db.query.snapshots.findMany({
    where: and(eq(snapshots.monitorId, monitorId), eq(snapshots.status, "success")),
    orderBy: desc(snapshots.scrapedAt),
    limit: 5,
    columns: { contentSize: true },  // ajouter ce champ au schéma si pas présent
  });

  if (recent.length < 2) {
    // Pas assez d'historique → utiliser l'ancienne logique (comparaison au dernier)
    const last = recent[0]?.contentSize ?? 0;
    if (last > 1000 && currentContentSize < 200) {
      return { isVoid: true, reason: "much_smaller_than_last", shouldRetry: true };
    }
    return { isVoid: false, shouldRetry: false };
  }

  const sizes = recent.map(s => s.contentSize);
  const median = computeMedian(sizes);

  const threshold = Number(process.env.ENRICHMENTS_ANTIVOID_THRESHOLD ?? 0.3);
  const ratio = currentContentSize / median;

  // Cas 1 : contenu actuel < 30% de la médiane → probable soft-block
  if (ratio < threshold) {
    // Sauf si le dernier scrape avait déjà cette taille (changement durable)
    const last = sizes[0];
    const lastRatio = last / median;
    if (lastRatio < threshold * 1.5) {
      // Le dernier était déjà petit → c'est devenu la nouvelle normale, pas un block
      return { isVoid: false, reason: "stable_smaller_content", shouldRetry: false };
    }
    return { isVoid: true, reason: "below_historical_median", shouldRetry: true };
  }

  return { isVoid: false, shouldRetry: false };
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
```

### Schéma : stocker la taille du contenu

#### packages/db/src/schema/snapshots.ts

```typescript
contentSize: integer("content_size"),  // taille en chars du texte visible
```

### Intégration

Remplacer la garde existante dans scrape-monitor :

```typescript
const decision = await checkAntiVoid(monitorId, currentTextSize, db);

if (decision.isVoid) {
  logger.warn({ monitorId, reason: decision.reason }, "Anti-void triggered");
  if (decision.shouldRetry) {
    // Replanifier dans 30min, ne pas créer de "page supprimée"
    await retryLater(monitorId, 30 * 60 * 1000);
    return;
  }
}

// Sinon, continuer le pipeline
```

→ vérifier : page normale (1000+ chars), prochaine 200 chars → void détecté, retry
→ vérifier : 5 derniers à 1000 chars, nouveau à 800 → pas void (changement normal)
→ vérifier : 5 derniers à 200 chars, nouveau à 180 → pas void (c'est la nouvelle norme)
→ vérifier : pas assez d'historique → fallback sur l'ancienne logique

Commit : `feat(scrapers): anti-void guard based on historical median`

---

## Étape 6 — Apprentissage automatique des patterns volatils

### packages/db/src/schema/volatile-lines.ts

Table dédiée pour mémoriser par site quelles structures de lignes changent
sans signification.

```typescript
export const volatileLines = pgTable("volatile_lines", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),       // signature normalisée de la ligne
  changeCount: integer("change_count").notNull().default(0),
  stableCount: integer("stable_count").notNull().default(0),
  isVolatile: boolean("is_volatile").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
});

// Index unique sur (monitorId, pattern)
```

pnpm db:push.

### packages/scrapers/src/learning/volatile-detector.ts

```typescript
/**
 * Normalise une ligne pour produire une "signature" stable.
 * On remplace les valeurs variables par des placeholders pour matcher
 * "Used by 10,234 teams" et "Used by 10,567 teams" sur le même pattern.
 */
export function normalizeLine(line: string): string {
  return line
    .replace(/\d+([,.]\d+)*/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/\b[A-Fa-f0-9]{16,}\b/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .toLowerCase();
}

export async function updateVolatileTracking(
  monitorId: string,
  previousLines: string[],
  currentLines: string[],
): Promise {
  // Lignes qui ont changé entre prev et curr → incrémenter changeCount
  const changeThreshold = Number(process.env.ENRICHMENTS_VOLATILE_THRESHOLD ?? 5);
  const resetThreshold = Number(process.env.ENRICHMENTS_VOLATILE_RESET ?? 10);

  // Pour chaque ligne dans prev mais pas dans curr (avec normalize)
  const prevNormalized = new Map();
  for (const line of previousLines) prevNormalized.set(normalizeLine(line), line);

  const currNormalized = new Map();
  for (const line of currentLines) currNormalized.set(normalizeLine(line), line);

  // Lignes qui ont la même signature normalisée mais texte différent → volatile candidate
  const volatileCandidates: string[] = [];
  for (const [pattern, prevLine] of prevNormalized) {
    if (currNormalized.has(pattern) && currNormalized.get(pattern) !== prevLine) {
      volatileCandidates.push(pattern);
    }
  }

  // Incrémenter change_count pour chaque candidate
  for (const pattern of volatileCandidates) {
    const existing = await db.query.volatileLines.findFirst({
      where: and(eq(volatileLines.monitorId, monitorId), eq(volatileLines.pattern, pattern)),
    });

    if (existing) {
      const newCount = existing.changeCount + 1;
      await db.update(volatileLines).set({
        changeCount: newCount,
        stableCount: 0,
        isVolatile: newCount >= changeThreshold,
        lastSeenAt: new Date(),
      }).where(eq(volatileLines.id, existing.id));
    } else {
      await db.insert(volatileLines).values({
        monitorId, pattern, changeCount: 1, isVolatile: false,
      });
    }
  }

  // Lignes stables (présentes des deux côtés et identiques) → incrémenter stableCount
  // Si stableCount > resetThreshold → isVolatile = false
  for (const [pattern, prevLine] of prevNormalized) {
    if (currNormalized.has(pattern) && currNormalized.get(pattern) === prevLine) {
      const existing = await db.query.volatileLines.findFirst({
        where: and(eq(volatileLines.monitorId, monitorId), eq(volatileLines.pattern, pattern)),
      });
      if (existing && existing.isVolatile) {
        const newStable = existing.stableCount + 1;
        await db.update(volatileLines).set({
          stableCount: newStable,
          isVolatile: newStable < resetThreshold,
        }).where(eq(volatileLines.id, existing.id));
      }
    }
  }
}

/**
 * Filtre les lignes connues comme volatiles avant de générer des changements.
 */
export async function filterVolatileLines(
  monitorId: string,
  lines: string[],
): Promise {
  const volatilePatterns = await db.query.volatileLines.findMany({
    where: and(eq(volatileLines.monitorId, monitorId), eq(volatileLines.isVolatile, true)),
    columns: { pattern: true },
  });

  const volatileSet = new Set(volatilePatterns.map(v => v.pattern));
  return lines.filter(line => !volatileSet.has(normalizeLine(line)));
}
```

### Intégration

Dans scrape-monitor, après le diff structuré et avant la classification IA :

```typescript
// 1. Mettre à jour le tracking volatile à partir du diff complet
await updateVolatileTracking(monitor.id, previousLines, currentLines);

// 2. Filtrer les lignes volatiles dans le bodyDiff des sections
for (const change of structuredChanges) {
  if (change.bodyDiff) {
    change.bodyDiff.added = await filterVolatileLines(monitor.id, change.bodyDiff.added);
    change.bodyDiff.removed = await filterVolatileLines(monitor.id, change.bodyDiff.removed);
  }
}

// 3. Si après filtrage le change est vide, le retirer
const filteredChanges = structuredChanges.filter(c =>
  c.kind !== "section_body_changed" || (c.bodyDiff?.added.length || 0) + (c.bodyDiff?.removed.length || 0) > 0
);
```

→ vérifier : une ligne "Used by 10,234 teams" → "Used by 10,567 teams" pendant
  5 scrapes consécutifs → marquée volatile, plus de signal dessus
→ vérifier : si elle redevient stable pendant 10 scrapes → redevient analysable
→ vérifier : nouveau monitor → pas de patterns volatiles, comportement normal

Commit : `feat(scrapers): auto-learn volatile line patterns per monitor`

---

## Étape 7 — UI : afficher les enrichissements

### Mise à jour du panneau "Pourquoi cet insight ?" (patch-14)

Ajouter des sections selon les enrichissements détectés :

```
┌─ Pourquoi cet insight ? ──────────────────────────────┐
│                                                         │
│  CHANGEMENTS DÉTECTÉS                                   │
│    major   Hero headline                                │
│            "Project management" → "AI-powered ..."     │
│                                                         │
│  CLAIMS BUSINESS                                        │
│    📈  Teams using us                                   │
│           15,000 → 50,000 (+233%)                       │
│                                                         │
│  PREUVE SOCIALE                                         │
│    ✓ Nouveau logo client : Salesforce                  │
│    ✗ Logo retiré : HubSpot                              │
│                                                         │
│  ── Source ──                                           │
│  Page d'accueil de Linear · linear.app                 │
│  [↗ Voir la page actuelle]                             │
│                                                         │
│  ── Détection ──                                        │
│  Détecté le 12 mai 2026 à 14:32                        │
│  Score de pertinence : 0.84                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Composants modulaires : afficher uniquement les sections présentes. Si pas
de claims chiffrés détectés, pas de section "Claims business".

Le score de pertinence reste discret (en bas, petite police). Sert plus à
calibrer les seuils en beta qu'à exposer fortement à l'utilisateur.

→ vérifier : signal avec claims → section affichée
→ vérifier : signal sans claims → section absente
→ vérifier : signal de redesign visuel → mention "Redesign visuel détecté"

Commit : `feat(web): display enrichments in why-insight panel`

---

## Étape 8 — Vérification finale + mesures

```bash
pnpm build && pnpm typecheck
```

Test end-to-end :

### A. Perceptual hash
1. Capturer 2 screenshots quasi-identiques → distance < 10, pas de signal
2. Modifier la palette de couleurs d'une fixture → distance > 15, signal "visual_redesign"
3. Vérifier : pHash stocké en hex sur snapshots

### B. Claims chiffrés
1. Fixture avec "10,000 teams" puis "50,000 teams" → signal "numeric_claim_changed"
2. Variation +400% → magnitude max, severity élevée
3. Vérifier : numeric_claims rempli en ClickHouse

### C. Logos et témoignages
1. Fixture avec logo Salesforce ajouté → signal "customer_logo_added"
2. Carousel de testimonials qui tourne (hash différent à chaque scrape) → 0 signal
3. Vérifier : matching par normalized fonctionne

### D. Score de pertinence
1. Changement de H1 (poids 1.0) + magnitude 0.5 + recency 1.0 → score 0.5 → passe
2. Changement de footer (poids 0.2) + magnitude 0.3 → score 0.06 → filtré
3. Vérifier : ignoredChanges loggés en debug mais pas de signal

### E. Anti-vide médiane
1. 5 snapshots à 1000 chars, nouveau à 200 → void détecté, retry
2. 5 snapshots à 200 chars, nouveau à 180 → pas void
3. Pas assez d'historique → fallback ancienne logique

### F. Volatile auto-apprentissage
1. Une ligne change à chaque scrape pendant 5 scrapes → marquée volatile
2. Ne génère plus de bruit dans les diffs suivants
3. Devient stable 10 scrapes → redevient analysable

### G. UI enrichi
1. Signal avec claims → section "Claims business" visible
2. Signal sans enrichissements → comportement patch-14 inchangé
3. Score de pertinence visible discrètement

Mettre à jour findings.md :
- Distance pHash typique entre 2 scrapes normaux (pour calibrer le seuil)
- Patterns de claims les plus fréquents (ajuster les regex)
- Taux de logos correctement extraits vs ratés
- Taux de filtrage du relevance score (objectif 20-40% des signals filtrés)
- Patterns volatiles détectés (sanity check)

task_plan.md : patch-17 → complete.
</task>

<constraints>
- TOUS les enrichissements sont OPTIONNELS et ADDITIFS — un signal sans
  claims/logos/etc. doit fonctionner comme avant patch-17
- Le relevance score peut SILENCER un signal (filtrage), donc seuil
  conservateur au début (0.5) — ajustable selon observations beta
- Le pHash ne déclenche un signal "visual_redesign" QUE si peu de changements
  structurels détectés (sinon redondant avec patch-16)
- Les claims chiffrés ne génèrent un signal que si variation > 20% (bruit normal)
- Les témoignages qui tournent ne doivent JAMAIS générer de signal
  (matching par hash normalisé du quote)
- Anti-vide médiane : fallback gracieux si < 2 snapshots d'historique
- Volatile auto-learning : fallback gracieux si pas de patterns appris
- Sharp est probablement déjà installé (vérifier avant ajout)
- Compatibilité patch-14 : humanChange et narrative continuent d'être générés
- Compatibilité patch-16 : structure homepage continue d'être stockée
- Surgical : étendre le pipeline sans réécrire la logique de scheduling
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@packages/scrapers/CLAUDE.md
@packages/ai/CLAUDE.md
@apps/workers/CLAUDE.md
@apps/web/CLAUDE.md
@PHASES/patch-09-ai-cost-optimization.md
@PHASES/patch-14-trust-and-clarity.md
@PHASES/patch-16-homepage-scraping-v2.md
@.claude/skills/clickhouse/SKILL.md
@.claude/skills/crawlee-patterns/SKILL.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ pHash calculé sur chaque snapshot, distance < 5 pour quasi-identique
✓ Redesign visuel sans changement copy → signal "visual_redesign"
✓ Claims chiffrés extraits et stockés en ClickHouse
✓ Variation > 20% sur claim → signal "numeric_claim_changed"
✓ Logos ajoutés/retirés → signaux corrects
✓ Testimonials en carousel → 0 signal (hash normalisé)
✓ Score de pertinence calculé et filtre les changements < 0.5
✓ Anti-vide basé sur médiane des 5 derniers
✓ Volatile patterns auto-appris (5 changes consécutifs → volatile)
✓ UI enrichie affiche claims/logos/redesign quand présents
✓ Aucune régression sur les pipelines patch-14, patch-16
✓ task_plan.md patch-17 = complete
</verification>

<commit>
feat(scrapers): perceptual hash for visual redesign detection
feat(scrapers): extract and track numeric claims over time
feat(scrapers): track customer logos and testimonials over time
feat(scoring): relevance score to filter low-impact changes
feat(scrapers): anti-void guard based on historical median
feat(scrapers): auto-learn volatile line patterns per monitor
feat(web): display enrichments in why-insight panel
</commit>