import type { Metadata } from "next";
import { Categories } from "@/components/landing/categories";
import { CTA } from "@/components/landing/cta";
import { FAQ } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { FounderNote } from "@/components/landing/founder-note";
import { Hero } from "@/components/landing/hero";
import { HotCard } from "@/components/landing/hot-card";
import { JsonLd } from "@/components/landing/json-ld";
import { Pipeline } from "@/components/landing/pipeline";
import { Pricing } from "@/components/landing/pricing";
import { ProductShowcase } from "@/components/landing/product-showcase";

export const metadata: Metadata = {
  title: {
    absolute: "Outrival: Automated competitive intelligence, written by AI",
  },
  description:
    "Outrival monitors every public surface a competitor has: pricing, product, hiring, reviews. AI reads every change and surfaces only the ones worth a decision, in a strategic digest every Monday, with Slack alerts on critical signals. EU data storage.",
  alternates: { canonical: "/" },
};

// The landing's rhythm is region-based: paper hero (root pins .lp-light so the
// page ignores html.dark), one dark body carrying the whole product argument,
// a paper return for the human part, then the footer back in dark. The `dark`
// class on a region flips every system token (severities, categories, text)
// for its subtree — components inside never theme themselves. Hero renders its
// own <Nav tone="landing" /> so the nav sits inside the fog stack.
export default function HomePage() {
  return (
    <div className="landing-canvas lp-light min-h-dvh bg-background font-sans text-foreground antialiased">
      <JsonLd />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        {/* data-lp-tone marks the regions the floating nav pill has to go dark
            over: the pill is fixed, it crosses paper and ink alike, and it
            samples these boxes at its own height (see landing/nav.tsx). */}
        <section className="lp-body-dark dark" data-lp-tone="dark">
          <ProductShowcase />
          <Pipeline />
          <Categories />
          <HotCard />
          <Pricing />
        </section>
        <section className="lp-body-light">
          <div className="lp-light-inner">
            <FounderNote />
            <FAQ />
            <CTA />
          </div>
        </section>
      </main>
      <div className="dark" data-lp-tone="dark">
        <Footer />
      </div>
    </div>
  );
}
