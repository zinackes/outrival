import type { Metadata } from "next";
import { Capabilities } from "@/components/landing/capabilities";
import { Categories } from "@/components/landing/categories";
import { Comparison } from "@/components/landing/comparison";
import { CTA } from "@/components/landing/cta";
import { DigestFeature } from "@/components/landing/digest-feature";
import { FAQ } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { FounderNote } from "@/components/landing/founder-note";
import { Hero } from "@/components/landing/hero";
import { JsonLd } from "@/components/landing/json-ld";
import { Nav } from "@/components/landing/nav";
import { Pricing } from "@/components/landing/pricing";
import { ProductShowcase } from "@/components/landing/product-showcase";
import { SampleOffer } from "@/components/landing/sample-offer";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { Sources } from "@/components/landing/sources";
import { Trust } from "@/components/landing/trust";

export const metadata: Metadata = {
  title: {
    absolute: "Outrival: Automated competitive intelligence, written by AI",
  },
  description:
    "Outrival monitors every public surface a competitor has: pricing, product, hiring, reviews. AI reads every change and surfaces only the ones worth a decision, in a strategic digest every Monday, with Slack alerts on critical signals. EU data storage.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <div className="landing-canvas min-h-dvh bg-background font-sans text-foreground antialiased">
      <JsonLd />
      <ScrollReveal />
      <Nav />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Trust />
        <Sources />
        <ProductShowcase />
        <Categories />
        <DigestFeature />
        <Capabilities />
        <Comparison />
        <SampleOffer />
        <Pricing />
        <FAQ />
        <FounderNote />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
