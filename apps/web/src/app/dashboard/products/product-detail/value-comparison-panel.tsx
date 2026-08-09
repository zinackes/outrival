"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ENTITLEMENT_CATALOG,
  compareEntitlements,
  formatPrice,
  type EntitlementRow,
  type FeatureSide,
} from "@outrival/shared";
import type { ValueComparisonSide } from "@/lib/api";
import { useFx } from "@/lib/fx";
import { planMonthlyMap } from "@/lib/plan-monthly";
import { productValueComparisonQuery } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * What each price buys, ours against the whole roster (OUT-68). The ladder above
 * answers where our entry price sits; this answers what that price includes,
 * feature by feature, for us and for every rival whose pricing page we have a
 * captured matrix for.
 *
 * One column per company, never one row per plan pair: the cell names the
 * CHEAPEST plan on that side that lists the feature. Two pricing pages have no
 * shared notion of "tier 2", so the table refuses to invent one.
 *
 * Deterministic end to end — every cell is a stored plan_entitlements row, and
 * companies meet only through the canonical feature catalog.
 */
export function ValueComparisonPanel({ productId }: { productId: string }) {
  const fx = useFx();
  const q = useQuery({ ...productValueComparisonQuery(productId), retry: false });
  const rates = fx?.rates ?? null;

  const model = useMemo(() => (q.data ? buildModel(q.data, rates) : null), [q.data, rates]);

  if (q.isPending) {
    return (
      <Card className="bg-gradient-card-strong p-4">
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }
  if (!model) return null;

  const { columns, rows, currency, ourMatrixMissing } = model;

  if (ourMatrixMissing) {
    return (
      <Card className="bg-gradient-card-strong p-4">
        <h3 className="mb-1 text-dense font-semibold uppercase tracking-wide text-muted-foreground">
          What your price buys
        </h3>
        <Separator className="mb-3" />
        <p className="text-dense text-muted-foreground">
          Your rivals&rsquo; pricing pages list what each plan includes, yours has no captured
          feature list yet. Point this product at a pricing page and the comparison fills in
          on the next scan.
        </p>
      </Card>
    );
  }

  if (rows.length === 0 || columns.length === 0) return null;

  return (
    <Card className="bg-gradient-card-strong p-4">
      <h3 className="mb-1 text-dense font-semibold uppercase tracking-wide text-muted-foreground">
        What your price buys
      </h3>
      <Separator className="mb-3" />
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
              {columns.map((column) => (
                <th
                  scope="col"
                  key={column.id}
                  className="max-w-40 truncate px-3 py-2 text-left text-xs font-medium text-foreground"
                  title={column.name}
                >
                  {column.name}
                </th>
              ))}
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
                <PlanCell side={row.ours} currency={currency} />
                {columns.map((column) => (
                  <PlanCell key={column.id} side={row.byCompetitor.get(column.id) ?? null} currency={currency} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Each cell is the cheapest plan that lists the feature on that pricing page.
        &ldquo;Not listed&rdquo; means the page does not mention it, which is not the same as
        unavailable.
      </p>
    </Card>
  );
}

function PlanCell({ side, currency }: { side: FeatureSide | null; currency: string }) {
  if (!side) {
    return <td className="px-3 py-2 align-baseline text-dense text-muted-foreground">Not listed</td>;
  }
  return (
    <td className="px-3 py-2 align-baseline tabular-nums">
      <div className="flex flex-col">
        <span className="text-dense text-foreground">{side.planName}</span>
        <span className={cn("text-xs text-muted-foreground")}>
          {side.monthly == null ? "Quote-based" : `${formatPrice(side.monthly, currency)}/mo`}
          {side.valueNum != null
            ? ` · ${side.valueNum.toLocaleString("en-US")}${side.unit ? ` ${side.unit}` : ""}`
            : ""}
        </span>
      </div>
    </td>
  );
}

interface PanelRow {
  slug: string;
  label: string;
  ours: FeatureSide | null;
  byCompetitor: Map<string, FeatureSide | null>;
}

const CATALOG_ORDER = new Map(ENTITLEMENT_CATALOG.map((entry, i) => [entry.slug, i]));

/**
 * One comparison per rival, merged into one table. `ours` is derived from our own
 * matrix alone, so it is the same object in every pairing — the merge keeps the
 * first one and only widens the competitor columns.
 */
function buildModel(
  data: { self: ValueComparisonSide | null; competitors: ValueComparisonSide[] },
  rates: Record<string, number> | null,
) {
  const self = data.self;
  const rivals = data.competitors.filter((c) => c.cells.length > 0);
  if (!self || rivals.length === 0) return null;
  if (self.cells.length === 0) {
    return { columns: [], rows: [], currency: "USD", ourMatrixMissing: true as const };
  }

  const currency =
    self.plans.find((p) => p.price != null)?.currency ??
    rivals.flatMap((r) => r.plans).find((p) => p.price != null)?.currency ??
    "USD";
  const sideOf = (company: ValueComparisonSide) => ({
    cells: company.cells as EntitlementRow[],
    planMonthly: planMonthlyMap(company.plans, currency, rates),
  });

  const ourSide = sideOf(self);
  const bySlug = new Map<string, PanelRow>();
  for (const rival of rivals) {
    for (const row of compareEntitlements(ourSide, sideOf(rival))) {
      const existing = bySlug.get(row.slug) ?? {
        slug: row.slug,
        label: row.label,
        ours: row.ours,
        byCompetitor: new Map<string, FeatureSide | null>(),
      };
      existing.byCompetitor.set(rival.id, row.theirs);
      bySlug.set(row.slug, existing);
    }
  }

  // Catalog order, not per-pair divergence order: with one column per rival there
  // is no single pair to rank by, and a stable sequence is what lets two rows be
  // read against each other.
  const rows = [...bySlug.values()].sort(
    (a, b) =>
      (CATALOG_ORDER.get(a.slug) ?? Number.MAX_SAFE_INTEGER) -
      (CATALOG_ORDER.get(b.slug) ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    columns: rivals.map((r) => ({ id: r.id, name: r.name })),
    rows,
    currency,
    ourMatrixMissing: false as const,
  };
}
