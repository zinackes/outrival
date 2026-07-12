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

// A REAL production weekly digest (week of June 22–29, 2026). The client
// organization is anonymized — it never appears by name; the brief is written in
// the first person ("our" / "we"), exactly as the client received it. The
// competitors named are the real companies that client tracks. Only word-internal
// non-breaking hyphens from the raw scrape were normalized to plain hyphens; no
// wording was changed.
export const SAMPLE_DIGEST: SampleDigest = {
  weekLabel: "June 22–29, 2026",
  competitorCount: 4,
  content: {
    temperature: "high",
    tldr: [
      "High-severity moves by JobTetris (HubSpot CRM) and SeekLab (premium pricing & elite positioning) could erode our AI-driven matching advantage in the upper-segment market — action required.",
      "Medium-severity adoption of Vercel by Startify and Clikhire improves their performance, modestly narrowing our speed differentiation — watch.",
      "SeekLab's refreshed branding and Clikhire's job-volume emphasis add competitive narrative pressure, but also give us an opportunity to highlight our deeper company insights and fairness controls — watch.",
    ],
    sections: [
      {
        urgency: "action_required",
        category: "product",
        competitor: "JobTetris",
        insight:
          "JobTetris has added a HubSpot CRM integration, as indicated by the embedded script https://js.hsforms.net/forms/embed/v2.js.",
        so_what:
          "This integration could enhance JobTetris's ability to capture and nurture leads, potentially narrowing the advantage of our AI-driven matching by offering smoother recruiter workflows.",
      },
      {
        urgency: "action_required",
        category: "pricing",
        competitor: "SeekLab",
        insight:
          "SeekLab updated its hero messaging to emphasize targeting companies that pursue world-class talent and added new pricing sections labeled Marcus and Jordan, while introducing CTA buttons for a demo and open jobs.",
        so_what:
          "The new messaging reinforces a premium positioning focused on elite talent acquisition, which could encroach on our AI-driven matching value proposition for high-growth firms.",
      },
      {
        urgency: "watch",
        category: "product",
        competitor: "Startify",
        insight:
          "Startify has adopted Vercel as its hosting platform, as indicated by response headers showing server=Vercel and related Vercel identifiers.",
        so_what:
          "This shift to a modern serverless hosting solution could improve Startify's performance and scalability, potentially challenging our differentiation based on AI-driven matching speed and user experience.",
      },
      {
        urgency: "watch",
        category: "product",
        competitor: "Clikhire",
        insight:
          "Clikhire is now using Vercel for hosting, as indicated by response headers showing server=Vercel and related Vercel identifiers.",
        so_what:
          "This signals a potential improvement in site performance and scalability for Clikhire, which could narrow the speed advantage we claim for our platform.",
      },
      {
        urgency: "watch",
        category: "content",
        competitor: "SeekLab",
        insight:
          "SeekLab refreshed its branding with a 'SeekLab × Pin Live' banner and introduced a new AI-powered marketplace narrative, highlighting a network of 1000+ expert recruiters, 70% faster hiring and a 25-day average time to hire.",
        so_what:
          "The updated positioning overlaps with our AI-driven matching value proposition and adds a recruiter bounty model that could erode our differentiation, but the focus on a marketplace and speed creates an opportunity to emphasize our deeper company insights and fairness controls.",
      },
      {
        urgency: "watch",
        category: "hiring",
        competitor: "Clikhire",
        insight:
          "Clikhire updated its site to display a sign-in prompt and a count of 2657 active positions, listing numerous job openings across multiple cities and categories.",
        so_what:
          "By emphasizing sheer job volume and broad coverage, Clikhire challenges our value proposition of AI-driven matching and detailed company insights, potentially diluting our differentiation on quality over quantity.",
      },
    ],
  },
};

// True once the fixture holds a real digest (not the initial "TODO" scaffold).
export const SAMPLE_DIGEST_READY =
  !SAMPLE_DIGEST.weekLabel.startsWith("TODO");
