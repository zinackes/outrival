"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { format } from "date-fns";
import { CrosshairIcon } from "@/components/icons";
import { api, type PositioningFacts } from "@/lib/api";
import { SectionHeading } from "./sections";

/**
 * Positioning (Positioning Intelligence v2 P4) — 100% deterministic, read off the
 * messaging timeline, the claim log, the market map and the ICP registry.
 *
 * Nothing here is AI-written, so unlike the six generated sections these lines can
 * never put words in a competitor's mouth: the headline and the claims are quoted
 * as their page printed them, and the rivals and segments are slugs from their own
 * sitemap. That is what lets a seller be shown the source when challenged.
 *
 * The same facts also travel into the card's grounded context, so the generated
 * sections may REFER to their positioning — but this section is rendered from the
 * facts, never from the model's account of them.
 */
export function PositioningSection({
  competitorId,
  competitorName,
}: {
  competitorId: string;
  competitorName: string;
}) {
  const { data } = useQuery({
    queryKey: ["competitor", competitorId, "positioningFacts"],
    queryFn: () => api.getCompetitorPositioningFacts(competitorId),
    placeholderData: keepPreviousData,
  });

  if (!data) return null;
  const lines = deriveLines(data, competitorName);
  if (lines.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-t border-border p-5">
      <SectionHeading icon={CrosshairIcon}>Positioning</SectionHeading>
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
        Read from their own pages — not AI-written.
      </p>
    </section>
  );
}

const MAX_NAMES = 3;

function list(names: string[], cap = MAX_NAMES): string {
  const shown = names.slice(0, cap);
  const rest = names.length - shown.length;
  if (shown.length === 0) return "";
  const joined =
    shown.length === 1
      ? shown[0]!
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} (+${rest} more)` : joined;
}

const day = (iso: string) => format(new Date(iso), "d MMMM yyyy");

/**
 * One line per fact, in the order a competitive call uses them: what they say,
 * what they claim, who they fight, who they sell to, who names them.
 *
 * A missing fact drops its line — it never prints "unknown". A data gap rendered
 * as filler is what taught the generated sections to report OUR blind spots as
 * competitor weaknesses (2026-07-10 audit), and a deterministic section has even
 * less excuse for it.
 */
export function deriveLines(facts: PositioningFacts, competitorName: string): string[] {
  const lines: string[] = [];

  if (facts.tagline) {
    lines.push(
      `Since ${day(facts.tagline.capturedAt)} their homepage says “${facts.tagline.h1}”.` +
        (facts.tagline.previousH1 ? ` It replaced “${facts.tagline.previousH1}”.` : "") +
        (facts.tagline.primaryCta
          ? ` Their primary call to action is “${facts.tagline.primaryCta}”.`
          : ""),
    );
  }

  if (facts.claims.length > 0) {
    lines.push(
      `They claim ${facts.claims.map((c) => `“${c.rawText}”`).join(", ")} — read ${
        facts.claims.length === 1 ? "" : "most recently "
      }${day(facts.claims[0]!.observedAt)}.`,
    );
  }

  if (facts.comparison) {
    const { named, recent, total, windowDays } = facts.comparison;
    // The count carries the list: three names out of thirty is a sample, three out
    // of three is their whole map, and the sentence must not read the same way.
    const head =
      named.length > 0
        ? `They publish comparison pages against ${list(named)}.`
        : `They publish comparison pages against ${total} ${total === 1 ? "rival" : "rivals"}.`;
    const tail =
      recent.length > 0
        ? ` ${total} named in total, ${recent.length} in the last ${windowDays} days.`
        : ` ${total} named in total, none in the last ${windowDays} days.`;
    lines.push(head + tail);
  }

  if (facts.icp) {
    const parts: string[] = [];
    if (facts.icp.personas.length > 0) {
      parts.push(`They publish pages for ${list(facts.icp.personas, 4)}`);
    }
    if (facts.icp.industries.length > 0) {
      // "Proven" and "declared" are different claims and are said differently: one
      // has case studies behind it, the other is a page and an intention.
      const verticals = list(facts.icp.industries, 4);
      parts.push(
        parts.length > 0
          ? facts.icp.industriesProven
            ? `and have case studies in ${verticals}`
            : `and publish industry pages for ${verticals}`
          : facts.icp.industriesProven
            ? `They have case studies in ${verticals}`
            : `They publish industry pages for ${verticals}`,
      );
    }
    if (parts.length > 0) lines.push(`${parts.join(" ")}.`);
  }

  if (facts.namedByCount > 0) {
    lines.push(
      `${facts.namedByCount} ${
        facts.namedByCount === 1 ? "competitor you track names" : "competitors you track name"
      } ${competitorName} in public.`,
    );
  }

  return lines;
}
