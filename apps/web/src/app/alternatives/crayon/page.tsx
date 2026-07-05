import type { Metadata } from "next";
import { AlternativesPage } from "@/components/landing/compare/alternatives-page";

export const metadata: Metadata = {
  title: { absolute: "Best Crayon Alternatives (2026): 4 CI Tools Compared" },
  description:
    "The best Crayon alternatives in 2026, honestly compared: Outrival, Klue, Kompyte and Contify. Real strengths, dated pricing, and which fits founders vs CI teams.",
  alternates: { canonical: "/alternatives/crayon" },
  openGraph: {
    type: "website",
    url: "/alternatives/crayon",
    title: "Best Crayon Alternatives (2026): 4 CI Tools Compared",
    description:
      "Outrival, Klue, Kompyte and Contify, with real strengths and dated pricing. The self-serve, EU-hosted pick starts free.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Crayon Alternatives (2026)",
    description:
      "Four competitive-intelligence tools compared honestly, with dated pricing.",
  },
};

export default function CrayonAlternativesPage() {
  return <AlternativesPage competitorKey="crayon" />;
}
