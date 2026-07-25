"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { BattleCardSummary } from "@/lib/api";
import { battleCardsQuery, digestsQuery } from "@/lib/queries";
import { formatDate, shortAge } from "@/lib/format-date";

function cardTitle(c: BattleCardSummary): string {
  return c.productName ? `${c.productName} vs ${c.competitorName}` : c.competitorName;
}

/**
 * The artifacts the workspace has produced, as one line in the page's footer.
 *
 * Battle cards used to hold a full section of their own at the bottom of the
 * Overview, which put a filing cabinet where the page's least-scanned real estate
 * should carry the least news. They are still worth reaching, and their age is the
 * part that matters (a card from three weeks ago argues from stale facts), so each
 * one carries it. The latest weekly brief joins them.
 *
 * Renders nothing when the org has neither.
 */
export function OverviewArtifacts() {
  const cardsQ = useQuery(battleCardsQuery());
  const digestsQ = useQuery(digestsQuery());
  const cards = (cardsQ.data ?? []).slice(0, 3);
  // Weekly only: the daily digest is a delivery mechanism, not a document a user
  // goes back to read.
  const brief = (digestsQ.data ?? []).find((d) => d.period === "weekly") ?? null;

  if (cards.length === 0 && !brief) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-border pt-3 text-dense text-muted-foreground">
      {cards.length > 0 && (
        <>
          <span className="text-xs text-text-subtle">Battle cards</span>
          {cards.map((c, i) => (
            <span key={c.id} className="flex items-center gap-2.5">
              {i > 0 && (
                <span className="text-text-subtle" aria-hidden>
                  ·
                </span>
              )}
              <Link
                href={`/dashboard/competitors/${c.competitorId}/battle-card`}
                className="text-link hover:underline"
              >
                {cardTitle(c)}{" "}
                <span className="font-mono text-text-subtle tabular-nums">
                  {shortAge(c.updatedAt)}
                </span>
              </Link>
            </span>
          ))}
        </>
      )}
      {brief && (
        <Link
          href={`/dashboard/digests/${brief.id}`}
          className="ms-auto inline-flex items-center gap-1 text-link hover:underline"
        >
          Weekly brief, {formatDate(brief.weekStart, { month: "short", day: "numeric" })}
          <ArrowRight size={12} aria-hidden />
        </Link>
      )}
    </div>
  );
}
