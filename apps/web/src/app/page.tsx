import type { Metadata } from "next";
import { Alerts } from "@/components/landing/alerts";
import { Capabilities } from "@/components/landing/capabilities";
import { Categories } from "@/components/landing/categories";
import { Comparison } from "@/components/landing/comparison";
import { CTA } from "@/components/landing/cta";
import { DigestFeature } from "@/components/landing/digest-feature";
import { FAQ } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { JsonLd } from "@/components/landing/json-ld";
import { Monitors } from "@/components/landing/monitors";
import { Nav } from "@/components/landing/nav";
import { Pipeline } from "@/components/landing/pipeline";
import { Pricing } from "@/components/landing/pricing";
import { Sources } from "@/components/landing/sources";
import { Trust } from "@/components/landing/trust";

export const metadata: Metadata = {
  title: "Outrival — Automated competitive intelligence, written by AI",
  description:
    "Outrival monitors every public surface a competitor has — pricing, product, hiring, reviews. AI filters out 99% of the noise and writes a strategic digest every Monday, with Slack alerts on critical signals. Hosted in the EU.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <div className="dark min-h-screen bg-background font-sans text-foreground antialiased">
      <JsonLd />
      <Nav />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Trust />
        <Monitors />
        <Sources />
        <Pipeline />
        <Categories />
        <DigestFeature />
        <Alerts />
        <Capabilities />
        <Comparison />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
