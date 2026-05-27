import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Bricolage_Grotesque, DM_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { PostHogProvider } from "@/lib/posthog/provider";
import { PostHogPageView } from "@/lib/posthog/pageview";
import { ConsentBanner } from "@/components/outrival/consent-banner";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-dm-mono",
  weight: ["300", "400", "500"],
  display: "swap",
});

const SITE_URL = "https://outrival.io";

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Outrival — Automated competitive intelligence, written by AI",
    template: "%s — Outrival",
  },
  description:
    "Outrival monitors your competitors continuously — pricing, product, hiring, G2 reviews. AI filters out 99% of noise and ships a strategic digest every Monday. Hosted in the EU.",
  keywords: [
    "competitive intelligence",
    "competitor monitoring",
    "AI battle cards",
    "B2B SaaS",
    "strategic intelligence",
    "competitor tracking",
    "GDPR",
  ],
  authors: [{ name: "Outrival" }],
  creator: "Outrival",
  publisher: "Outrival",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Outrival",
    title: "Outrival — Automated competitive intelligence, written by AI",
    description:
      "Monitor 15 competitors continuously. AI filters out 99% of noise. Strategic digest every Monday, real-time Slack alerts on critical signals. Hosted in the EU.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Outrival — Automated competitive intelligence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Outrival — Automated competitive intelligence, written by AI",
    description:
      "AI filters out 99% of noise. Strategic digest every Monday. Hosted in the EU.",
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: SITE_URL,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${dmMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <PostHogProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <ConsentBanner />
        </PostHogProvider>
        <Toaster />
      </body>
    </html>
  );
}
