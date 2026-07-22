import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Nav } from "@/components/landing/nav";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { DigestView } from "@/components/dashboard/digest-view";
import { SAMPLE_DIGEST, SAMPLE_DIGEST_READY } from "@/lib/sample-digest";

const TITLE = "A real Outrival weekly digest — sample";
const DESCRIPTION =
  "See an actual Outrival competitive-intelligence digest: the strategic brief a client receives every Monday. Real competitor moves, prioritized by AI. Client organization anonymized — no sign-up needed.";

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

function SampleJsonLd() {
  const data = [
    {
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
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://outrival.app",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Sample digest",
          item: "https://outrival.app/sample",
        },
      ],
    },
  ];
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
    <div className="landing-canvas min-h-dvh bg-background font-sans text-foreground antialiased">
      <SampleJsonLd />
      <Nav />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20"
      >
        {/* Contextual banner — factual, not marketing. */}
        <div className="rounded-lg border border-border bg-background-2 px-4 py-3 text-sm leading-relaxed text-text-muted">
          This is a real Outrival weekly digest{SAMPLE_DIGEST_READY ? `, ${weekLabel}` : ""} — {sections.length}{" "}
          of its signals, unedited. The client organization is anonymized; the
          competitors named are real, public companies. It renders with the same
          component clients read in the app — nothing here is a marketing
          mock-up.
        </div>

        <header className="mt-10">
          <h1 className="text-title-lg font-semibold tracking-tight sm:text-4xl">
            The Monday brief
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-text-muted">
            <span>{sections.length} signals</span>
            <span aria-hidden>·</span>
            <span>{critCount} critical</span>
            <span aria-hidden>·</span>
            <span>Temperature · {content.temperature}</span>
            {competitorCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{competitorCount} competitors</span>
              </>
            )}
          </div>
        </header>

        {SAMPLE_DIGEST_READY ? (
          <div className="mt-8">
            <DigestView content={content} />
          </div>
        ) : (
          <div className="mt-8 rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-text-subtle">
            This sample digest is being prepared.
          </div>
        )}

        {/* Bottom CTA — self-serve, consistent with the rest of the site. */}
        <div className="mt-14 grid gap-6 rounded-2xl border border-border bg-gradient-to-b from-surface to-background-2 p-8 sm:grid-cols-2 sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              This, for your market.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              Add your competitors — we scrape them immediately and your first
              digest reads exactly like this one.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <Button asChild size="lg">
              <Link href="/auth">
                Start monitoring free <ArrowRight size={14} />
              </Link>
            </Button>
            <div className="text-xs text-text-subtle">
              No credit card · cancel in one click
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
