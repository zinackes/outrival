import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Bricolage_Grotesque, Geist, Fira_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { PostHogProvider } from "@/lib/posthog/provider";
import { PostHogPageView } from "@/lib/posthog/pageview";
import { ConsentBanner } from "@/components/outrival/consent-banner";
import "./globals.css";

// Bricolage Grotesque (display/headings). Load the optical-size + width axes so
// font-optical-sizing:auto and condensed titles work (globals.css uses both).
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  axes: ["opsz", "wdth"],
  display: "swap",
});

// Body runs on Geist Sans (neutral, high x-height — built for the screen); the
// grotesque (Bricolage) is reserved for display/headings. Decoupling the two is
// what separates a product UI from a "generated template" look.
const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

// Data voice (numbers, IDs, timestamps, metrics) — testing Fira Sans behind the
// existing --font-geist-mono variable. tabular-nums + slashed-zero stay enforced
// in globals.css.
const geistMono = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-mono",
  display: "swap",
});

const SITE_URL = "https://outrival.app";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#141518" },
  ],
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
      className={`${bricolage.variable} ${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <PostHogProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            <Suspense fallback={null}>
              <PostHogPageView />
            </Suspense>
            <ConsentBanner />
          </PostHogProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
