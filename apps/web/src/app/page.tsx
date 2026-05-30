import type { Metadata } from "next";
import { Alerts } from "@/components/landing/alerts";
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
import { Quote } from "@/components/landing/quote";
import { Sources } from "@/components/landing/sources";
import { Trust } from "@/components/landing/trust";

export const metadata: Metadata = {
  title: "Outrival — Automated competitive intelligence, written by AI",
  description:
    "Outrival monitors 10 sources per competitor — pricing, product, hiring, G2 reviews. AI filters out 99% of noise. Strategic digest written by Claude every Monday, Slack alerts on critical signals. Hosted in the EU.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <JsonLd />
      <Nav />
      <Hero />
      <Trust />
      <Monitors />
      <Sources />
      <Pipeline />
      <Categories />
      <DigestFeature />
      <Alerts />
      <Comparison />
      <Quote />
      <Pricing />
      <FAQ />
      <CTA />
      <Footer />
    </>
  );
}
