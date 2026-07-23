import type { DigestContent } from "@/lib/api";

// The single real digest shown on the public /sample page and, in excerpt, on the
// landing (`DigestFeature`). It renders through the SAME `DigestView` the in-app
// reader uses, so what a visitor sees is exactly what a client receives — not a
// parallel marketing mock-up.
export interface SampleDigest {
  // Display-only label for the digest's week, e.g. "January 6–12, 2026". A plain
  // string (not a Date) so the static page is timezone-independent.
  weekLabel: string;
  // How many competitors appear in this digest — shown as context.
  competitorCount: number;
  content: DigestContent;
}

// A REAL production weekly digest (week of July 6–13, 2026). The client
// organization is anonymized — it never appears by name; the brief is written in
// the first person ("our" / "we"), exactly as the client received it. The
// competitors named are the real companies that client tracks.
//
// Curation rule for this fixture: signals may be REMOVED, never reworded. Every
// line below is verbatim model output; only word-internal non-breaking hyphens
// from the raw scrape were normalized to plain hyphens. Two of the source
// digest's seven signals were dropped — a duplicate partnerships-hiring signal,
// and an "Executive Assistant to the CEO" hiring signal whose own so_what said
// it "does not directly overlap with our positioning". The TL;DR is untouched:
// its three bullets map to the three lead signals kept.
//
// The two lead claims are independently verifiable against public sources:
// Supabase's $500M Series F at a $10.5B valuation, and its searchable
// field-level encryption launch with CipherStash.
export const SAMPLE_DIGEST: SampleDigest = {
  weekLabel: "July 6–13, 2026",
  competitorCount: 2,
  content: {
    temperature: "high",
    tldr: [
      "Supabase's $500M Series F funding intensifies competitive pressure on our serverless Postgres offering.",
      "Supabase's new searchable field-level encryption narrows our security advantage.",
      "Citus's low-cost Azure pricing underscores the need to highlight our cost-efficiency and differentiation.",
    ],
    sections: [
      {
        urgency: "action_required",
        category: "funding",
        competitor: "Supabase",
        insight:
          "Supabase announced a $500 million Series F funding round that valued the company at $10.5 billion.",
        so_what:
          "The large raise underscores Supabase's focus on AI-driven backend services, increasing competitive pressure on our serverless PostgreSQL offering which targets the same developer audience.",
      },
      {
        urgency: "action_required",
        category: "product",
        competitor: "Supabase",
        insight:
          "Supabase announced searchable field-level encryption using CipherStash.",
        so_what:
          "This adds encrypted search capability to Supabase's Postgres offering, potentially narrowing the gap with our serverless Postgres service on security features.",
      },
      {
        urgency: "watch",
        category: "product",
        competitor: "Supabase",
        insight:
          "Supabase expanded its documentation, adding many new Dart SDK reference pages and updating its sitemap to include more URLs and new customer case studies.",
        so_what:
          "The added SDK coverage and new customer pages strengthen Supabase's developer-first positioning, increasing competition in the niche of managed PostgreSQL backends that emphasize easy integration and documentation.",
      },
      {
        urgency: "watch",
        category: "hiring",
        competitor: "Supabase",
        insight:
          "Supabase announced hiring for roles such as Product Manager - AI and Partnerships Manager, Ecosystem.",
        so_what:
          "This signals Supabase is expanding AI product focus and ecosystem partnerships, which could erode our differentiation among developers seeking AI-ready Postgres services; we should accelerate our AI feature roadmap.",
      },
      {
        urgency: "watch",
        category: "pricing",
        competitor: "Citus Data",
        insight:
          "Citus announced pricing details for its managed Azure service, starting at approximately $0.27 per hour, and reiterated that its open-source extension remains free.",
        so_what:
          "This highlights a low-cost, pay-as-you-go option that directly competes with our serverless pricing model, potentially eroding our cost advantage for developers seeking inexpensive scaling.",
      },
    ],
  },
};

// True once the fixture holds a real digest (not the initial "TODO" scaffold).
export const SAMPLE_DIGEST_READY =
  !SAMPLE_DIGEST.weekLabel.startsWith("TODO");
