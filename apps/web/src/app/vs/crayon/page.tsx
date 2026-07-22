import type { Metadata } from "next";
import { VsPage } from "@/components/landing/compare/vs-page";

export const metadata: Metadata = {
  title: { absolute: "Outrival vs Crayon: Pricing & Features Compared (2026)" },
  description:
    "Outrival vs Crayon, compared honestly. Crayon is a sales-led CI suite (median ~$29,500/yr, Vendr, Feb 2026); Outrival is self-serve from €0. See who each is for.",
  alternates: { canonical: "/vs/crayon" },
  openGraph: {
    type: "website",
    url: "/vs/crayon",
    title: "Outrival vs Crayon: Pricing & Features Compared (2026)",
    description:
      "A founder-first competitive-intelligence tool vs an enterprise CI suite. Pricing, setup, and who each is genuinely for.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Outrival vs Crayon (2026)",
    description:
      "Self-serve from €0 vs a five-figure annual CI contract. The honest comparison.",
  },
};

export default function VsCrayonPage() {
  return <VsPage competitorKey="crayon" />;
}
