import { OUTRIVAL, SITE_URL } from "./data";

// JSON-LD helpers for the comparison / alternatives pages. Each renders a single
// <script type="application/ld+json">. Kept to the types with real Rich Results
// support (BreadcrumbList, FAQPage) plus ItemList for the listicles.

function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; path: string }[];
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((it, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: it.name,
          item: it.path === "/" ? SITE_URL : `${SITE_URL}${it.path}`,
        })),
      }}
    />
  );
}

export function FaqJsonLd({ faqs }: { faqs: { q: string; a: string }[] }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }}
    />
  );
}

// SoftwareApplication entity for Outrival itself — the "what is this product"
// markup LLMs and search engines cite. Offers are built from OUTRIVAL.plans so
// the structured price ladder never drifts from the page. Deliberately NO
// aggregateRating: Outrival has no public review profile yet, and inventing a
// rating would be dishonest (and against Google's structured-data policy).
export function SoftwareAppJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: OUTRIVAL.name,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: SITE_URL,
        description:
          "AI competitive intelligence for founders and small teams: Outrival monitors every public surface a competitor has (pricing, product, hiring, reviews, content) and writes the takeaway — what changed, why it matters, and what to do.",
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "EUR",
          lowPrice: "0",
          highPrice: "199",
          offerCount: OUTRIVAL.plans.length,
          offers: OUTRIVAL.plans.map((p) => ({
            "@type": "Offer",
            name: p.name,
            price: p.price.replace(/[^0-9]/g, "") || "0",
            priceCurrency: "EUR",
          })),
        },
      }}
    />
  );
}

export function ItemListJsonLd({
  name,
  items,
}: {
  name: string;
  items: string[];
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "ItemList",
        name,
        itemListElement: items.map((label, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: label,
        })),
      }}
    />
  );
}
