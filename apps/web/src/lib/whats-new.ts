// In-app changelog (Phase B). Static, newest-first — add a release by prepending to
// the array; no DB, no endpoint. The topbar dot compares the latest `date` to a
// localStorage last-seen marker. Each release reads as a patch note: a dated entry
// whose changes are tagged by kind (new / improved / fixed).

export type WhatsNewKind = "new" | "improved" | "fixed";

export interface WhatsNewChange {
  kind: WhatsNewKind;
  text: string;
}

export interface WhatsNewEntry {
  date: string; // ISO date (YYYY-MM-DD)
  title: string;
  changes: WhatsNewChange[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    date: "2026-06-14",
    title: "A faster dashboard",
    changes: [
      {
        kind: "improved",
        text: "Pages now load with your data already in place. Overview, signals, competitors and more are fetched on the server, so you see far fewer loading spinners.",
      },
    ],
  },
  {
    date: "2026-06-13",
    title: "Ask Outrival & a new sign-in",
    changes: [
      {
        kind: "new",
        text: "Ask Outrival — ask a question in plain English and get an answer grounded in the data we already track for you, with links straight to the source.",
      },
      {
        kind: "new",
        text: "Daily starter prompts on the Ask screen, tailored to what's happening in your workspace.",
      },
      {
        kind: "improved",
        text: "Sign in with a 6-digit code or a one-tap link sent to your email. Google and password sign-in are still available.",
      },
    ],
  },
  {
    date: "2026-06-07",
    title: "Multiple products & broader monitoring",
    changes: [
      {
        kind: "new",
        text: "Products — track several products or SKUs from one workspace. Signals are tagged to the products they affect, and you can switch products from the top bar.",
      },
      {
        kind: "new",
        text: "More review sources — Trustpilot, TrustRadius, Gartner and the Play Store join G2 and Capterra, plus Reddit mention tracking.",
      },
      {
        kind: "new",
        text: "More hiring coverage — job tracking now reads more applicant-tracking systems, with seniority and salary captured when available.",
      },
      {
        kind: "new",
        text: "Status pages and release changelogs can now be monitored as their own sources.",
      },
      {
        kind: "new",
        text: "Re-scan any source on demand straight from its page, without waiting for the next scheduled run.",
      },
      {
        kind: "new",
        text: "Activity — a page that shows the scraping work happening behind the scenes for your workspace.",
      },
      {
        kind: "improved",
        text: "Notification controls — quiet hours, weekend mute, a daily email cap, and similar-signal batching so you only get alerted on what matters.",
      },
      {
        kind: "improved",
        text: "Navigation refresh — Settings now has its own sidebar and the main rail is streamlined.",
      },
    ],
  },
  {
    date: "2026-06-06",
    title: "Consumption cockpit",
    changes: [
      {
        kind: "new",
        text: "Trends — pricing, hiring, review and tech trends across your competitors, with drill-down charts.",
      },
      {
        kind: "new",
        text: "Compare — put competitors side by side on positioning, pricing, hiring, reviews and tech, and copy the table.",
      },
      {
        kind: "new",
        text: "Usage — see where you stand against your plan limits, in Settings.",
      },
      {
        kind: "improved",
        text: "Sector trends now has its own page with category filters and history.",
      },
    ],
  },
];

export const WHATS_NEW_SEEN_KEY = "whatsNewSeen";
export const LATEST_WHATS_NEW_DATE = WHATS_NEW[0]?.date ?? "";
