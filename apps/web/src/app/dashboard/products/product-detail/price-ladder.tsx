"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { productPricingPositionQuery } from "@/lib/queries";
import { competitorColorVars, COMP_ACCENT } from "@/lib/competitor-color";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const money = (price: number, currency: string) => {
  // The axis is monthly, so an annual plan read ÷12 arrives with decimals. Round
  // to the unit, as the compare lens does, so one table reads the same in both.
  const amount = Math.round(price);
  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
};

/**
 * Every tracked competitor's entry price, ours among them.
 *
 * This is the one comparison only this page can draw, so it leads the Pricing
 * tab: the same number, read the same way on both sides (cheapest paid tier of
 * the latest detected batch, user edits winning), on the same monthly axis as the
 * compare lens, which is the only way the gap describes the market rather than
 * our method. What cannot reach that axis is named for what it is: a rival that
 * publishes nothing reads as quote-only, one that publishes on another basis says
 * so, and neither is silently counted as the other.
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
    ...(data.mine && data.mineMonthly !== null
      ? [
          {
            key: "self",
            name: "Your product",
            monthly: data.mineMonthly,
            period: data.mine.billingPeriod,
            self: true,
            url: null,
            color: null,
          },
        ]
      : []),
    ...data.rivals
      .filter((r) => r.comparable && r.monthly !== null)
      .map((r) => ({
        key: r.competitorId,
        name: r.name,
        monthly: r.monthly!,
        period: r.entry!.billingPeriod,
        self: false,
        url: r.url,
        color: r.color,
      })),
  ].sort((a, b) => a.monthly - b.monthly);

  const max = Math.max(...rows.map((r) => r.monthly), 1);
  const gap =
    data.mineMonthly !== null && data.median
      ? Math.round(((data.mineMonthly - data.median) / data.median) * 100)
      : null;
  const currency = data.currency ?? "USD";
  // What the axis could not hold, said in the competitor's own terms rather than
  // rolled into one number the compare page would contradict. Only two things put
  // a published price off a monthly axis: another currency, or a one-time price.
  const offAxisReasons = [
    ...new Set(
      data.rivals
        .filter((r) => r.entry && !r.comparable)
        .map((r) => (r.entry!.currency !== currency ? r.entry!.currency : "one-time")),
    ),
  ];

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No price here can be read on a monthly scale yet
        {offAxisReasons.length > 0 ? `: everything published is ${offAxisReasons.join(", ")}` : ""}.
        Prices appear here as soon as a comparable pricing page is read.
      </p>
    );
  }

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
                style={{ width: `${Math.max(4, (r.monthly / max) * 100)}%` }}
              />
            </span>
            <span
              className={cn(
                "text-right font-mono text-dense tabular-nums",
                r.self ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {/* An annual plan is read on the monthly axis divided by 12, so the
                  number is ours, not one the competitor published. Say so. */}
              {r.period === "monthly" ? "" : "≈"}
              {money(r.monthly, currency)}
            </span>
          </div>
        ))}
      </div>

      <p className="m-0 text-sm text-muted-foreground">
        {data.median !== null && (
          <>
            The middle of the {rows.filter((r) => !r.self).length} published monthly entry
            prices is{" "}
            <span className="font-mono tabular-nums text-foreground">
              {money(data.median, currency)}
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
        {data.mine && data.mineMonthly === null && (
          <> Your own entry plan is a one-time price, so it does not sit on this scale.</>
        )}
        {data.quoteOnly > 0 && (
          <>
            {" "}
            {data.quoteOnly} competitor{data.quoteOnly > 1 ? "s publish" : " publishes"} no
            price at all.
          </>
        )}
        {data.offAxis > 0 && (
          <>
            {" "}
            {data.offAxis} competitor{data.offAxis > 1 ? "s publish" : " publishes"} on another
            basis ({offAxisReasons.join(", ")}), so they are not on this scale.
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
