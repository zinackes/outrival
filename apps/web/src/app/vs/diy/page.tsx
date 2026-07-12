import type { Metadata } from "next";
import { DiyPage } from "@/components/landing/compare/diy-page";

export const metadata: Metadata = {
  title: {
    absolute: "Outrival vs Doing It Yourself: DIY Competitor Tracking (2026)",
  },
  description:
    "Outrival vs the DIY stack — ChangeDetection.io + ChatGPT, Google Alerts, and a Notion page. The honest comparison, the real hidden costs, and when rolling your own is the right call.",
  alternates: { canonical: "/vs/diy" },
  openGraph: {
    type: "website",
    url: "/vs/diy",
    title: "Outrival vs Doing It Yourself: DIY Competitor Tracking (2026)",
    description:
      "A change-detection script, ChatGPT, Google Alerts and a spreadsheet — versus one product that writes the takeaway. What DIY really costs.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Outrival vs doing it yourself (2026)",
    description:
      "The free DIY stack versus a product that writes the conclusion. Honest, with the hidden costs.",
  },
};

export default function VsDiyPage() {
  return <DiyPage />;
}
