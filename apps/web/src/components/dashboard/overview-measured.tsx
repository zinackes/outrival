"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon } from "@/components/icons";
import type { HiringMove, PricingMove, ReviewMove } from "@/lib/api";
import { trendsSummaryQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { SectionHead } from "./section-head";

const CURRENCY: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

function money(value: number, currency: string): string {
  const symbol = CURRENCY[currency?.toUpperCase() ?? ""] ?? "";
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return symbol ? `${symbol}${rounded}` : `${rounded} ${currency}`;
}

function periodLabel(billingPeriod: string): string {
  if (billingPeriod === "monthly") return "per month";
  if (billingPeriod === "yearly") return "per year";
  return billingPeriod;
}

/**
 * The one band on the Overview with no model in it: prices, open-role counts and
 * review scores exactly as they were captured.
 *
 * Everything above it is an AI reading of a change. This is the measurement the
 * reading was built on, and it was only reachable from /dashboard/trends. Each
 * cell shows a single competitor's move (the largest in the window), because three
 * facts a user can hold beat a table they will not read on a home page.
 *
 * Best-effort by construction: the summary endpoint degrades to empty lists, and
 * the whole band self-hides rather than showing three dashes.
 */
export function OverviewMeasured({
  range,
  productId,
}: {
  range: { from: Date; to: Date };
  productId?: string;
}) {
  const q = useQuery(trendsSummaryQuery(range, productId));
  const summary = q.data;

  const pricing = pickPricing(summary?.pricing ?? []);
  const hiring = pickHiring(summary?.hiring ?? []);
  const reviews = pickReviews(summary?.reviews ?? []);
  const cells = [pricing, hiring, reviews].filter((c) => c !== null);
  if (cells.length === 0) return null;

  return (
    <section>
      <SectionHead
        title="What the numbers did"
        sub="values we captured, in the picked period"
        divider={false}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/trends">
              Trends <ArrowRightIcon size={16} />
            </Link>
          </Button>
        }
      />
      {/* Hairline dividers via a 1px grid gap over the border colour: the same
          banding the page's other multi-cell strips use, and it survives wrapping. */}
      <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3"
          >
            <span className="text-xs text-muted-foreground">{cell.label}</span>
            <span className="flex flex-wrap items-baseline gap-2 text-sm">
              {cell.from && (
                <>
                  <span className="text-muted-foreground line-through tabular-nums">
                    {cell.from}
                  </span>
                  <span className="text-text-subtle" aria-hidden>
                    &rarr;
                  </span>
                </>
              )}
              <span className="font-semibold tabular-nums">{cell.to}</span>
              <span className="text-xs text-muted-foreground">{cell.unit}</span>
            </span>
            <span className="truncate text-meta text-text-subtle">
              <Link
                href={`/dashboard/competitors/${cell.competitorId}`}
                className="font-medium hover:underline"
              >
                {cell.competitorName}
              </Link>
              {cell.note ? `, ${cell.note}` : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

interface Cell {
  label: string;
  /** Absent when the source only carries a current value (review scores). */
  from: string | null;
  to: string;
  unit: string;
  competitorId: string;
  competitorName: string;
  note: string | null;
}

/** The biggest price change of the window, up or down. */
function pickPricing(moves: PricingMove[]): Cell | null {
  const changed = moves.filter(
    (m): m is PricingMove & { prevPrice: number } => m.prevPrice !== null,
  );
  if (changed.length === 0) return null;
  const top = changed.reduce((best, m) =>
    Math.abs(m.price - m.prevPrice) > Math.abs(best.price - best.prevPrice) ? m : best,
  );
  return {
    label: "Pricing",
    from: money(top.prevPrice, top.currency),
    to: money(top.price, top.currency),
    unit: periodLabel(top.billingPeriod),
    competitorId: top.competitorId,
    competitorName: top.competitorName,
    note: top.planName,
  };
}

/** The largest net move in open roles, in either direction. */
function pickHiring(moves: HiringMove[]): Cell | null {
  const moved = moves.filter((m) => m.net !== 0);
  if (moved.length === 0) return null;
  const top = moved.reduce((best, m) => (Math.abs(m.net) > Math.abs(best.net) ? m : best));
  return {
    label: "Hiring",
    from: String(top.earliest),
    to: String(top.latest),
    unit: "open roles",
    competitorId: top.competitorId,
    competitorName: top.competitorName,
    note: top.net > 0 ? `${top.net} added` : `${Math.abs(top.net)} closed`,
  };
}

/**
 * Highest review count in the window. The summary carries the latest score per
 * source with no previous value, so this cell states a level and never fakes an
 * arrow.
 */
function pickReviews(moves: ReviewMove[]): Cell | null {
  if (moves.length === 0) return null;
  const top = moves.reduce((best, m) => (m.reviewCount > best.reviewCount ? m : best));
  return {
    label: "Reviews",
    from: null,
    to: top.score.toFixed(1),
    unit: "out of 5",
    competitorId: top.competitorId,
    competitorName: top.competitorName,
    note: `${top.reviewCount} reviews on ${top.source}`,
  };
}
