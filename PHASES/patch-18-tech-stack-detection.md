# Patch 18 — Détection du tech stack des concurrents

<context>
Scraper SÉPARÉ dédié au tech stack des concurrents. Volontairement isolé des
autres scrapers parce que le profil de changement est complètement différent :

  Homepage           → change mensuellement, scrape hebdo
  Pricing            → change trimestriellement, scrape hebdo
  Tech stack         → change rarement (semestriel), scrape MENSUEL

Coupler le tech stack au scrape homepage générerait 12 scrapes inutiles pour
1 changement détecté. Donc fréquence dédiée, monitor type dédié, sources
optimales.

Sources de détection du tech stack (par ordre de fiabilité) :

1. Headers HTTP (Server, X-Powered-By, headers de sécurité)
2. Scripts chargés (<script src>) → analytics, integrations, frameworks
3. Footer (badges "Powered by", "Built with X")
4. Page /integrations si elle existe
5. DNS records (Cloudflare, Fastly, AWS CloudFront)
6. robots.txt et sitemap.xml → outils SEO révélés
7. Wappalyzer-style detection sur les patterns DOM

Sortie : liste typée de tech détectées + signal généré quand une nouvelle
intégration majeure apparaît (ex: Linear ajoute Salesforce dans son footer
= info commerciale stratégique).

Lire avant : @CLAUDE.md, @docs/architecture.md, @packages/scrapers/CLAUDE.md,
@PHASES/05-enrichissement.md (pattern de scraper indépendant),
@PHASES/patch-01-scraping-cost.md, @PHASES/patch-16-homepage-scraping-v2.md
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances + env

```bash
# Pas de nouvelle dépendance — utiliser undici (patch-07) pour les fetchs HTTP
# et cheerio (patch-16) pour le parsing
```

Env :
```
TECH_STACK_SCRAPE_INTERVAL_DAYS=30        # fréquence mensuelle
TECH_STACK_SIGNAL_MIN_IMPORTANCE=medium   # seuil min pour générer un signal
```

→ vérifier : env lue

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Catalogue des tech à détecter

### packages/scrapers/src/tech-stack/catalog.ts

Catalogue typé des technologies que l'on cherche, avec leurs patterns de
détection. Pas exhaustif au départ, on l'enrichira par observation.

```typescript
export type TechCategory =
  | "frontend"        // Next.js, React, Vue
  | "hosting"          // Vercel, Netlify, Cloudflare
  | "cdn"              // Cloudflare CDN, Fastly, AWS CloudFront
  | "analytics"        // PostHog, Mixpanel, GA, Segment
  | "auth"             // Auth0, Clerk, Better Auth
  | "payments"         // Stripe, Lemon Squeezy, Paddle
  | "crm_integration"  // Salesforce, HubSpot (présence dans le footer)
  | "communication"    // Intercom, Crisp, Drift
  | "support"          // Zendesk, Helpscout
  | "email"            // Resend, Postmark, SendGrid
  | "monitoring"       // Sentry, Datadog
  | "marketing"        // Mailchimp, ConvertKit
  | "framework_signal"; // Shadcn, Tailwind, Headless UI

export type ImportanceLevel = "high" | "medium" | "low";

export interface TechSignature {
  id: string;                    // "stripe", "salesforce", "vercel"
  name: string;                   // "Stripe", "Salesforce"
  category: TechCategory;
  importance: ImportanceLevel;
  detectors: {
    scriptUrls?: RegExp[];       // patterns d'URL de script
    headers?: Array;
    domPatterns?: RegExp[];      // ID/class CSS distinctifs
    footerKeywords?: string[];   // mots-clés à chercher dans le footer
    dnsHints?: string[];         // hints au niveau DNS (CNAME pattern)
  };
}

export const TECH_CATALOG: TechSignature[] = [
  {
    id: "stripe",
    name: "Stripe",
    category: "payments",
    importance: "high",
    detectors: {
      scriptUrls: [/js\.stripe\.com/, /checkout\.stripe\.com/],
      footerKeywords: ["powered by stripe", "stripe"],
    },
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "crm_integration",
    importance: "high",
    detectors: {
      scriptUrls: [/salesforce\.com/, /force\.com/],
      footerKeywords: ["salesforce integration", "integrates with salesforce"],
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "hosting",
    importance: "medium",
    detectors: {
      headers: [
        { name: "server", value: /vercel/i },
        { name: "x-vercel-cache", value: /./ },
        { name: "x-vercel-id", value: /./ },
      ],
    },
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    category: "cdn",
    importance: "low",
    detectors: {
      headers: [
        { name: "server", value: /cloudflare/i },
        { name: "cf-ray", value: /./ },
      ],
    },
  },
  {
    id: "posthog",
    name: "PostHog",
    category: "analytics",
    importance: "medium",
    detectors: {
      scriptUrls: [/posthog\.com/, /\/posthog\.js/],
    },
  },
  {
    id: "segment",
    name: "Segment",
    category: "analytics",
    importance: "medium",
    detectors: {
      scriptUrls: [/cdn\.segment\.com/, /segment\.io/],
    },
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "communication",
    importance: "medium",
    detectors: {
      scriptUrls: [/widget\.intercom\.io/, /intercomcdn/],
      domPatterns: [/intercom-/],
    },
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm_integration",
    importance: "high",
    detectors: {
      scriptUrls: [/js\.hs-scripts\.com/, /hsforms\.net/],
      footerKeywords: ["hubspot"],
    },
  },
  {
    id: "next.js",
    name: "Next.js",
    category: "frontend",
    importance: "low",
    detectors: {
      headers: [{ name: "x-powered-by", value: /next\.js/i }],
      domPatterns: [/__next/, /_next\//],
    },
  },
  // ... à enrichir par observation
];
```

→ vérifier : catalogue importable et typé

Commit : `feat(scrapers): tech stack catalog with detection patterns`

---

## Étape 2 — Détecteur

### packages/scrapers/src/tech-stack/detector.ts

```typescript
import { TECH_CATALOG, type TechSignature } from "./catalog";

export interface DetectedTech {
  techId: string;
  name: string;
  category: TechCategory;
  importance: ImportanceLevel;
  evidence: string[];          // d'où provient la détection
}

export interface TechStackInput {
  url: string;
  html: string;
  responseHeaders: Record;
  scriptUrls: string[];        //  extraits de la page
}

export function detectTechStack(input: TechStackInput): DetectedTech[] {
  const detected: DetectedTech[] = [];

  for (const tech of TECH_CATALOG) {
    const evidence: string[] = [];

    // 1. Scripts
    if (tech.detectors.scriptUrls) {
      for (const scriptUrl of input.scriptUrls) {
        for (const pattern of tech.detectors.scriptUrls) {
          if (pattern.test(scriptUrl)) {
            evidence.push(`script:${scriptUrl}`);
            break;
          }
        }
      }
    }

    // 2. Headers
    if (tech.detectors.headers) {
      for (const { name, value } of tech.detectors.headers) {
        const headerValue = input.responseHeaders[name.toLowerCase()];
        if (headerValue && value.test(headerValue)) {
          evidence.push(`header:${name}=${headerValue}`);
        }
      }
    }

    // 3. DOM patterns
    if (tech.detectors.domPatterns) {
      for (const pattern of tech.detectors.domPatterns) {
        if (pattern.test(input.html)) {
          evidence.push(`dom:${pattern.source}`);
        }
      }
    }

    // 4. Footer keywords
    if (tech.detectors.footerKeywords) {
      const $ = cheerio.load(input.html);
      const footerText = $("footer").text().toLowerCase();
      for (const kw of tech.detectors.footerKeywords) {
        if (footerText.includes(kw.toLowerCase())) {
          evidence.push(`footer:${kw}`);
        }
      }
    }

    if (evidence.length > 0) {
      detected.push({
        techId: tech.id,
        name: tech.name,
        category: tech.category,
        importance: tech.importance,
        evidence,
      });
    }
  }

  return detected;
}
```

→ vérifier : tests unitaires sur fixtures réelles (Linear, Vercel, Stripe homepages)
→ vérifier : Stripe détecté via script + footer
→ vérifier : Vercel détecté via headers

Commit : `feat(scrapers): tech stack detector from headers/scripts/dom/footer`

---

## Étape 3 — Schéma : tech_stack table

### packages/db/src/schema/tech-stack.ts

Postgres pour la liste actuelle par concurrent (état présent).

```typescript
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const techStackEntries = pgTable("tech_stack_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  techId: text("tech_id").notNull(),
  techName: text("tech_name").notNull(),
  category: text("category").notNull(),
  importance: text("importance").notNull(),
  evidence: jsonb("evidence").notNull(),
  firstDetectedAt: timestamp("first_detected_at").notNull().defaultNow(),
  lastDetectedAt: timestamp("last_detected_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
});

// Index unique sur (competitorId, techId)
```

ClickHouse pour l'historique d'apparitions/disparitions (time-series).

```sql
CREATE TABLE IF NOT EXISTS tech_stack_history (
  competitor_id String,
  tech_id String,
  event String,                -- "appeared" | "disappeared" | "confirmed"
  importance String,
  recorded_at DateTime DEFAULT now()
) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
```

pnpm db:push + pnpm ch:setup.

Commit : `feat(db): add tech stack tables (postgres + clickhouse)`

---

## Étape 4 — Job mensuel de scrape tech stack

### apps/workers/src/jobs/scrape-tech-stack.job.ts

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { db, ch } from "@outrival/db";
import { detectTechStack } from "@outrival/scrapers/tech-stack";
import { scrapePage } from "@outrival/scrapers";

export const scrapeTechStackJob = task({
  id: "scrape-tech-stack",
  run: async (payload: { competitorId: string }) => {
    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, payload.competitorId),
    });
    if (!competitor) return;

    // 1. Scraper la homepage avec capture des headers et scripts
    const result = await scrapePage(competitor.url, {
      captureScriptUrls: true,
      captureHeaders: true,
    });

    // 2. Détecter le tech stack
    const detected = detectTechStack({
      url: competitor.url,
      html: result.html,
      responseHeaders: result.headers,
      scriptUrls: result.scriptUrls,
    });

    // 3. Optionnel : scraper /integrations si la page existe
    const integrationsUrl = new URL("/integrations", competitor.url).toString();
    try {
      const integrationsPage = await scrapePage(integrationsUrl);
      if (integrationsPage.statusCode === 200) {
        const integrationsDetected = detectTechStack({
          url: integrationsUrl,
          html: integrationsPage.html,
          responseHeaders: integrationsPage.headers,
          scriptUrls: integrationsPage.scriptUrls,
        });
        // Mergededuper avec detected (par techId)
        for (const d of integrationsDetected) {
          if (!detected.find(x => x.techId === d.techId)) {
            detected.push({ ...d, evidence: [...d.evidence, `source:integrations_page`] });
          }
        }
      }
    } catch {
      // page /integrations absente, pas grave
    }

    // 4. Comparer avec l'état actuel en DB
    const current = await db.query.techStackEntries.findMany({
      where: and(
        eq(techStackEntries.competitorId, competitor.id),
        eq(techStackEntries.isActive, true)
      ),
    });

    const currentTechIds = new Set(current.map(c => c.techId));
    const detectedTechIds = new Set(detected.map(d => d.techId));

    // Apparitions
    const appeared = detected.filter(d => !currentTechIds.has(d.techId));
    // Disparitions
    const disappeared = current.filter(c => !detectedTechIds.has(c.techId));
    // Confirmations
    const confirmed = detected.filter(d => currentTechIds.has(d.techId));

    // 5. Mise à jour Postgres
    for (const tech of appeared) {
      await db.insert(techStackEntries).values({
        competitorId: competitor.id,
        techId: tech.techId,
        techName: tech.name,
        category: tech.category,
        importance: tech.importance,
        evidence: tech.evidence,
      });
    }
    for (const tech of disappeared) {
      await db.update(techStackEntries)
        .set({ isActive: false })
        .where(eq(techStackEntries.id, tech.id));
    }
    for (const tech of confirmed) {
      await db.update(techStackEntries)
        .set({ lastDetectedAt: new Date(), evidence: tech.evidence })
        .where(and(
          eq(techStackEntries.competitorId, competitor.id),
          eq(techStackEntries.techId, tech.techId)
        ));
    }

    // 6. Historique ClickHouse
    for (const tech of appeared) {
      await ch.insert({
        table: "tech_stack_history",
        values: [{
          competitor_id: competitor.id,
          tech_id: tech.techId,
          event: "appeared",
          importance: tech.importance,
        }],
        format: "JSONEachRow",
      });
    }
    for (const tech of disappeared) {
      await ch.insert({
        table: "tech_stack_history",
        values: [{
          competitor_id: competitor.id,
          tech_id: tech.techId,
          event: "disappeared",
          importance: tech.importance,
        }],
        format: "JSONEachRow",
      });
    }

    // 7. Signal si apparition d'une tech "high" importance
    const minImportance = process.env.TECH_STACK_SIGNAL_MIN_IMPORTANCE ?? "medium";
    const importantAppearances = appeared.filter(t => importanceRank(t.importance) >= importanceRank(minImportance));

    for (const tech of importantAppearances) {
      await generateTechStackSignal(competitor, tech);
    }

    logger.info({ competitorId: competitor.id, appeared: appeared.length, disappeared: disappeared.length },
      "Tech stack scrape completed");
  },
});

function importanceRank(level: string): number {
  return { low: 1, medium: 2, high: 3 }[level] ?? 0;
}

async function generateTechStackSignal(competitor: Competitor, tech: DetectedTech) {
  // Réutiliser le pipeline de signal existant (Phase 3)
  // Catégorie : "tech_stack_change"
  // Severity : selon importance
  // Title : "Nouvelle intégration détectée chez {competitor.name} : {tech.name}"
  // Insight (IA) : "X a ajouté Y, ce qui suggère ..."
}
```

### Schedule : job mensuel par concurrent

Plutôt qu'un job global qui ramasse tous les concurrents, programmer le
`scrape-tech-stack` à un intervalle de 30 jours par concurrent (style
fréquence adaptative patch-01 mais en plus simple). Réutiliser le mécanisme
de `nextRunAt` mais avec interval fixe.

→ vérifier : un concurrent → job déclenché 1× par mois
→ vérifier : apparition de Stripe → entrée Postgres + historique CH + signal généré
→ vérifier : disparition d'une tech → entrée passée en isActive=false

Commit : `feat(workers): monthly tech stack scrape job with signal generation`

---

## Étape 5 — API : exposer le tech stack

### apps/api/src/routes/competitors.ts

Étendre la réponse de la fiche concurrent pour inclure le tech stack :

```
GET /api/competitors/:id
  → étendre la réponse avec :
    techStack: {
      entries: [
        { techId, name, category, importance, firstDetectedAt, lastDetectedAt },
        ...
      ],
      lastScrapedAt: timestamp,
    }
```

Pas de nouvelle route dédiée — c'est de la donnée d'enrichissement de la
fiche concurrent.

→ vérifier : GET competitor retourne le tech stack

Commit : `feat(api): include tech stack in competitor detail response`

---

## Étape 6 — UI : afficher le tech stack sur la fiche concurrent

### apps/web/src/components/outrival/competitor-tech-stack.tsx

Section sur la fiche concurrent, à côté des autres sections (pricing,
features, jobs, reviews).

```
┌─ Stack technique détectée ────────────────────────────┐
│  🟢 À jour · Dernier scan : il y a 3 jours            │
│                                                         │
│  PAIEMENTS                                              │
│    ✓ Stripe                                            │
│                                                         │
│  CRM & INTÉGRATIONS                                     │
│    ✓ Salesforce        (apparu il y a 12 jours)       │
│    ✓ HubSpot                                           │
│                                                         │
│  ANALYTICS                                              │
│    ✓ PostHog                                           │
│                                                         │
│  HOSTING & CDN                                          │
│    ✓ Vercel                                            │
│    ✓ Cloudflare                                        │
│                                                         │
└────────────────────────────────────────────────────────┘
```

Groupé par catégorie. Mention "apparu il y a X jours" pour les détections
récentes (<30 jours). FreshnessDot (patch-14) sur la section.

→ vérifier : section affichée avec toutes les tech actives
→ vérifier : disparition d'une tech → ne plus apparaître dans la liste
→ vérifier : signal généré dans le feed pour les apparitions importantes

Commit : `feat(web): display tech stack on competitor profile page`

---

## Étape 7 — Vérification finale + mesures

```bash
pnpm build && pnpm typecheck && pnpm ch:setup
```

Test end-to-end :

1. Compteur de tech : créer un concurrent fictif avec une homepage qui charge Stripe + PostHog
2. Déclencher manuellement scrape-tech-stack pour ce concurrent
3. Vérifier : 2 entrées dans tech_stack_entries (Stripe, PostHog)
4. Vérifier : 2 lignes "appeared" dans tech_stack_history
5. Modifier la fixture pour ajouter Salesforce et retirer PostHog
6. Re-déclencher le job
7. Vérifier : Salesforce ajouté (high importance), PostHog désactivé, signal généré pour Salesforce
8. Vérifier : tech_stack_history a "appeared" pour Salesforce et "disappeared" pour PostHog
9. UI : section "Stack technique" affichée avec Stripe + Salesforce
10. Test schedule mensuel : vérifier que le job ne re-tourne pas avant 30 jours

Mettre à jour findings.md :
- Tech effectivement détectées par fréquence (top 20)
- Faux positifs/négatifs observés (calibrer les regex)
- Nouvelles tech à ajouter au catalogue par observation

task_plan.md : patch-18 → complete.
</task>

<constraints>
- Scraper INDÉPENDANT — pas couplé au scrape-monitor de la homepage
- Fréquence mensuelle par défaut (TECH_STACK_SCRAPE_INTERVAL_DAYS=30)
- Signal généré UNIQUEMENT pour les apparitions d'importance >= medium
  (pas pour les disparitions, sauf cas exceptionnels)
- Le catalogue est NON-EXHAUSTIF au départ — il s'enrichit par observation
- Détection multi-source (headers + scripts + DOM + footer + page integrations)
- Aucune dépendance externe à un service tiers (genre Wappalyzer API payant)
- L'absence de la page /integrations est silencieuse, pas une erreur
- Compatible patch-14 : FreshnessDot sur la section UI
- Surgical : nouveau scraper, nouveau job, nouvelle table — pas d'impact sur
  les pipelines existants
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@packages/scrapers/CLAUDE.md
@apps/workers/CLAUDE.md
@apps/web/CLAUDE.md
@PHASES/05-enrichissement.md (pattern de scraper indépendant)
@PHASES/patch-01-scraping-cost.md
@PHASES/patch-07-scraping-perf.md
@PHASES/patch-14-trust-and-clarity.md
@PHASES/patch-16-homepage-scraping-v2.md
@.claude/skills/clickhouse/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Catalogue typé importable, 10+ tech au départ
✓ Détecteur identifie Stripe via script + footer
✓ Détecteur identifie Vercel via headers
✓ Tables techStackEntries (PG) et tech_stack_history (CH) créées
✓ Job scrape-tech-stack fonctionne sur un concurrent test
✓ Apparition d'une tech high importance → signal généré
✓ Disparition d'une tech → entrée isActive=false, historique CH "disappeared"
✓ Confirmation d'une tech existante → lastDetectedAt mis à jour
✓ Fréquence mensuelle respectée (pas de re-scrape avant 30 jours)
✓ UI affiche la section tech stack groupée par catégorie
✓ Mention "apparu il y a X jours" pour les détections récentes
✓ Aucune régression sur les pipelines existants
✓ task_plan.md patch-18 = complete
</verification>

<commit>
feat(scrapers): tech stack catalog with detection patterns
feat(scrapers): tech stack detector from headers/scripts/dom/footer
feat(db): add tech stack tables (postgres + clickhouse)
feat(workers): monthly tech stack scrape job with signal generation
feat(api): include tech stack in competitor detail response
feat(web): display tech stack on competitor profile page
</commit>