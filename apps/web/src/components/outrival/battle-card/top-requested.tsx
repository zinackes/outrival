"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowSquareOutIcon, ListIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { SectionHeading } from "./sections";

/**
 * Top requested, not delivered (Content Intelligence v2 P5) — 100% deterministic,
 * read off the roadmap rows and status events the ingestion wrote.
 *
 * This is the one piece of competitive intelligence a rival publishes about its own
 * gaps: their customers, voting in public, on what the product still does not do.
 * Nothing here is AI-written, so unlike the six generated sections these lines can
 * never claim a request the portal does not carry.
 *
 * Two rules make the numbers honest. Every count travels with the date the portal
 * was READ — a vote count is a number that moves, and a figure quoted without its
 * as-of can be repeated in a call three weeks later as though it were today's. And
 * the delivered line counts transitions we actually WATCHED happen: the first read
 * of a portal is recorded as a baseline and excluded, so a competitor added last
 * week reports what it shipped since, not everything it ever shipped.
 */
export function TopRequestedSection({ competitorId }: { competitorId: string }) {
  const { data } = useQuery({
    queryKey: ["competitor", competitorId, "roadmap"],
    queryFn: () => api.getCompetitorRoadmap(competitorId),
    placeholderData: keepPreviousData,
  });

  if (!data) return null;
  const requests = data.topRequested.slice(0, MAX_REQUESTS);
  // No open requests and nothing observed shipped: this competitor either has no
  // portal or we have not read one yet, and an empty frame states nothing.
  if (requests.length === 0 && data.deliveredLast90d === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-t border-border p-5">
      <SectionHeading icon={ListIcon}>Top requested, not delivered</SectionHeading>

      {requests.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {requests.map((r) => (
            <li key={`${r.title}-${r.votes}`} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-baseline gap-1 rounded-sm text-content leading-relaxed underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {r.title}
                    <ArrowSquareOutIcon size={14} className="shrink-0 self-center" aria-hidden />
                  </a>
                ) : (
                  <span className="text-content leading-relaxed">{r.title}</span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {r.votes} {r.votes === 1 ? "vote" : "votes"}
                </span>
                {/* The portal's own column name, not our vocabulary. */}
                {r.status && <span className="text-xs text-muted-foreground">· {r.status}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data.deliveredLast90d > 0 && (
        <p className="text-content leading-relaxed">
          Shipped{" "}
          <span className="tabular-nums">{data.deliveredLast90d}</span> roadmap{" "}
          {data.deliveredLast90d === 1 ? "item" : "items"} in the last {data.windowDays} days.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        From their public roadmap portal — their votes, their status labels, not AI-written
        {data.asOf ? ` · as of ${data.asOf.slice(0, 10)}` : ""}.
      </p>
    </section>
  );
}

/** Five is a talking point; ten is a backlog nobody reads out loud. */
const MAX_REQUESTS = 5;
