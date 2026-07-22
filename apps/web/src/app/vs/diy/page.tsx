import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { DiyPage } from "@/components/landing/compare/diy-page";

export const metadata: Metadata = pageMetadata({
  path: "/vs/diy",
  title: "Outrival vs Doing It Yourself: DIY Competitor Tracking (2026)",
  titleAbsolute: true,
  description:
    "Outrival vs the DIY stack — ChangeDetection.io + ChatGPT, Google Alerts, and a Notion page. The honest comparison, the real hidden costs, and when rolling your own is the right call.",
  socialDescription:
    "A change-detection script, ChatGPT, Google Alerts and a spreadsheet — versus one product that writes the takeaway. What DIY really costs.",
  twitterTitle: "Outrival vs doing it yourself (2026)",
  twitterDescription:
    "The free DIY stack versus a product that writes the conclusion. Honest, with the hidden costs.",
});

export default function VsDiyPage() {
  return <DiyPage />;
}
