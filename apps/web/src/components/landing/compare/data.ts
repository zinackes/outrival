// Single source of truth for the comparison / alternatives SEO pages.
//
// LEGAL (FR/EU comparative advertising — Code de la consommation art. L122-1,
// EU Directive 2006/114/EC): every claim here must be objective, verifiable and
// non-misleading. Competitor names appear as TEXT only, never as logos. Crayon
// and Klue do NOT publish public pricing, so all competitor figures are dated,
// third-party estimates attributed to their source — never invented. Outrival's
// own prices are its published list. Keep PRICE_AS_OF in step with any refresh.

export const PRICE_AS_OF = "July 2026";
export const SITE_URL = "https://outrival.app";

export type CompetitorKey = "crayon" | "klue";

type Source = { label: string; href: string };

// Outrival's own published facts — reused across every comparison.
export const OUTRIVAL = {
  name: "Outrival",
  entryPrice: "€0 free, then €29–€199 / month",
  publicPricing: "Public, on the pricing page",
  access: "Self-serve, sign up instantly",
  setup: "~3 minutes",
  aiInsight: "AI writes the insight: what changed, the so-what, the action",
  digest: "Weekly brief + real-time Slack alerts",
  hosting: "100% EU (France)",
  commitment: "Monthly, cancel in one click",
  g2: "New — no G2 profile yet",
  plans: [
    { name: "Free", price: "€0", note: "2 competitors, weekly digest" },
    { name: "Starter", price: "€29", note: "5 competitors, daily scans, Slack" },
    { name: "Pro", price: "€79", note: "15 competitors, real-time alerts, battle cards" },
    { name: "Business", price: "€199", note: "50 competitors, every review source" },
  ],
} as const;

// Shared "When Outrival wins" — the honest case for switching, same on both /vs pages.
export const OUTRIVAL_WINS: { title: string; body: string }[] = [
  {
    title: "You don't have a CI analyst",
    body: "You're a founder, a solo PMM, or a small team. Nobody's job is to live in a competitive-intelligence dashboard, so the tool has to do the reading and hand you the conclusion.",
  },
  {
    title: "The budget is a subscription, not a contract",
    body: "€29 to €199 a month, billed monthly. Compare that with a five-figure annual contract you commit to before you've seen a single insight.",
  },
  {
    title: "You want to be live today",
    body: "Sign up, add competitors, get your first brief in about three minutes. No demo to book, no onboarding call, no implementation window.",
  },
  {
    title: "You read conclusions, not diffs",
    body: "Every signal arrives written: the change, why it matters, and a recommended action. You don't dig through a feed of raw updates to find the one that counts.",
  },
  {
    title: "EU hosting and monthly terms matter to you",
    body: "Data stays in the EU (France), GDPR-first by default, and you can cancel in one click. No annual lock-in to leave.",
  },
];

export const COMPETITORS: Record<CompetitorKey, {
  key: CompetitorKey;
  name: string;
  hqRegion: string;
  hqCell: string;
  tagline: string;
  g2: string;
  // hero verdict — exactly three honest lines
  verdict: string[];
  // comparison-table competitor cells, keyed to the 7 fixed rows
  cells: {
    entryPrice: string;
    access: string;
    setup: string;
    aiInsight: string;
    digest: string;
    hosting: string;
    commitment: string;
  };
  // pricing face-off
  pricing: {
    headline: string;
    estimate: string;
    detail: string;
    source: string;
  };
  betterWhen: { title: string; body: string }[];
  faqs: { q: string; a: string }[];
  sources: Source[];
}> = {
  crayon: {
    key: "crayon",
    name: "Crayon",
    hqRegion: "United States",
    hqCell: "US-based vendor",
    tagline:
      "A broad competitive-intelligence suite for staffed PMM and CI teams: web-change capture, hiring and exec moves, and enterprise battlecard programs.",
    g2: "4.6 / 5 on G2",
    verdict: [
      "Crayon is built for a dedicated intelligence function: a PMM or CI team that lives in the tool, tracks many competitors at depth, and runs battlecards for a large sales org.",
      "Outrival is built for the founder or small team without that function: it reads every competitor's public surface and sends the handful of moves that matter, written up, every week.",
      "Same category, different buyer. If you have a CI analyst and a five-figure budget, Crayon fits. If you don't, Outrival gets you there in minutes for a subscription.",
    ],
    cells: {
      entryPrice: "~$15,000+ / year (third-party est.)",
      access: "Demo required, custom quote",
      setup: "Onboarding, days to weeks",
      aiInsight: "AI-assisted battlecards & curated feed",
      digest: "Curated updates + summaries",
      hosting: "US-based vendor",
      commitment: "Annual contract",
    },
    pricing: {
      headline: "Custom quote, sales-led",
      estimate: "≈ $28,750 / year median",
      detail:
        "Crayon does not publish public pricing. Vendr reports a median annual cost of $28,750 across 90 purchases, ranging $12,450 to $47,100. Battlecards, integrations and services can add to the base.",
      source: "Vendr marketplace + G2",
    },
    betterWhen: [
      {
        title: "You have a dedicated CI or PMM team",
        body: "Crayon rewards a staffed intelligence function that works the tool daily. If nobody owns CI full-time, most of that surface goes unused.",
      },
      {
        title: "You need broad signal capture at depth",
        body: "100+ data types (patents, SEC filings, exec moves, social) across large competitor sets. That breadth is real, and it's more than a small team will consume.",
      },
      {
        title: "You run an enterprise battlecard program",
        body: "Distributing and maintaining battlecards for a large sales org, with adoption analytics, is squarely Crayon's territory.",
      },
      {
        title: "You want deep enterprise integrations",
        body: "Salesforce, Slack and workflow integrations tuned for a full rollout, with a customer-success motion behind them.",
      },
    ],
    faqs: [
      {
        q: "Is Outrival a real alternative to Crayon?",
        a: "For a founder or small team, yes: Outrival reads the same public surfaces (pricing, product, hiring, reviews, content) and writes the strategic takeaway for you, self-serve and for a monthly subscription. For a large, staffed CI team tracking dozens of competitors at depth with a distributed battlecard program, Crayon remains the more complete fit.",
      },
      {
        q: "How much does Crayon cost compared to Outrival?",
        a: "Crayon is sales-led with no public pricing. Vendr reports a median of about $28,750 per year (range $12,450 to $47,100) as of July 2026. Outrival is published: free on 2 competitors, then €29, €79 or €199 per month, billed monthly.",
      },
      {
        q: "Does Crayon have a free trial or self-serve plan?",
        a: "No. Crayon has no public free tier or self-serve signup; you request a demo and receive a custom quote. Outrival is free forever on 2 competitors, with no credit card and no call.",
      },
      {
        q: "Where is my data hosted?",
        a: "Outrival hosts entirely in the EU: application server in France, database and storage in the EU. Crayon is a US-based vendor. If EU data residency is a requirement, that difference matters.",
      },
      {
        q: "Can Outrival produce battle cards like Crayon?",
        a: "Yes. Outrival generates AI battle cards on the Pro plan and up. What it doesn't try to be is a distributed sales-enablement program with adoption analytics for a large rep org — that's where Crayon is purpose-built.",
      },
    ],
    sources: [
      { label: "Vendr — Crayon pricing", href: "https://www.vendr.com/marketplace/crayon" },
      { label: "G2 — Crayon reviews", href: "https://www.g2.com/products/crayon-crayon/reviews" },
      { label: "Capterra — Crayon", href: "https://www.capterra.com/p/176877/Crayon-Intel/" },
    ],
  },
  klue: {
    key: "klue",
    name: "Klue",
    hqRegion: "Canada",
    hqCell: "Canada-based vendor",
    tagline:
      "A sales-first competitive-intelligence and win-loss platform: battlecards, Salesforce integration and rep enablement for B2B sales orgs.",
    g2: "4.8 / 5 on G2",
    verdict: [
      "Klue treats competitive intelligence as a sales-enablement problem: battlecards in the CRM, win-loss interviews, and adoption tracking for a room full of reps. It does that job as well as anyone (4.8 / 5 on G2).",
      "Outrival treats it as a founder's problem: read every competitor's public move and surface the few that matter, written up, without a CI team or an annual contract.",
      "If you're arming a sales org, Klue is the specialist. If you're a founder or small team who just needs to stay ahead, Outrival is live in minutes for a subscription.",
    ],
    cells: {
      entryPrice: "~$16,000–$20,000+ / year (third-party est.)",
      access: "Demo required, custom quote",
      setup: "Onboarding, days to weeks",
      aiInsight: "AI-assisted battlecards & win-loss",
      digest: "Curated updates + rival alerts",
      hosting: "Canada-based vendor",
      commitment: "Annual contract",
    },
    pricing: {
      headline: "Custom quote, sales-led",
      estimate: "≈ $20,000–$40,000 / year typical",
      detail:
        "Klue does not publish public pricing. Third-party marketplaces place entry deployments near $16,000–$20,000/year, with typical deals of $20,000–$40,000 and enterprise above $100,000, scaling by seats and competitors.",
      source: "Vendr, G2 & Capterra estimates",
    },
    betterWhen: [
      {
        title: "You're arming a sales team at scale",
        body: "Battlecards distributed to dozens of reps, kept current, with adoption tracking, is Klue's core strength and the reason for its 4.8 / 5 G2 standing.",
      },
      {
        title: "You want win-loss in the same platform",
        body: "Klue pairs competitive intelligence with structured win-loss interviews, so deal outcomes feed the battlecards directly.",
      },
      {
        title: "You live in Salesforce",
        body: "Deep CRM integration pushes intelligence into the exact place reps already work, rather than a separate dashboard.",
      },
      {
        title: "You have a PMM or enablement owner",
        body: "Klue rewards someone who curates and maintains the program. Without that owner, the enablement machinery is more than a small team needs.",
      },
    ],
    faqs: [
      {
        q: "Is Outrival a real alternative to Klue?",
        a: "For a founder or small team, yes: Outrival monitors competitors and writes the strategic takeaway for you, self-serve and monthly. If your goal is arming a sales org with distributed battlecards and win-loss analysis, Klue is the specialist and the stronger fit.",
      },
      {
        q: "How much does Klue cost compared to Outrival?",
        a: "Klue is sales-led with no public pricing. Third-party estimates put entry deployments near $16,000–$20,000 per year and typical deals at $20,000–$40,000 as of July 2026. Outrival is published: free on 2 competitors, then €29, €79 or €199 per month.",
      },
      {
        q: "Does Klue have a free trial or self-serve plan?",
        a: "No. Klue has no public free tier or self-serve signup; you request a demo and receive a custom quote. Outrival is free forever on 2 competitors, no credit card, no call.",
      },
      {
        q: "Does Outrival do battlecards and win-loss like Klue?",
        a: "Outrival generates AI battle cards on Pro and up, but it is not a sales-enablement platform: there's no distributed battlecard adoption tracking and no structured win-loss module. If those are the job, Klue is built for them.",
      },
      {
        q: "Where is my data hosted?",
        a: "Outrival hosts entirely in the EU (France). Klue is a Canada-based vendor. If EU data residency is a requirement for you, that difference matters.",
      },
    ],
    sources: [
      { label: "Vendr — Klue pricing", href: "https://www.vendr.com/marketplace/klue" },
      { label: "G2 — Klue reviews", href: "https://www.g2.com/products/klue/reviews" },
      { label: "Capterra — Klue", href: "https://www.capterra.com/p/183305/Klue/" },
    ],
  },
};

// ---- Alternatives listicles ------------------------------------------------

export type Alternative = {
  name: string;
  self?: boolean; // Outrival's own entry, styled as the recommended pick
  bestFor: string;
  entryPrice: string; // short cell for the at-a-glance table
  selfServe: string; // short cell
  body: string; // 2–3 honest sentences on real strengths
  tradeoff: string; // the honest limitation
  href?: string; // internal deep-link when we have a page for it
};

const ALT_OUTRIVAL: Alternative = {
  name: "Outrival",
  self: true,
  bestFor: "Founders & small teams",
  entryPrice: "€0, then €29–199/mo",
  selfServe: "Yes, instant",
  body: "Outrival monitors every public surface a competitor has (pricing, product, hiring, reviews, content) and an AI writes the takeaway: what changed, why it matters, what to do. It's self-serve, live in about three minutes, EU-hosted, and billed monthly with a free tier on two competitors.",
  tradeoff: "It's not a sales-enablement suite for a large rep org: no distributed battlecard adoption analytics, no dedicated CI-team tooling.",
  href: "/",
};

const ALT_KLUE: Alternative = {
  name: "Klue",
  bestFor: "Sales enablement at scale",
  entryPrice: "~$20–40k/yr (est.)",
  selfServe: "No, demo required",
  body: "Klue is the category's sales-enablement specialist: battlecards distributed to reps, win-loss analysis, and deep Salesforce integration, with a category-leading 4.8/5 on G2. If your job is arming a sales org, it's hard to beat.",
  tradeoff: "No public pricing or self-serve signup; a five-figure annual contract and a curator to run the program.",
  href: "/vs/klue",
};

const ALT_CRAYON: Alternative = {
  name: "Crayon",
  bestFor: "Staffed CI / PMM teams",
  entryPrice: "~$28.7k/yr median (est.)",
  selfServe: "No, demo required",
  body: "Crayon is a broad CI suite: web-change capture, hiring and exec moves, 100+ data types, and enterprise battlecard programs. Vendr's median sits near $28,750/year. It rewards a dedicated intelligence function tracking many competitors at depth.",
  tradeoff: "No public pricing or self-serve; overkill (and over-budget) without a CI analyst to work it daily.",
  href: "/vs/crayon",
};

const ALT_KOMPYTE: Alternative = {
  name: "Kompyte by Semrush",
  bestFor: "Semrush-stack teams",
  entryPrice: "~$3.6k → $15–25k/yr (est.)",
  selfServe: "No, demo required",
  body: "Now part of Semrush, Kompyte automates competitor tracking and battlecards for product-marketing and sales-enablement teams, and powers Semrush's .Trends. Entry pricing starts low, but the meaningful tier lands around $15,000–$25,000/year per third-party reviews.",
  tradeoff: "Sales-enablement focus and a demo-led sales motion; most value sits behind the higher Growth tier.",
};

const ALT_CONTIFY: Alternative = {
  name: "Contify",
  bestFor: "Mid-market CI feeds",
  entryPrice: "~$10–20k/yr (est.)",
  selfServe: "No, demo required",
  body: "Contify is an AI-native market-and-competitive-intelligence platform serving strategy, product and marketing with a clean, curated feed and battlecards. It was named a Visionary in the inaugural 2026 Gartner Magic Quadrant for CI platforms.",
  tradeoff: "Demo-led with no public self-serve pricing; built for a program owner, not a solo operator.",
};

export const ALTERNATIVES: Record<CompetitorKey, {
  subjectName: string;
  intro: string;
  items: Alternative[];
  faqs: { q: string; a: string }[];
  sources: Source[];
}> = {
  crayon: {
    subjectName: "Crayon",
    intro:
      "Crayon is a capable, broad CI suite, but it's sales-led, priced in the five figures a year, and built for a staffed intelligence team. If you're a founder or small team, or you just want public pricing and a self-serve start, here are the alternatives worth a look in 2026, honestly compared.",
    items: [ALT_OUTRIVAL, ALT_KLUE, ALT_KOMPYTE, ALT_CONTIFY],
    faqs: [
      {
        q: "What is the best Crayon alternative in 2026?",
        a: "It depends on who you are. For founders and small teams who want public pricing and a self-serve start, Outrival is the closest fit: it monitors competitors and writes the takeaway for a monthly subscription. For sales enablement at scale, Klue is the specialist. For a Semrush-stack team, Kompyte. For a mid-market CI feed, Contify.",
      },
      {
        q: "Are there free or cheaper alternatives to Crayon?",
        a: "Yes. Crayon has no public free tier, but Outrival is free forever on two competitors and €29–199/month after that. Kompyte's entry tier starts lower than Crayon, though its meaningful tier lands in the same five-figure range per third-party estimates.",
      },
      {
        q: "Do these alternatives require a demo like Crayon?",
        a: "Klue, Kompyte and Contify are demo-led with custom quotes, like Crayon. Outrival is the outlier: self-serve signup, public pricing, live in minutes, no call.",
      },
      {
        q: "Which alternative is hosted in the EU?",
        a: "Outrival hosts entirely in the EU (France). The other tools here are non-EU vendors (Crayon and Kompyte in the US, Klue in Canada). If EU data residency is a requirement, Outrival is the clear pick.",
      },
      {
        q: "Can any of these track my own product too?",
        a: "Outrival tracks your own product on every plan, running your changes through the same pipeline as your competitors', so the brief reads your moves alongside theirs. The enterprise suites focus on outbound competitor coverage rather than self-monitoring.",
      },
    ],
    sources: [
      { label: "Vendr — Crayon pricing", href: "https://www.vendr.com/marketplace/crayon" },
      { label: "G2 — Crayon alternatives", href: "https://www.g2.com/products/crayon-crayon/competitors/alternatives" },
      { label: "Contify — Kompyte review & pricing", href: "https://www.contify.com/resources/blog/kompyte-review-pricing-alternatives/" },
    ],
  },
  klue: {
    subjectName: "Klue",
    intro:
      "Klue is excellent at sales enablement, but it's sales-led, priced in the five figures a year, and built around a rep org and a program owner. If you're a founder or small team, or you want public pricing and a self-serve start, here are the Klue alternatives worth a look in 2026, honestly compared.",
    items: [ALT_OUTRIVAL, ALT_CRAYON, ALT_KOMPYTE, ALT_CONTIFY],
    faqs: [
      {
        q: "What is the best Klue alternative in 2026?",
        a: "It depends on the job. For founders and small teams who want public pricing and a self-serve start, Outrival fits best: it monitors competitors and writes the takeaway for a monthly subscription. For a broad, staffed CI program, Crayon. For a Semrush-stack team, Kompyte. For a mid-market CI feed, Contify.",
      },
      {
        q: "Are there free or cheaper alternatives to Klue?",
        a: "Yes. Klue has no public free tier, but Outrival is free forever on two competitors and €29–199/month after that. Kompyte's entry tier also starts lower than Klue, though its meaningful tier sits in the five-figure range per third-party estimates.",
      },
      {
        q: "Do these alternatives require a demo like Klue?",
        a: "Crayon, Kompyte and Contify are demo-led with custom quotes, like Klue. Outrival is the outlier: self-serve signup, public pricing, live in minutes, no call.",
      },
      {
        q: "Which alternative handles battlecards and win-loss?",
        a: "Klue is the specialist for distributed battlecards and win-loss. Crayon runs enterprise battlecard programs too. Outrival generates AI battle cards on Pro and up, but doesn't do distributed adoption tracking or structured win-loss — it's built to keep a small team informed, not to arm a large sales org.",
      },
      {
        q: "Which alternative is hosted in the EU?",
        a: "Outrival hosts entirely in the EU (France). The other tools here are non-EU vendors (Klue in Canada, Crayon and Kompyte in the US). If EU data residency matters, Outrival is the clear pick.",
      },
    ],
    sources: [
      { label: "Vendr — Klue pricing", href: "https://www.vendr.com/marketplace/klue" },
      { label: "G2 — Klue alternatives", href: "https://www.g2.com/products/klue/competitors/alternatives" },
      { label: "Contify — Kompyte review & pricing", href: "https://www.contify.com/resources/blog/kompyte-review-pricing-alternatives/" },
    ],
  },
};
