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
