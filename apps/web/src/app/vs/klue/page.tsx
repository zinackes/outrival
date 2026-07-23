import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { VsPage } from "@/components/landing/compare/vs-page";

export const metadata: Metadata = pageMetadata({
  path: "/vs/klue",
  title: "Outrival vs Klue: Pricing & Features Compared (2026)",
  titleAbsolute: true,
  description:
    "Outrival vs Klue, compared honestly. Klue is a sales-enablement CI platform (~$20–40k/yr, third-party est., July 2026); Outrival is self-serve from €0. See who each is for.",
  socialDescription:
    "A founder-first competitive-intelligence tool vs a sales-enablement CI platform. Pricing, setup, and who each is genuinely for.",
  twitterTitle: "Outrival vs Klue (2026)",
  twitterDescription:
    "Self-serve from €0 vs a five-figure annual CI contract. The honest comparison.",
});

export default function VsKluePage() {
  return <VsPage competitorKey="klue" />;
}
