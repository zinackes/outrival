"use client";

import Link from "next/link";
import { ArrowRight, ArrowUp } from "lucide-react";
import { SIGNAL_CATEGORIES } from "@outrival/shared";
import type { Competitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortAge } from "@/lib/format-date";
import { competitorNameColor } from "@/lib/competitor-color";
import { Button } from "@/components/ui/button";
import { SectionHead } from "./section-head";
import { CatText, catLabel } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";

// How many tiles the row carries. Beyond this the roster page is the right surface.
const MAX_TILES = 6;

// Tie-break for the named mix. A week of one signal per category is common, and
// sorting those alphabetically put "content" in front of "pricing", which reads as
// a claim about where the pressure is. The taxonomy's own order runs roughly by
// decision-relevance, so an even week leads with the category worth naming.
const CAT_PRIORITY = new Map<string, number>(SIGNAL_CATEGORIES.map((c, i) => [c, i]));

function catRank(category: string): number {
  return CAT_PRIORITY.get(category) ?? SIGNAL_CATEGORIES.length;
}

interface Tile {
  competitor: Competitor;
  count: number;
  delta: number;
  /** Categories the week's signals landed in, most frequent first. */
  mix: [string, number][];
  lastSignalAt: string | null;
}

/**
 * Who moved, and what they moved on.
 *
 * The Overview never named a competitor: it counted signals and listed findings,
 * so "which of the six is applying pressure" needed a second page. These tiles
 * carry the roster's own numbers (the list endpoint already ships a 7 day count,
 * the 7 before it, the category mix and the last signal per competitor), so the
 * band costs no extra request.
 *
 * The mix started as a stacked colour bar and lost: a 190px tile has no room for
 * the legend a colour-only encoding needs, and the user could not tell what the
 * segments meant. The categories are named in their own hue instead, lead category
 * first, so the word and the colour teach each other.
 */
export function OverviewMovers({ competitors }: { competitors: Competitor[] }) {
  const tiles = buildTiles(competitors);
  if (tiles.length === 0) return null;

  return (
    <section>
      <SectionHead
        title="Who moved"
        // The roster's aggregates are fixed 7 day windows server-side, so this band
        // says its own period instead of silently inheriting the range picker.
        sub="this week against the week before"
        divider={false}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/competitors">
              All competitors <ArrowRight size={11} />
            </Link>
          </Button>
        }
      />
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <MoverTile key={t.competitor.id} tile={t} />
        ))}
      </div>
    </section>
  );
}

/**
 * Movers first, ranked by how much they accelerated, then by volume. Any room left
 * goes to the quietest competitors: a company that has gone silent for three weeks
 * is a finding, and the old page rendered it as an absence.
 */
function buildTiles(competitors: Competitor[]): Tile[] {
  const all: Tile[] = competitors
    .filter((c) => !c.monitoringPaused)
    .map((c) => {
      const stats = c.stats;
      const mix = Object.entries(stats?.categoryCounts ?? {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || catRank(a[0]) - catRank(b[0]));
      return {
        competitor: c,
        count: stats?.signals7d ?? 0,
        delta: (stats?.signals7d ?? 0) - (stats?.signalsPrev ?? 0),
        mix,
        lastSignalAt: stats?.lastSignalAt ?? null,
      };
    });

  const movers = all
    .filter((t) => t.count > 0)
    .sort((a, b) => b.delta - a.delta || b.count - a.count);
  const quiet = all
    .filter((t) => t.count === 0)
    .sort((a, b) => {
      // Longest silence first; never-heard-from ranks above merely stale.
      const ta = a.lastSignalAt ? new Date(a.lastSignalAt).getTime() : 0;
      const tb = b.lastSignalAt ? new Date(b.lastSignalAt).getTime() : 0;
      return ta - tb;
    });

  return [...movers, ...quiet].slice(0, MAX_TILES);
}

function MoverTile({ tile }: { tile: Tile }) {
  const { competitor: c, count, delta, mix, lastSignalAt } = tile;
  const quiet = count === 0;

  return (
    <Link
      href={`/dashboard/competitors/${c.id}`}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border border-border px-3 py-2.5 transition-colors",
        quiet ? "bg-background-2" : "bg-card",
        "hover:border-border-strong hover:bg-surface-2",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <CompAvatar name={c.name} url={c.url} size={20} />
        <span
          className={cn(
            "truncate text-xs font-semibold",
            quiet && "text-muted-foreground",
          )}
          style={quiet ? undefined : competitorNameColor(c.color)}
        >
          {c.name}
        </span>
      </span>

      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-mono text-xl leading-none tracking-tight tabular-nums",
            quiet ? "font-medium text-muted-foreground" : "font-semibold",
          )}
        >
          {count}
        </span>
        {quiet ? (
          <span className="text-meta text-muted-foreground">
            {lastSignalAt ? (
              <>
                quiet <span className="font-mono tabular-nums">{shortAge(lastSignalAt)}</span>
              </>
            ) : (
              "never moved"
            )}
          </span>
        ) : delta > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-meta font-medium">
            <ArrowUp size={11} strokeWidth={2.25} aria-hidden />
            <span className="font-mono tabular-nums">{delta}</span>
          </span>
        ) : (
          <span className="text-meta text-muted-foreground">
            {delta === 0 ? "flat" : <span className="font-mono tabular-nums">{delta}</span>}
          </span>
        )}
      </span>

      {quiet ? (
        // Silence has to be told apart from a broken pipe, so the quiet tile shows
        // when we last looked rather than what it found.
        <span className="truncate text-meta text-muted-foreground">
          {c.freshness?.status === "failed" ? (
            "last scan failed"
          ) : c.freshness?.lastScrapedAt ? (
            <>
              checked{" "}
              <span className="font-mono tabular-nums">
                {shortAge(c.freshness.lastScrapedAt)}
              </span>{" "}
              ago
            </>
          ) : (
            "first scan pending"
          )}
        </span>
      ) : (
        <>
          <span className="truncate text-meta text-muted-foreground">
            {/* Lowercase on purpose: this is a sentence fragment ("on pricing,
                hiring"). CAT_LABEL's own proper nouns (M&A, Security) keep their
                case because nothing is transformed. */}
            <span className="text-text-subtle">on</span>{" "}
            <CatText category={mix[0]![0]} capitalized={false} />
            {mix[0]![1] > 1 && <span className="font-mono tabular-nums"> {mix[0]![1]}</span>}
            {mix[1] && <>, {catLabel(mix[1][0])}</>}
            {mix.length > 2 && (
              <span className="font-mono text-text-subtle tabular-nums">
                {" "}
                +{mix.length - 2}
              </span>
            )}
          </span>
          <span className="truncate text-meta text-text-subtle">
            {lastSignalAt ? (
              <>
                last move <span className="font-mono tabular-nums">{shortAge(lastSignalAt)}</span>{" "}
                ago
              </>
            ) : (
              "no signal yet"
            )}
          </span>
        </>
      )}
    </Link>
  );
}
