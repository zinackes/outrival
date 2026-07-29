"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@/components/icons";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { competitorNameColor } from "@/lib/competitor-color";

/**
 * The page head: the matchup IS the title. "Battle card" over "How you win against X"
 * repeated what the breadcrumb already said and told a reader nothing; the two product
 * names, each with its own favicon and the competitor in its identity colour, say who
 * this page is about in one glance. The word survives one step down on the meta line,
 * where it does wayfinding instead of decoration.
 *
 * Names wrap, they never truncate: cutting a product name with an ellipsis is not an
 * option on the page that exists to compare it.
 */
export function BattleCardHead({
  competitorId,
  competitor,
  product,
  meta,
  actions,
}: {
  competitorId: string;
  competitor: { name: string; url?: string | null; color?: string | null } | null;
  product: { name: string; url?: string | null } | null;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <Link
          href={`/dashboard/competitors/${competitorId}`}
          aria-label="Back to competitor"
          className="mt-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <ArrowLeftIcon size={16} />
        </Link>

        <div className="min-w-0">
          {/* One h1, read as a sentence. The visual row below is the same words laid
              out with each side's mark, and is hidden from assistive tech so the
              matchup is not announced twice. CompAvatar renders a div, which cannot
              legally sit inside a heading anyway. */}
          <h1 className="sr-only">
            {product ? `${product.name} vs ${competitorName(competitor)}` : competitorName(competitor)}{" "}
            battle card
          </h1>
          <div
            aria-hidden
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-title font-semibold leading-tight tracking-tight md:text-title-lg"
          >
            {product && (
              <>
                <span className="flex min-w-0 items-center gap-2.5">
                  <CompAvatar name={product.name} url={product.url} size={32} />
                  <span className="min-w-0">{product.name}</span>
                </span>
                {/* Deliberately small: an 11px operator between two 34px names.
                    The size gap does the work a badge or a divider would do louder. */}
                <span className="text-meta font-normal tracking-wide text-muted-foreground">
                  vs
                </span>
              </>
            )}
            <span className="flex min-w-0 items-center gap-2.5">
              {competitor && (
                <CompAvatar name={competitor.name} url={competitor.url} size={32} />
              )}
              <span className="min-w-0" style={competitorNameColor(competitor?.color)}>
                {competitorName(competitor)}
              </span>
            </span>
          </div>

          {meta && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-dense text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function competitorName(competitor: { name: string } | null): string {
  return competitor?.name ?? "Battle card";
}

/** The dot separator the meta line uses between fields. */
export function MetaDot() {
  return (
    <span className="text-muted-foreground/40" aria-hidden>
      ·
    </span>
  );
}
