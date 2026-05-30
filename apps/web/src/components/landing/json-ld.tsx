const SITE_URL = "https://outrival.io";

const FAQS = [
  {
    q: "How do you monitor sites with anti-bot protection?",
    a: "Crawlee with proxy rotation handles the majority of sources. ScrapingBee acts as a managed headless-browser fallback for the most protected sites. No source needs manual setup on your side.",
  },
  {
    q: "What qualifies a change as a signal?",
    a: "A Llama 3.3 70B classifier on Groq runs on every diff and tags category, severity, and a 'significant' boolean. Only significant changes go to Claude for insight generation. On average we surface 1 signal for every 70 changes scanned.",
  },
  {
    q: "Where is the data stored?",
    a: "All in the EU. Application server on Hetzner (Germany), PostgreSQL on Railway EU, ClickHouse Cloud EU for time-series, HTML snapshots and screenshots on Cloudflare R2. Nothing transits outside the EU.",
  },
  {
    q: "Can I connect my own source?",
    a: "Yes — on the Business plan. Internal APIs, an intranet, a shared Notion. The format goes through our custom-scraper interface and benefits from the same classification and insight pipeline.",
  },
  {
    q: "How often is a competitor scanned?",
    a: "Configurable per source. Defaults: homepage and pricing every 6h, blog and changelog every 12h, jobs daily, reviews weekly.",
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
      inLanguage: ["en", "fr"],
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
        email: "hello@outrival.io",
        areaServed: "EU",
        availableLanguage: ["English", "French"],
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
