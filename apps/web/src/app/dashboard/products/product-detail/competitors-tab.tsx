"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import type { ProductLinkedCompetitor } from "@/lib/api";
import { competitorNameColor } from "@/lib/competitor-color";
import { shortAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { CatText } from "@/components/dashboard/cat-pill";
import { SeverityGauge } from "@/components/outrival/severity-scale";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Past this, a competitor's last move stops being news and the row says so by
// dropping the headline to muted. Same window as the roster.
const QUIET_AFTER_DAYS = 7;

/**
 * The competitors this product is measured against, each leading with what it
 * just did.
 *
 * A name, an overlap score and a badge answer "who do we watch", which is the
 * question the user already knew the answer to when they opened the tab. So the
 * row carries the competitor's latest signal in its own words, under the same
 * severity gauge the roster stands in its gutter, and the shared/specific badge
 * sits inline after the name rather than being the row's point.
 */
export function ProductCompetitors({
  productId,
  competitors,
}: {
  productId: string;
  competitors: ProductLinkedCompetitor[];
}) {
  if (competitors.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center">
        <p className="text-sm font-semibold">No competitors on this product yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Link competitors to it and its signals, battle cards and price comparison
          start filling in. Discovery suggests them from this product&apos;s positioning.
        </p>
        <Button asChild size="sm">
          <Link href="/dashboard/discovery">
            <Search size={14} />
            Find competitors
          </Link>
        </Button>
      </Card>
    );
  }

  // Whoever moved most recently leads; competitors with no signal at all sit last,
  // since "nothing yet" is the least useful row to read first.
  const sorted = [...competitors].sort((a, b) => {
    const at = a.latestMove ? new Date(a.latestMove.createdAt).getTime() : 0;
    const bt = b.latestMove ? new Date(b.latestMove.createdAt).getTime() : 0;
    return bt - at;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-2.5">
        <div className="min-w-0">
          <h3 className="text-content font-semibold leading-tight tracking-tight">
            What they last did
          </h3>
          <p className="mt-0.5 text-dense text-muted-foreground">
            Shared competitors are watched for every product. Specific ones only count
            here, and only they tag this product on a signal.
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href="/dashboard/discovery">
            <Search size={14} />
            Find more
          </Link>
        </Button>
      </div>

      <div>
        {sorted.map((c) => (
          <CompetitorRow key={c.competitorId} competitor={c} />
        ))}
      </div>

      <Button asChild size="sm" variant="ghost" className="self-start">
        <Link href={`/dashboard/signals?product=${encodeURIComponent(productId)}`}>
          See every signal on this product
        </Link>
      </Button>
    </div>
  );
}

function CompetitorRow({ competitor: c }: { competitor: ProductLinkedCompetitor }) {
  const move = c.latestMove;
  const stale = move
    ? (Date.now() - new Date(move.createdAt).getTime()) / 86_400_000 > QUIET_AFTER_DAYS
    : false;

  return (
    <div className="group relative grid grid-cols-[0.625rem_minmax(0,1.15fr)_minmax(0,1.7fr)] items-center gap-x-3.5 rounded-md border-b border-border px-2 py-2.5 transition-colors hover:bg-surface-2 focus-within:bg-surface-2">
      <SeverityGauge severity={move && !stale ? move.severity : null} />

      <div className="flex min-w-0 items-center gap-2.5">
        <CompAvatar name={c.name} url={c.url} size={26} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={`/dashboard/competitors/${c.competitorId}`}
              // Stretched link: the row navigates without nesting anything
              // interactive inside an <a>.
              className="min-w-0 truncate rounded-sm text-dense font-semibold outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50"
              style={competitorNameColor(c.color)}
            >
              {c.name}
            </Link>
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-meta font-medium",
                c.isSpecific
                  ? "border-border-strong text-foreground"
                  : "border-border bg-surface-2 text-muted-foreground",
              )}
            >
              {c.isSpecific ? "Specific" : "Shared"}
            </span>
          </div>
          {c.relevanceScore != null && (
            <span className="font-mono text-meta tabular-nums text-muted-foreground">
              {c.relevanceScore} overlap
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        {move ? (
          <>
            <span
              className={cn(
                "truncate text-dense leading-snug",
                stale ? "text-muted-foreground" : "font-medium text-foreground",
              )}
            >
              {move.insight}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
              <CatText category={move.category} />
              <span aria-hidden className="text-border-strong">
                ·
              </span>
              <span className="font-mono tabular-nums">{shortAge(move.createdAt)}</span>
            </span>
          </>
        ) : (
          <span className="truncate text-dense text-muted-foreground">
            Nothing detected yet.
          </span>
        )}
      </div>
    </div>
  );
}
