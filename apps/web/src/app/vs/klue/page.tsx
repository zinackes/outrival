import type { Metadata } from "next";
import { VsPage } from "@/components/landing/compare/vs-page";

export const metadata: Metadata = {
  title: { absolute: "Outrival vs Klue: Pricing & Features Compared (2026)" },
  description:
    "Outrival vs Klue, compared honestly. Klue is a sales-enablement CI platform (~$20–40k/yr, third-party est., July 2026); Outrival is self-serve from €0. See who each is for.",
  alternates: { canonical: "/vs/klue" },
  openGraph: {
    type: "website",
    url: "/vs/klue",
    title: "Outrival vs Klue: Pricing & Features Compared (2026)",
    description:
      "A founder-first competitive-intelligence tool vs a sales-enablement CI platform. Pricing, setup, and who each is genuinely for.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Outrival vs Klue (2026)",
    description:
      "Self-serve from €0 vs a five-figure annual CI contract. The honest comparison.",
  },
};

export default function VsKluePage() {
  return <VsPage competitorKey="klue" />;
}
