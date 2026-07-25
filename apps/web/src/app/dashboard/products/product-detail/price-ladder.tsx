"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { productPricingPositionQuery } from "@/lib/queries";
import { competitorColorVars, COMP_ACCENT } from "@/lib/competitor-color";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const money = (price: number, currency: string) =>
  currency === "USD" ? `$${price}` : `${price} ${currency}`;

/**
 * Every tracked competitor's entry price, ours among them.
 *
 * This is the one comparison only this page can draw, so it leads the Pricing
 * tab: the same number, read the same way on both sides (cheapest paid tier of
 * the latest detected batch, user edits winning), which is the only way the gap
 * describes the market rather than our method. Rivals who publish nothing are
 * counted, not hidden: "four of nine quote only" is itself the finding.
 */
export function PriceLadder({ productId }: { productId: string }) {
  const q = useQuery(productPricingPositionQuery(productId));
  const data = q.data;

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (!data || (data.mine === null && data.rivals.every((r) => !r.entry))) {
    return (
      <p className="text-sm text-muted-foreground">
        No published price to compare yet, on your side or theirs. Prices appear here as
        soon as a pricing page is read.
      </p>
    );
  }

  const rows = [
    ...(data.mine
      ? [{ key: "self", name: "Your product", entry: data.mine, self: true, url: null, color: null }]
      : []),
    ...data.rivals
      .filter((r) => r.entry && r.comparable)
      .map((r) => ({
        key: r.competitorId,
        name: r.name,
        entry: r.entry!,
        self: false,
        url: r.url,
        color: r.color,
      })),
  ].sort((a, b) => a.entry.price - b.entry.price);

  const max = Math.max(...rows.map((r) => r.entry.price), 1);
  const gap =
    data.mine && data.median
      ? Math.round(((data.mine.price - data.median) / data.median) * 100)
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_4.5rem] items-center gap-3">
            <span className="flex min-w-0 items-center gap-2 text-dense">
              {r.self ? (
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
              ) : (
                <CompAvatar name={r.name} url={r.url} size={18} />
              )}
              <span
                className={cn("truncate", r.self && "font-semibold")}
                style={
                  !r.self && r.color
                    ? { ...competitorColorVars(r.color), color: COMP_ACCENT }
                    : undefined
                }
              >
                {r.name}
              </span>
            </span>
            <span className="h-2 overflow-hidden rounded-sm bg-surface-3">
              <span
                className={cn("block h-full rounded-sm", r.self ? "bg-primary" : "bg-muted-foreground/35")}
                style={{ width: `${Math.max(4, (r.entry.price / max) * 100)}%` }}
              />
            </span>
            <span
              className={cn(
                "text-right font-mono text-dense tabular-nums",
                r.self ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {money(r.entry.price, r.entry.currency)}
            </span>
          </div>
        ))}
      </div>

      <p className="m-0 text-sm text-muted-foreground">
        {data.median !== null && (
          <>
            The middle of the {rows.filter((r) => !r.self).length} published{" "}
            {data.billingPeriod ?? "monthly"} entry prices is{" "}
            <span className="font-mono tabular-nums text-foreground">
              {money(data.median, data.currency ?? "USD")}
            </span>
            .{" "}
          </>
        )}
        {gap !== null &&
          (gap === 0 ? (
            <>You sit on it.</>
          ) : (
            <>
              You are{" "}
              <span className="font-medium text-foreground">
                {Math.abs(gap)}% {gap < 0 ? "under" : "over"}
              </span>{" "}
              it.
            </>
          ))}
        {data.quoteOnly > 0 && (
          <>
            {" "}
            {data.quoteOnly} competitor{data.quoteOnly > 1 ? "s publish" : " publishes"} no
            price at all.
          </>
        )}
      </p>

      <Link
        href="/dashboard/compare"
        className="text-dense text-link underline-offset-2 hover:underline"
      >
        Compare plan by plan
      </Link>
    </div>
  );
}
