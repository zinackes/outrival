import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { BestToolsPage } from "@/components/landing/compare/best-tools-page";

export const metadata: Metadata = pageMetadata({
  path: "/alternatives/best-competitive-intelligence-tools",
  title: "Best Competitive Intelligence Tools (2026): 6 Compared Honestly",
  titleAbsolute: true,
  description:
    "The best competitive intelligence tools in 2026, honestly compared: Crayon, Klue, Kompyte, Contify, Visualping and Outrival. Real strengths, dated pricing, and which fits founders vs CI teams.",
  socialDescription:
    "Crayon, Klue, Kompyte, Contify, Visualping and Outrival: real strengths and dated pricing. The self-serve, EU-hosted pick starts free.",
  twitterTitle: "Best Competitive Intelligence Tools (2026)",
  twitterDescription:
    "Six CI tools compared honestly, with dated, sourced pricing and who each is genuinely for.",
});

export default function BestCompetitiveIntelligenceToolsPage() {
  return <BestToolsPage />;
}
