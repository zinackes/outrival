const SITE_URL = "https://outrival.app";

const FAQS = [
  {
    q: "How do you monitor sites with anti-bot protection?",
    a: "A stealth browser handles the majority of sources directly. For protected sites it escalates through a datacenter-to-residential proxy cascade, only paying for the heavier path when a site actually blocks us. No source needs manual setup on your side.",
  },
  {
    q: "What qualifies a change as a signal?",
    a: "A fast Llama 3.3 70B classifier runs on every diff and tags category, severity, and a 'significant' boolean. Only significant changes go on to a frontier LLM for insight generation. On average we surface 1 signal for every 70 changes scanned.",
  },
  {
    q: "Where is the data stored?",
    a: "All in the EU. Application server on OVH (France), PostgreSQL on Neon (EU), HTML snapshots and screenshots on Cloudflare R2 — your stored data never leaves the EU.",
  },
  {
    q: "Can I track my own product too?",
    a: "Yes, on every plan. Point Outrival at your live site and pricing — or a GitHub repo while you're still building — and your own changes run through the same classification pipeline, so the digest reads your moves alongside your competitors'.",
  },
  {
    q: "How often is a competitor scanned?",
    a: "Defaults: homepage and pricing daily, blog and changelog weekly, jobs daily, reviews weekly. Your plan sets the floor — weekly on Free, daily on Starter, real-time on Pro and up — and stable monitors automatically slow down to save scrapes.",
  },
  {
    q: "How do I cancel?",
    a: "One click from your dashboard — no sales call. No penalty, no forced annual commitment.",
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
      logo: `${SITE_URL}/og.png`,
      sameAs: [],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "hello@outrival.app",
        areaServed: "EU",
        availableLanguage: ["English"],
      },
      address: {
        "@type": "PostalAddress",
        addressLocality: "Paris",
        addressCountry: "FR",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Outrival",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Automated competitive intelligence platform. Continuously monitors pricing, product, hiring, and G2 reviews across your competitors. AI filters out 99% of noise and produces a weekly strategic brief.",
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
