"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "@/components/icons";
import { BattleCardTab } from "@/components/outrival/battle-card-tab";
import { competitorDetailQuery } from "@/lib/queries";
import { competitorNameColor } from "@/lib/competitor-color";

/**
 * Battle cards, on their own page rather than a tab. A card is an artefact you go
 * and produce (and export as a PDF), not a lens you flip between — and its daily
 * generation cap is enforced where it always was, inside BattleCardTab at generate
 * time, so moving the surface changes no entitlement.
 */
export function BattleCardPageView({ id }: { id: string }) {
  const { data } = useQuery(competitorDetailQuery(id));
  const competitor = data?.competitor ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 min-w-0">
        <Link
          href={`/dashboard/competitors/${id}`}
          aria-label="Back to competitor"
          className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon size={16} />
        </Link>
        <div className="min-w-0">
          <h1 className="m-0 text-title font-bold leading-tight tracking-tight">Battle card</h1>
          {competitor && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              How you win against{" "}
              <span style={competitorNameColor(competitor.color)}>{competitor.name}</span>
            </p>
          )}
        </div>
      </div>

      <BattleCardTab competitorId={id} />
    </div>
  );
}
