import type { StructuredChangeInput } from "../tasks/classify-structured";

// Labelled ground truth for the severity rubric (2026-07-10 audit item 2) — the
// layer model-eval.ts explicitly lacks. Cases are REAL prod diffs (trimmed),
// hand-labelled with an accepted severity BAND + accepted categories, plus a few
// SYNTHETIC critical cases: prod has never produced a critical, and the band
// must be provably reachable. Run with `pnpm eval:severity` (live LLM calls —
// a manual gate before any change to the classify prompts/models, not CI).
//
// Labelling stance: the band is the set of defensible verdicts, not a wish.
// Over-alerting is the costliest failure (critical pages the customer), so a
// low/medium-labelled case NEVER admits critical, and the rubric's own examples
// ("documentation pages" → low, "a promotion" → medium) are enforced strictly.

export type Severity = "low" | "medium" | "high" | "critical";
export type Category = "pricing" | "product" | "hiring" | "reviews" | "content" | "funding";

interface BaseCase {
  id: string;
  competitorName: string;
  sourceType: string;
  expectSeverity: Severity[];
  expectCategory: Category[];
  synthetic?: boolean;
  note?: string;
}

export interface LexicalCase extends BaseCase {
  kind: "lexical";
  diffText: string;
}

export interface StructuredCase extends BaseCase {
  kind: "structured";
  changes: StructuredChangeInput[];
}

export type GoldenCase = LexicalCase | StructuredCase;

const lexical = (c: Omit<LexicalCase, "kind">): LexicalCase => ({ kind: "lexical", ...c });
const structured = (c: Omit<StructuredCase, "kind">): StructuredCase => ({
  kind: "structured",
  ...c,
});

export const SEVERITY_GOLDEN: GoldenCase[] = [
  // ── Real prod diffs (lexical) ────────────────────────────────────────────
  lexical({
    id: "pricing-new-tiers-yepcode",
    competitorName: "YepCode",
    sourceType: "pricing",
    expectSeverity: ["high"],
    expectCategory: ["pricing"],
    note: "Quantified pricing-structure overhaul → high; no evidence the reaction window is days.",
    diffText: `- / month
- / month
- / month
+ $119 / month
+ +$0.00001 per extra yep
+ $599 / month
+ +$0.000005 per extra yep
+ $1,800 / month
We believe that free software initiatives are cool, so if you are developing an open-source project contact us.`,
  }),
  lexical({
    id: "funding-500m-supabase",
    competitorName: "Supabase",
    sourceType: "news",
    expectSeverity: ["high", "critical"],
    expectCategory: ["funding"],
    diffText: `+ Open-Source Database Supabase Hits $10.5 Billion: AI Coding Boom Mints New Decacorn [Tech Times]
+ Supabase Raises $500 Million at $10.5 Billion Valuation to Expand Postgres Platform for AI Applications [citybiz]
+ Supabase Raises $500 Mln At $10.5 Bln To Accelerate Lead In Agentic Infrastructure [TradingView]`,
  }),
  lexical({
    id: "pricing-premium-launch-mtgstocks",
    competitorName: "MTGStocks",
    sourceType: "pricing",
    expectSeverity: ["medium", "high"],
    expectCategory: ["pricing"],
    diffText: `+ MTGStocks Premium
+ Get more out of your MTG collection with Premium. Track price movements, set alerts, spot underpriced cards, and browse ad-free. Plans start at $4.99/mo.
+ Choose your billing cycle
+ Annual Billing Save 15%
+ Common — The basics, on us — $0/mo`,
  }),
  lexical({
    id: "hiring-two-postings-supabase",
    competitorName: "Supabase",
    sourceType: "jobs",
    expectSeverity: ["medium"],
    expectCategory: ["hiring"],
    diffText: `- Product Manager - AI
Remote
Apply for position
- Marketplace Partnerships Manager
+ Partnerships Manager, Ecosystem
+ Executive Assistant to the CEO — Operations · APAC`,
  }),
  lexical({
    id: "product-minor-ux-slidely",
    competitorName: "Slidely AI",
    sourceType: "changelog",
    expectSeverity: ["low", "medium"],
    expectCategory: ["product"],
    diffText: `- File Attachment Icons preview
Uploaded files are now easier to identify, scan, and use across Slidely.
Clear icons now appear for attached files
+ Select objects on the slide to add to chat
Selected context chips make it easier to target the exact content you want Slidely to update.
Select slides, text, charts, tables, or images before prompting`,
  }),
  lexical({
    id: "techstack-vercel-coachsphere",
    competitorName: "CoachSphere",
    sourceType: "tech_stack",
    expectSeverity: ["low", "medium"],
    expectCategory: ["product", "content"],
    note: "Hosting change detected via headers — informational; the audit flagged this class as feed noise.",
    diffText: `New technology detected on CoachSphere: Vercel (hosting). Evidence: header:server=Vercel, header:x-vercel-id=iad1::2jbnk, header:x-vercel-cache=HIT.`,
  }),
  lexical({
    id: "catalog-price-churn-mtgstocks",
    competitorName: "MTGStocks",
    sourceType: "pricing",
    expectSeverity: ["low", "medium"],
    expectCategory: ["pricing", "content"],
    note: "A price-tracking site's CATALOG data churning (their content, not their pricing) — noise.",
    diffText: `- Chalice of the Void (Borderless)
- $19.94
- $32.50
- $23.23
- $54.00
Commander: The Lost Caverns of Ixalan LCC#105
Chalice of the Void (Borderless)
$29.99 $32.50 $27.99
- $5.30 +19%
- $4.03 +14%
- $7.86 +32%
Judge Promos #7 ✨ $47.56 €38.36
Masters 25 #222 $19.34 €16.35`,
  }),
  lexical({
    id: "staffing-board-churn-solano",
    competitorName: "Solano",
    sourceType: "jobs",
    expectSeverity: ["low", "medium"],
    expectCategory: ["hiring"],
    note: "A staffing agency's interim listings churn constantly — their inventory, not team growth.",
    diffText: `- Chauffeur SPL distribution (H/F)
interim
IFS 14123, France
3 Mois
- Chauffeur SPL benne TP (H/F)
- ST ANDRE SUR ORNE 14320, France
6 Mois
- Chauffeur PL Manoeuvre (H/F)
- LES ANCIZES COMPS 63770, France
- Peintre ravaleur (H/F)
- RENNES 35000, France
3 Mois`,
  }),
  lexical({
    id: "hiring-salaried-roles-dougs",
    competitorName: "Dougs",
    sourceType: "jobs",
    expectSeverity: ["medium"],
    expectCategory: ["hiring"],
    diffText: `+ Comptable - Squad Production H/F — Business & Finance · Bron, France · EUR 34,000–38,000
+ Customer Support - Squad Easy Access H/F — Sales & Customer Service · Bron, France · EUR 30,000
+ Fiscaliste junior H/F — Business & Finance · Bron, France · EUR 30,000–35,000
+ Platform Engineer / SRE H/F — Tech & Engineering · Bron, France · EUR 55,000–65,000`,
  }),
  lexical({
    id: "pricing-model-change-gamelocker",
    competitorName: "Game Locker",
    sourceType: "pricing",
    expectSeverity: ["medium", "high"],
    expectCategory: ["pricing"],
    diffText: `- Access Game Locker free for 30 days to explore, test features, and see how it fits your store.
- 3 users
- Access to 3 games on the platform
- 10 users
- Unlimited games
+ Join our early release with 30-days free access. Transaction and service fees still apply.
+ Unlimited games on the platform
+ Advanced and unlimited automations (all card attributes)
+ AUD / month ($249 per additional store)`,
  }),
  lexical({
    id: "pricing-managed-service-citus",
    competitorName: "Citus Data",
    sourceType: "pricing",
    expectSeverity: ["medium", "high"],
    expectCategory: ["pricing"],
    diffText: `+ Citus on Azure — managed service pricing
+ Starting at approximately $0.27 per hour for a basic configuration
+ The Citus database is available as open source and as a managed service on Azure.
+ Pay-as-you-go, scale compute and storage independently`,
  }),
  lexical({
    id: "product-launch-loop-lane",
    competitorName: "Lane",
    sourceType: "changelog",
    expectSeverity: ["medium", "high"],
    expectCategory: ["product"],
    diffText: `+ Jun 04, 2026
Feature, Improvement
Lane, refocused
From feedback to signals to plans — one connected loop
Lane now centers on a single, connected loop: customer Feedback becomes ranked Signals, and Signals become Plans you commit to and ship.
Signals — Lane detects recurring patterns across your feedback and groups them into Signals — a ranked list of what customers keep asking for, each carrying the customers and revenue behind it.
Plans — Plans are what you decide to build.`,
  }),
  lexical({
    id: "product-feature-encryption-supabase",
    competitorName: "Supabase",
    sourceType: "changelog",
    expectSeverity: ["medium", "high"],
    expectCategory: ["product"],
    diffText: `+ Searchable field-level encryption on Supabase with CipherStash — 2026-07-09 · https://supabase.com/blog/searchable-field-level-encryption-with-cipherstash`,
  }),
  lexical({
    id: "docs-sitemap-growth-supabase",
    competitorName: "Supabase",
    sourceType: "sitemap",
    expectSeverity: ["low"],
    expectCategory: ["content", "product"],
    note: "Documentation pages — the rubric's own low example. The strictest case in the set.",
    diffText: `- Sitemap — 3049 URLs (blog: 411, changelog: 154, docs: 2159, jobs: 1, legal: 7, other: 89, pricing: 4, product: 224)
+ https://supabase.com/docs/reference/dart/admin-api
+ https://supabase.com/docs/reference/dart/auth-admin-passkey-api
+ https://supabase.com/docs/reference/dart/auth-getsession
+ https://supabase.com/docs/reference/dart/auth-mfa-api
+ https://supabase.com/docs/reference/dart/auth-reauthentication`,
  }),
  lexical({
    id: "banner-removed-postiz",
    competitorName: "Postiz",
    sourceType: "homepage",
    expectSeverity: ["low", "medium"],
    expectCategory: ["product", "content"],
    note: "The '-' side REMOVES a promo banner; only generic copy remains. First labelling pass mislabelled this as a launch — the model read the diff direction correctly.",
    diffText: `- NEW: Generate UGC video with your OpenClaw 🦞, Check agent-media
- AI Agents CLI (OpenClaw)
+ Your agentic social media scheduling tool
+ Postiz offers everything you need to manage your social media posts, build an audience, capture leads, and grow your business faster with AI`,
  }),

  // ── Real prod structured homepage changes ────────────────────────────────
  structured({
    id: "structured-hero-tweak-productos",
    competitorName: "ProductOS",
    sourceType: "homepage",
    expectSeverity: ["medium", "high"],
    expectCategory: ["product", "content"],
    changes: [
      {
        kind: "hero_headline_changed",
        field: "hero.headline",
        before: "Build what matters. Ship what works.",
        after: "Build your next product ship it in minutes",
      },
      {
        kind: "hero_subheadline_changed",
        field: "hero.subheadline",
        before: "The AI-native OS for product development",
        after: null,
      },
    ],
  }),
  structured({
    id: "structured-repositioning-collectr",
    competitorName: "Collectr",
    sourceType: "homepage",
    expectSeverity: ["medium", "high"],
    expectCategory: ["content", "product"],
    changes: [
      {
        kind: "hero_headline_changed",
        field: "hero.headline",
        before: "Step Up Your Game -Unlock A New Way Of Collecting!",
        after: "Know what your collection is worth.",
      },
      {
        kind: "hero_subheadline_changed",
        field: "hero.subheadline",
        before: null,
        after:
          "The home for your cards. Catalog your collection, track its real-time value, and make smarter moves.",
      },
      {
        kind: "hero_cta_changed",
        field: "hero.secondaryCta",
        before: null,
        after: "Download on the App Store",
      },
    ],
  }),
  structured({
    id: "structured-antibot-artifact-targetrecruit",
    competitorName: "TargetRecruit",
    sourceType: "homepage",
    expectSeverity: ["low", "medium"],
    expectCategory: ["content", "product"],
    note: "KNOWN MISS (2026-07-10): the 'before' was an anti-bot page ('Robot Challenge Screen') — a capture artifact. Two prompt attempts (rubric line + structured exception-first rule) still yield high; in prod the deny-page/R1 guards filter this class upstream. Kept to pressure future rubric edits.",
    changes: [
      {
        kind: "hero_headline_changed",
        field: "hero.headline",
        before: "targetrecruit.com",
        after: "Enterprise Software for Staffing and Recruiting Firms Built on Salesforce",
      },
      {
        kind: "hero_subheadline_changed",
        field: "hero.subheadline",
        before: "Checking the site connection security",
        after: null,
      },
      {
        kind: "meta_changed",
        field: "meta.title",
        before: "Robot Challenge Screen",
        after: "Enterprise ATS Software for Recruiters - TargetRecruit",
      },
    ],
  }),
  structured({
    id: "structured-pricing-promo-haptic",
    competitorName: "Haptic",
    sourceType: "homepage",
    expectSeverity: ["medium", "high"],
    expectCategory: ["pricing"],
    changes: [
      {
        kind: "section_body_changed",
        field: "sections[pricing]",
        before: "Your server, your way",
        after: "Your server, your way",
        bodyDiff: {
          added: [
            "Limited 25% off with HAPTIC25",
            "Haptic Game Server Hosting 2GB RAM starting at $2.99/mo",
          ],
          removed: [],
        },
      },
    ],
  }),

  // ── Synthetic critical band (prod has never produced one) ────────────────
  lexical({
    id: "synthetic-frontal-undercut",
    competitorName: "RivalTrack",
    sourceType: "pricing",
    synthetic: true,
    expectSeverity: ["critical", "high"],
    expectCategory: ["pricing"],
    note: "Frontal price undercut naming the segment — the rubric's critical archetype.",
    diffText: `- Pro — $79 / month
+ Pro — $39 / month
+ Now 50% cheaper than any other competitive-intelligence platform. Switch in one click: we import your competitors, monitors and history automatically.
+ Limited launch pricing for teams switching this month.`,
  }),
  lexical({
    id: "synthetic-acquisition",
    competitorName: "RivalTrack",
    sourceType: "news",
    synthetic: true,
    expectSeverity: ["critical", "high"],
    expectCategory: ["funding"],
    diffText: `+ Salesforce acquires RivalTrack to bring competitive intelligence to every CRM seat [TechCrunch]
+ RivalTrack joins Salesforce: our product will be bundled into Sales Cloud starting next quarter, free for existing Salesforce customers.`,
  }),
  lexical({
    id: "synthetic-flagship-clone",
    competitorName: "RivalTrack",
    sourceType: "homepage",
    synthetic: true,
    expectSeverity: ["critical", "high"],
    expectCategory: ["product"],
    diffText: `+ Introducing RivalTrack Signals: automatic competitor monitoring with AI insights
+ Track every competitor pricing change, product launch and hiring move — with an AI analyst that tells you what it means for YOUR positioning and what to do about it. Weekly digests and real-time alerts included.
+ Free for all existing customers, live today.`,
  }),
  lexical({
    id: "synthetic-megaround-segment-entry",
    competitorName: "RivalTrack",
    sourceType: "news",
    synthetic: true,
    expectSeverity: ["critical", "high"],
    expectCategory: ["funding"],
    diffText: `+ RivalTrack raises $150M Series C to expand into self-serve competitive intelligence for SMBs [Reuters]
+ "We're going down-market aggressively: a free tier launches this week, targeting the exact indie-SaaS segment underserved by enterprise tools," said the CEO.`,
  }),
  lexical({
    id: "synthetic-free-tier-nuke",
    competitorName: "RivalTrack",
    sourceType: "pricing",
    synthetic: true,
    expectSeverity: ["critical", "high"],
    expectCategory: ["pricing"],
    diffText: `- Starter — $29 / month
+ Starter — Free forever
+ Everything in Starter is now free for unlimited competitors: monitoring, AI insights, weekly digests and Slack alerts. Paid plans keep only the API and multi-user seats.
+ Effective immediately for all new and existing accounts.`,
  }),
];
