import type { DigestContent } from "@/lib/api";

// The single real digest shown on the public /sample page and, in excerpt, on the
// landing (`DigestFeature`). It renders through the SAME `DigestView` the in-app
// reader uses, so what a visitor sees is exactly what a client receives — not a
// parallel marketing mock-up.
export interface SampleDigest {
  // Display-only label for the digest's week, e.g. "January 6–12, 2026". A plain
  // string (not a Date) so the static page is timezone-independent.
  weekLabel: string;
  // How many competitors the (anonymized) client org tracks — shown as context.
  competitorCount: number;
  content: DigestContent;
}

// ─────────────────────────────────────────────────────────────────────────────
// TODO(mathys): REPLACE THIS SCAFFOLD WITH A REAL, ANONYMIZED PRODUCTION DIGEST.
//
// Every string below is a placeholder — the page renders and typechecks, but it
// is obviously not real yet. When you fill it in:
//   • Paste a real weekly digest's `content` (temperature · tldr · sections).
//   • Anonymize ONLY the client org. The competitors named MUST be real public
//     companies (the digest is about real, public moves) — never invent a fact
//     about a real company.
//   • Keep at least one `action_required` section so the sample shows a
//     critical-tier item with its "so what".
//   • `category` must be one of: pricing · product · hiring · reviews · content ·
//     funding (those carry the wayfinding hue; anything else renders neutral).
//   • Optionally include a section whose `competitor` is the client's own product
//     (anonymized) to show self-tracking — it renders like any other section.
// ─────────────────────────────────────────────────────────────────────────────
export const SAMPLE_DIGEST: SampleDigest = {
  weekLabel: "TODO — digest week",
  competitorCount: 0,
  content: {
    temperature: "moderate",
    tldr: [
      "TODO: replace with a real anonymized digest — TL;DR line 1.",
      "TODO: replace with a real anonymized digest — TL;DR line 2.",
    ],
    sections: [
      {
        urgency: "action_required",
        competitor: "[Competitor A]",
        category: "pricing",
        insight: "TODO: real critical signal — what changed.",
        so_what: "TODO: why it matters and the one thing to do about it.",
      },
      {
        urgency: "watch",
        competitor: "[Competitor B]",
        category: "product",
        insight: "TODO: real medium signal — what changed.",
        so_what: "TODO: why it matters.",
      },
      {
        urgency: "fyi",
        competitor: "[Competitor C]",
        category: "hiring",
        insight: "TODO: real low signal — what changed.",
        so_what: "",
      },
    ],
  },
};

// True once the scaffold above has been replaced with real content — lets the
// page and landing excerpt fall back to an honest "being prepared" state instead
// of shipping obvious placeholders if the fixture is still empty.
export const SAMPLE_DIGEST_READY =
  !SAMPLE_DIGEST.weekLabel.startsWith("TODO");
