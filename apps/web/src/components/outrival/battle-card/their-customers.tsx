"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { UsersIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { SectionHeading } from "./sections";

/**
 * Their customers (Content Intelligence v2 P3) — 100% deterministic, read off the
 * case studies and the customer registry the ingest job wrote.
 *
 * Nothing here is AI-written, so unlike the six generated sections these lines can
 * never name a customer the competitor has not published. Three readings, each of
 * which answers a question a sales call actually asks: which markets they keep
 * proving themselves in, who they have won lately, and who has been on their wall
 * long enough to be a reference.
 *
 * Every count is stated. A vertical distribution over three stories is a fact about
 * three stories, and a section that hid its n would read like a survey.
 */
export function TheirCustomersSection({
  competitorId,
  competitorName,
}: {
  competitorId: string;
  competitorName: string;
}) {
  const { data } = useQuery({
    queryKey: ["competitor", competitorId, "customers"],
    queryFn: () => api.getCompetitorCustomers(competitorId),
    placeholderData: keepPreviousData,
  });

  if (!data) return null;
  const lines = deriveLines(data, competitorName);
  if (lines.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-t border-border p-5">
      <SectionHeading icon={UsersIcon}>Their customers</SectionHeading>
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
        Read from their own case studies and customers page — not AI-written.
      </p>
    </section>
  );
}

type Customers = Awaited<ReturnType<typeof api.getCompetitorCustomers>>;

const MAX_LINES = 5;
const MAX_NAMES = 4;

function list(names: string[], cap = MAX_NAMES): string {
  const shown = names.slice(0, cap);
  const rest = names.length - shown.length;
  return shown.join(", ") + (rest > 0 ? ` (+${rest} more)` : "");
}

export function deriveLines(data: Customers, competitorName: string): string[] {
  const lines: string[] = [];

  // Where they keep proving themselves. Only stated when more than one story sits
  // behind the leader — one case study in fintech is a case study, not a vertical.
  const top = data.verticals[0];
  if (top && top.count > 1) {
    const others = data.verticals.slice(1, 3).filter((v) => v.count > 1);
    const spread = others.length
      ? `, then ${others.map((v) => `${v.label} (${v.count})`).join(" and ")}`
      : "";
    lines.push(
      `Most of their published stories are ${top.label} (${top.count} of ${data.storiesTotal})${spread}.`,
    );
  }

  if (data.wins.length > 0) {
    lines.push(
      `New on their customers page in the last ${data.windowDays} days: ${list(
        data.wins.map((w) => w.name),
      )}.`,
    );
  }

  // The names that were already there. Skipped when they ARE the recent wins —
  // a competitor we started tracking last month has no "long-standing" reference,
  // it has a wall we have only just read.
  const winNames = new Set(data.wins.map((w) => w.name));
  const established = data.marquee.filter((m) => !winNames.has(m.name));
  if (established.length > 0) {
    lines.push(`Already on their wall when we started watching: ${list(established.map((m) => m.name))}.`);
  }

  if (data.customersTotal > 0) {
    lines.push(
      `${competitorName} names ${data.customersTotal} customer${data.customersTotal === 1 ? "" : "s"} in public` +
        (data.storiesTotal > 0
          ? `, with ${data.storiesTotal} written-up ${data.storiesTotal === 1 ? "story" : "stories"}.`
          : "."),
    );
  }

  return lines.slice(0, MAX_LINES);
}
