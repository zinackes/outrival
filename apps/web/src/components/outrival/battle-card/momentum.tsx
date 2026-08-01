"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { PulseIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { SectionHeading } from "./sections";

/**
 * Momentum (Hiring Intelligence v2 P5) — what a competitor's board has been doing,
 * as lines that are COMPUTED rather than written.
 *
 * Every line is arithmetic over rows P1-P4 wrote: a four-week open-role count
 * against the four before it, the countries whose first appearance is inside the
 * window, the executive titles read verbatim off the board, and the pay posture.
 * No model touches this section, which is what lets it state numbers next to six
 * sections that can only state claims.
 *
 * The same pure function produced the lines the card's generation was grounded on,
 * so if the model refers to their hiring elsewhere on the card, it is referring to
 * the sentences printed here. Absent facts produce no line and an empty set
 * produces no section, the same contract Packaging has.
 */
export function MomentumSection({ competitorId }: { competitorId: string }) {
  const momentumQ = useQuery({
    queryKey: ["competitor", competitorId, "hiringMomentum"],
    queryFn: () => api.getCompetitorHiringMomentum(competitorId),
    placeholderData: keepPreviousData,
  });

  const lines = momentumQ.data?.momentum ?? [];
  if (lines.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-t border-border p-5">
      <SectionHeading icon={PulseIcon}>Momentum</SectionHeading>
      <ul className="flex flex-col gap-2.5">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-content leading-relaxed">
            <span className="mt-px shrink-0 text-muted-foreground" aria-hidden>
              •
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Counted from their own job board, not AI-written.
      </p>
    </section>
  );
}
