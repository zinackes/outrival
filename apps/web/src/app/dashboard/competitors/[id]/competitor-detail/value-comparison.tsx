"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  compareEntitlements,
  compareSummaryLines,
  formatPrice,
  type EntitlementRow,
  type FeatureComparisonRow,
  type FeatureSide,
} from "@outrival/shared";
import { api, type MyProductPricingTier, type PricingHistoryPoint } from "@/lib/api";
import { useFx } from "@/lib/fx";
import { planMonthlyMap } from "@/lib/plan-monthly";
import { productsListQuery } from "@/lib/queries";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { TabSection } from "@/components/outrival/tab-shell";
import { cn } from "@/lib/utils";

/**
 * Value comparison (OUT-68) — the same two pricing pages read feature by feature
 * instead of rung by rung. The ladder above ranks by price and admits in its own
 * footnote that the rungs do not line up on features; this is the half it cannot
 * answer: for each feature, the cheapest plan on each side that lists it.
 *
 * Plans are never paired. Deriving "their tier 2 = your tier 2" from two
 * unrelated pricing pages is the equivalence the data does not support, so each
 * side answers independently and the reader compares the two answers.
 *
 * No AI: every cell is a stored plan_entitlements row, matched across companies
 * only through the canonical feature catalog.
 */
export function ValueComparison({
  competitorId,
  competitorName,
  ours,
  theirs,
}: {
  competitorId: string;
  competitorName: string;
  ours: MyProductPricingTier[];
  theirs: PricingHistoryPoint[];
}) {
  const fx = useFx();
  const productScope = useProductScope() ?? undefined;

  // Our own matrix lives on the product's self-competitor, which is scraped like
  // any other — hence no dedicated endpoint here.
  const productsQ = useQuery({ ...productsListQuery(), retry: false });
  const selfCompetitorId = useMemo(() => {
    const list = productsQ.data ?? [];
    const active = productScope ? list.find((p) => p.id === productScope) : list.find((p) => p.isPrimary);
    return active?.selfCompetitorId ?? null;
  }, [productsQ.data, productScope]);

  // Same key as PackagingMatrix, so this is a cache hit rather than a second fetch.
  const theirEntitlements = useQuery({
    queryKey: ["competitor", competitorId, "entitlements"],
    queryFn: () => api.getCompetitorEntitlements(competitorId),
    placeholderData: keepPreviousData,
  });
  const ourEntitlements = useQuery({
    queryKey: ["competitor", selfCompetitorId ?? "none", "entitlements"],
    queryFn: () => api.getCompetitorEntitlements(selfCompetitorId ?? ""),
    enabled: selfCompetitorId != null,
    placeholderData: keepPreviousData,
  });

  const displayCurrency = ours.find((t) => t.price != null)?.currency ?? theirs[0]?.currency ?? "USD";
  const rates = fx?.rates ?? null;
  const approximate =
    ours.some((t) => t.price != null && t.currency !== displayCurrency) ||
    theirs.some((t) => t.price != null && t.currency !== displayCurrency);

  const rows = useMemo(() => {
    const ourCells = ourEntitlements.data?.current ?? [];
    const theirCells = theirEntitlements.data?.current ?? [];
    if (ourCells.length === 0 || theirCells.length === 0) return [];
    return compareEntitlements(
      { cells: ourCells as EntitlementRow[], planMonthly: planMonthlyMap(ours, displayCurrency, rates) },
      { cells: theirCells as EntitlementRow[], planMonthly: planMonthlyMap(theirs, displayCurrency, rates) },
    );
  }, [ourEntitlements.data, theirEntitlements.data, ours, theirs, displayCurrency, rates]);

  const lines = useMemo(
    () => compareSummaryLines(rows, competitorName, { currency: displayCurrency }),
    [rows, competitorName, displayCurrency],
  );

  // Nothing captured on their side: the packaging matrix is empty too, and an
  // empty grid under a heading would read as "they gate nothing".
  if ((theirEntitlements.data?.current.length ?? 0) === 0) return null;

  // Their side stands, ours does not. Say which half is missing and where it
  // comes from, because that is the actionable half.
  if ((ourEntitlements.data?.current.length ?? 0) === 0) {
    return (
      <TabSection title="Value comparison">
        <p className="text-dense text-muted-foreground">
          {competitorName}&rsquo;s pricing page lists what each plan includes, yours has no
          captured feature list yet. Add a pricing page to your product in{" "}
          <Link href="/dashboard/products" className="text-primary hover:underline">
            Products
          </Link>{" "}
          to compare what a price buys, not only what it costs.
        </p>
      </TabSection>
    );
  }

  if (rows.length === 0) return null;

  return (
    <TabSection title="Value comparison">
      {lines.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1">
          {lines.map((line) => (
            <li key={line} className="text-dense text-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4 text-left text-xs font-normal text-muted-foreground">
                Feature
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-foreground">
                You
              </th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-foreground">
                {competitorName}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slug} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="max-w-56 truncate py-2 pr-4 text-left text-dense font-normal text-foreground"
                  title={row.label}
                >
                  {row.label}
                </th>
                <SideCell side={row.ours} row={row} mine currency={displayCurrency} />
                <SideCell side={row.theirs} row={row} currency={displayCurrency} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Each side shows its cheapest plan that lists the feature. &ldquo;Not listed&rdquo; means
        the pricing page does not mention it, which is not the same as unavailable.
        {approximate ? " Prices converted at today's rates (≈)." : ""}
      </p>
    </TabSection>
  );
}

function SideCell({
  side,
  row,
  mine = false,
  currency,
}: {
  side: FeatureSide | null;
  row: FeatureComparisonRow;
  mine?: boolean;
  currency: string;
}) {
  if (!side) {
    return (
      <td className="px-3 py-2 align-baseline text-dense text-muted-foreground">Not listed</td>
    );
  }
  // The cheaper side leads; the other stays muted. No colour: "cheaper" is not
  // good or bad on its own, and a green cell would decide that for the reader.
  const leads =
    row.priceVerdict === (mine ? "cheaper" : "pricier") ||
    row.limitVerdict === (mine ? "higher" : "lower");
  return (
    <td className="px-3 py-2 align-baseline tabular-nums">
      <div className="flex flex-col">
        <span className={cn("text-dense", leads ? "font-medium text-foreground" : "text-foreground")}>
          {side.planName}
        </span>
        <span className={cn("text-xs", leads ? "text-foreground" : "text-muted-foreground")}>
          {side.monthly == null ? "Quote-based" : `${formatPrice(side.monthly, currency)}/mo`}
          {limitPhrase(side) ? ` · ${limitPhrase(side)}` : ""}
        </span>
      </div>
    </td>
  );
}

/** What the plan grants, when the row carries a number or a stated value. */
function limitPhrase(side: FeatureSide): string | null {
  if (side.valueNum != null) {
    return `${side.valueNum.toLocaleString("en-US")}${side.unit ? ` ${side.unit}` : ""}`;
  }
  return side.valueText ?? null;
}
