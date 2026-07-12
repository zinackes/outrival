import type { Metadata } from "next";
import { BestToolsPage } from "@/components/landing/compare/best-tools-page";

export const metadata: Metadata = {
  title: {
    absolute: "Best Competitive Intelligence Tools (2026): 6 Compared Honestly",
  },
  description:
    "The best competitive intelligence tools in 2026, honestly compared: Crayon, Klue, Kompyte, Contify, Visualping and Outrival. Real strengths, dated pricing, and which fits founders vs CI teams.",
  alternates: {
    canonical: "/alternatives/best-competitive-intelligence-tools",
  },
  openGraph: {
    type: "website",
    url: "/alternatives/best-competitive-intelligence-tools",
    title: "Best Competitive Intelligence Tools (2026): 6 Compared Honestly",
    description:
      "Crayon, Klue, Kompyte, Contify, Visualping and Outrival — real strengths and dated pricing. The self-serve, EU-hosted pick starts free.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Competitive Intelligence Tools (2026)",
    description:
      "Six CI tools compared honestly, with dated, sourced pricing and who each is genuinely for.",
  },
};

export default function BestCompetitiveIntelligenceToolsPage() {
  return <BestToolsPage />;
}
