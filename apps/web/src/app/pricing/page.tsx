import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { PricingPage } from "@/components/landing/pricing-page";

export const metadata: Metadata = pageMetadata({
  path: "/pricing",
  title: "Outrival Pricing: Competitive Intelligence from €0 / month",
  titleAbsolute: true,
  description:
    "Outrival's published pricing: free forever on 2 competitors, then €29, €79 or €199 per month, billed monthly. AI costs included, no usage billing, no demo required. Compared with what Crayon and Klue cost.",
  socialDescription:
    "Free on 2 competitors, then €29 to €199 a month. Published price, monthly billing, cancel in one click, in a category where everyone else quotes five figures a year after a demo.",
  twitterTitle: "Outrival pricing",
  twitterDescription:
    "Free on 2 competitors, then €29 to €199 a month. Published, monthly, no demo.",
});

export default function Page() {
  return <PricingPage />;
}
