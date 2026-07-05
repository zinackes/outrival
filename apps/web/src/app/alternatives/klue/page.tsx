import type { Metadata } from "next";
import { AlternativesPage } from "@/components/landing/compare/alternatives-page";

export const metadata: Metadata = {
  title: { absolute: "Best Klue Alternatives (2026): 4 CI Tools Compared" },
  description:
    "The best Klue alternatives in 2026, honestly compared: Outrival, Crayon, Kompyte and Contify. Real strengths, dated pricing, and which fits founders vs sales teams.",
  alternates: { canonical: "/alternatives/klue" },
  openGraph: {
    type: "website",
    url: "/alternatives/klue",
    title: "Best Klue Alternatives (2026): 4 CI Tools Compared",
    description:
      "Outrival, Crayon, Kompyte and Contify, with real strengths and dated pricing. The self-serve, EU-hosted pick starts free.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Klue Alternatives (2026)",
    description:
      "Four competitive-intelligence tools compared honestly, with dated pricing.",
  },
};

export default function KlueAlternativesPage() {
  return <AlternativesPage competitorKey="klue" />;
}
