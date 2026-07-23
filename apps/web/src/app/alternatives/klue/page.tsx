import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { AlternativesPage } from "@/components/landing/compare/alternatives-page";

export const metadata: Metadata = pageMetadata({
  path: "/alternatives/klue",
  title: "Best Klue Alternatives (2026): 4 CI Tools Compared",
  titleAbsolute: true,
  description:
    "The best Klue alternatives in 2026, honestly compared: Outrival, Crayon, Kompyte and Contify. Real strengths, dated pricing, and which fits founders vs sales teams.",
  socialDescription:
    "Outrival, Crayon, Kompyte and Contify, with real strengths and dated pricing. The self-serve, EU-hosted pick starts free.",
  twitterTitle: "Best Klue Alternatives (2026)",
  twitterDescription:
    "Four competitive-intelligence tools compared honestly, with dated pricing.",
});

export default function KlueAlternativesPage() {
  return <AlternativesPage competitorKey="klue" />;
}
