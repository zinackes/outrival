const SITE_URL = "https://outrival.app";

// The profile URLs that tell a search engine which "Outrival" this is. It
// matters more here than on most sites: the bare term is a dictionary word AND
// an unrelated US company (OutRival Inc., outrival.com), so with nothing in
// `sameAs` there is no machine-readable link between this domain and any other
// corroborating page, and the knowledge graph has no reason to treat us as a
// distinct entity. Add each profile URL as it goes live — LinkedIn company page,
// Crunchbase, X, Product Hunt, a review-platform listing.
//
// Kept empty rather than aspirational: `sameAs` pointing at a page that doesn't
// exist is worse than no `sameAs`. The key is omitted entirely while empty.
const SAME_AS: string[] = [];

const FAQS = [
  {
    q: "How do you monitor sites with anti-bot protection?",
    a: "A browser renders the majority of sources directly. We respect robots.txt, identify our crawler (OutrivalBot), and collect only what a site publishes openly. We never bypass a block, login, or paywall. If a site declines automated access we stop and tell you honestly. No source needs manual setup on your side.",
  },
  {
    q: "What qualifies a change as a signal?",
    a: "A fast AI classifier runs on every diff and tags category, severity, and a 'significant' boolean. Only significant changes go on to a second AI pass that writes the strategic insight. Measured on production in July 2026: about 1 action-grade signal (high or critical) for every 12 changes detected.",
  },
  {
    q: "Where is the data stored?",
    a: "All in the EU. Application server on OVHcloud in France, background workers and job queue on netcup in Austria, PostgreSQL on Neon (EU region), HTML snapshots and screenshots on Cloudflare R2, so your stored data never leaves the EU.",
  },
  {
    q: "Can I track my own product too?",
    a: "Yes, on every plan. Point Outrival at your live site and pricing (or a GitHub repo while you're still building) and your own changes run through the same classification pipeline, so the digest reads your moves alongside your competitors'.",
  },
  {
    q: "How often is a competitor scanned?",
    a: "Defaults: homepage and pricing daily, blog and changelog weekly, jobs daily, reviews weekly. Your plan sets the floor (weekly on Free, daily on Starter, real-time on Pro and up) and stable monitors automatically slow down to save scrapes.",
  },
  {
    q: "How do I cancel?",
    a: "One click from your dashboard, no sales call. No penalty, no forced annual commitment.",
  },
];

export function JsonLd() {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Outrival",
      url: SITE_URL,
      inLanguage: ["en"],
      publisher: { "@id": `${SITE_URL}#org` },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}#org`,
      name: "Outrival",
      url: SITE_URL,
      logo: `${SITE_URL}/opengraph-image`,
      description:
        "Independent software company operating Outrival, an automated competitive-intelligence tool for founders and small teams. Based in France, data stored in the EU.",
      // Topical anchors for the entity. Not keyword stuffing: these are the
      // subjects the site actually documents at length, and they are what
      // separates this Outrival from the unrelated voice-AI company of the
      // same name.
      knowsAbout: [
        "Competitive intelligence",
        "Competitor monitoring",
        "Pricing intelligence",
        "Website change detection",
      ],
      ...(SAME_AS.length > 0 ? { sameAs: SAME_AS } : {}),
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "hello@outrival.app",
        areaServed: "EU",
        availableLanguage: ["English"],
      },
      // Country only: a machine-readable locality is an address claim, and the
      // registered office is the one on /legal-notice — nowhere else.
      address: {
        "@type": "PostalAddress",
        addressCountry: "FR",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}#app`,
      name: "Outrival",
      // Without url + publisher the product entity floated free of the
      // organisation entity right above it, so nothing said the two were the
      // same thing.
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}#org` },
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Automated competitive intelligence platform. Continuously monitors pricing, product, hiring, and review sentiment across your competitors. AI reads every change and surfaces only the ones worth a decision, in a weekly strategic brief.",
      offers: [
        {
          "@type": "Offer",
          name: "Free",
          price: "0",
          priceCurrency: "EUR",
        },
        {
          "@type": "Offer",
          name: "Starter",
          price: "29",
          priceCurrency: "EUR",
        },
        {
          "@type": "Offer",
          name: "Pro",
          price: "79",
          priceCurrency: "EUR",
        },
        {
          "@type": "Offer",
          name: "Business",
          price: "199",
          priceCurrency: "EUR",
        },
      ],
      aggregateRating: undefined,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: f.a,
        },
      })),
    },
  ];

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
