import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { PostHogProvider } from "@/lib/posthog/provider";
import { PostHogPageView } from "@/lib/posthog/pageview";
import { ConsentBanner } from "@/components/outrival/consent-banner";
import "./globals.css";

// Geist Sans carries the whole product voice — body, UI AND headings. One
// neutral grotesque, the way Vercel/Resend ship: hierarchy comes from weight,
// size and tracking, not a characterful display face (the old Space Grotesk
// read "designed"). Wired to --font-sans, --font-display and --font-syne in
// globals.css; the landing keeps its own brand register (Zodiak serif).
const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

// Data voice (numbers, IDs, timestamps, metrics) — Geist Mono, true monospace so
// the machine-truth layer reads as data, not prose. tabular-nums + slashed-zero
// stay enforced in globals.css.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

// Landing display (brand register) — Zodiak, a modern editorial serif. Self-hosted
// (Fontshare ITF Free Font License). Scoped to the landing via --font-display in
// globals.css (.landing-canvas); the product keeps Geist for headings.
const zodiak = localFont({
  src: [
    { path: "./fonts/zodiak-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/zodiak-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-zodiak",
  display: "swap",
  // Landing-only (brand serif), but the variable lives on the root <html>, so Next
  // would preload both weights (~42KB) on every dashboard page that never uses them.
  // `display: swap` still loads them on demand when the landing renders.
  preload: false,
});

const SITE_URL = "https://outrival.app";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Outrival: Automated competitive intelligence, written by AI",
    template: "%s | Outrival",
  },
  description:
    "Outrival monitors your competitors continuously: pricing, product, hiring, review sentiment. AI reads every change and ships only what's worth a decision, in a strategic digest every Monday. EU data storage.",
  // No `keywords`: search engines have ignored the tag for over a decade, and a
  // single list stamped on every page said the legal notice and the blog were
  // about the same seven things. Per-page relevance comes from the title and
  // description that `lib/metadata.ts` sets.
  authors: [{ name: "Outrival" }],
  creator: "Outrival",
  publisher: "Outrival",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Outrival",
    title: "Outrival: Automated competitive intelligence, written by AI",
    description:
      "Monitor 15 competitors continuously. AI surfaces only the changes worth a decision. Strategic digest every Monday, real-time Slack alerts on critical signals. EU data storage.",
    // og:image is supplied by the app/opengraph-image.tsx file convention. Do NOT
    // set openGraph.images here: an explicit value overrides the file convention
    // (Next merges the file only when openGraph has no own `images` key).
  },
  twitter: {
    card: "summary_large_image",
    title: "Outrival: Automated competitive intelligence, written by AI",
    description:
      "AI surfaces only the changes worth a decision. Strategic digest every Monday. EU data storage.",
    // twitter image is supplied by app/twitter-image.tsx (file convention).
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
      className={`${geistSans.variable} ${geistMono.variable} ${zodiak.variable}`}
      suppressHydrationWarning
    >
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--accent-foreground)] focus:shadow-lg"
        >
          Skip to content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* QueryProvider / TooltipProvider / Toaster live in <AppProviders>, added
              per-area (dashboard, admin, onboarding, dev) — not here — so public routes
              don't ship react-query + sonner + radix-tooltip in their first-load JS. */}
          <PostHogProvider>
            {children}
            <Suspense fallback={null}>
              <PostHogPageView />
            </Suspense>
            <ConsentBanner />
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
