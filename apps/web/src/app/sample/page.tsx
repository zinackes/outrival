import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import Link from "next/link";
import { Footer } from "@/components/landing/footer";
import { Band, PageHero } from "@/components/landing/compare/compare-shell";
import { DigestView } from "@/components/dashboard/digest-view";
import { SAMPLE_DIGEST, SAMPLE_DIGEST_READY } from "@/lib/sample-digest";

const TITLE = "A real Outrival weekly digest (sample)";
const DESCRIPTION =
  "See an actual Outrival competitive-intelligence digest: the strategic brief a client receives every Monday. Real competitor moves, prioritized by AI. Client organization anonymized, no sign-up needed.";

// ownImage: this segment has its own app/sample/opengraph-image.tsx, so the OG
// card is the sample-specific art rather than the generic site image.
export const metadata: Metadata = pageMetadata({
  path: "/sample",
  title: TITLE,
  titleAbsolute: true,
  description: DESCRIPTION,
  type: "article",
  ownImage: true,
});

// WebPage only — the BreadcrumbList that used to live here now comes from
// <PageHero>, which emits it as structured data with no visible trail.
function SampleJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: TITLE,
    description: DESCRIPTION,
    url: "https://outrival.app/sample",
    inLanguage: "en",
    isPartOf: { "@id": "https://outrival.app#org" },
    about: {
      "@type": "SoftwareApplication",
      name: "Outrival",
      applicationCategory: "BusinessApplication",
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function SamplePage() {
  const { weekLabel, competitorCount, content } = SAMPLE_DIGEST;
  const sections = content.sections;
  const critCount = sections.filter((s) => s.urgency === "action_required").length;

  return (
    <div className="landing-canvas lp-light lp-page min-h-dvh font-sans antialiased">
      <SampleJsonLd />

      <main id="main-content" tabIndex={-1}>
        <PageHero
          crumbs={[
            { name: "Home", path: "/" },
            { name: "Sample digest", path: "/sample" },
          ]}
        >
          <h1>
            The Monday <span className="lp-serif-accent">brief</span>
          </h1>
          <p className="lp-page-lead">
            This is a real Outrival weekly digest
            {SAMPLE_DIGEST_READY ? `, ${weekLabel}` : ""}, showing{" "}
            {sections.length} of its signals, unedited. The client organization
            is anonymized; the competitors named are real, public companies. It
            renders with the same component clients read in the app. Nothing
            here is a marketing mock-up.
          </p>
          <p className="lp-page-meta">
            {sections.length} signals · {critCount} critical · Temperature{" "}
            {content.temperature}
            {competitorCount > 0 ? ` · ${competitorCount} competitors` : ""}
          </p>
        </PageHero>

        {/* The digest on graphite: it is the product, and the landing shows the
            product on its dark region. Band flips the token set, so the app
            component renders in its dark theme rather than a light one pasted
            onto a dark ground. */}
        <Band tone="dark">
          {/* Capped to a reading measure but not centred in the band: a digest
              is read, and it shares its left edge with the head above it. */}
          <div className="w-full max-w-3xl">
            {SAMPLE_DIGEST_READY ? (
              <DigestView content={content} />
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-text-subtle">
                This sample digest is being prepared.
              </div>
            )}
          </div>
        </Band>

        <Band tone="paper">
          <aside className="lp-final">
            <h2>
              This, for your <span className="lp-serif-accent">market</span>.
            </h2>
            <p className="sub-f">
              Add your competitors. We scrape them immediately and your first
              digest reads exactly like this one.
            </p>
            <Link className="lp-btn-accent" href="/auth">
              Start monitoring free
            </Link>
            <p className="lp-final-micro">
              No credit card · cancel in one click
            </p>
          </aside>
        </Band>
      </main>

      <div className="dark" data-lp-tone="dark">
        <Footer />
      </div>
    </div>
  );
}
