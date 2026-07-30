"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { CheckIcon } from "@/components/icons";
import { api, type EntitlementCell } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TabSection } from "@/components/outrival/tab-shell";

/**
 * Packaging — the features × plans matrix of the latest pricing capture
 * (Pricing Intelligence P2). Canonical (catalog-recognized) features lead,
 * free-text page wording follows; a cell whose value differs from the previous
 * batch is highlighted, because "what changed" is the whole reason this panel
 * exists next to a price list that already names the tiers.
 *
 * Renders nothing when no matrix was ever captured: an empty grid under a
 * heading would read as "they gate nothing", which is not what absence means.
 */
export function PackagingMatrix({ competitorId }: { competitorId: string }) {
  const q = useQuery({
    queryKey: ["competitor", competitorId, "entitlements"],
    queryFn: () => api.getCompetitorEntitlements(competitorId),
    placeholderData: keepPreviousData,
  });

  const data = q.data ?? null;
  const model = useMemo(() => (data ? buildMatrix(data.current, data.previous) : null), [data]);

  if (!model || model.features.length === 0) return null;

  const { plans, features, changedCells } = model;

  return (
    <TabSection title="Packaging">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4 text-left font-normal text-xs text-muted-foreground">
                Feature
              </th>
              {plans.map((plan) => (
                <th
                  scope="col"
                  key={plan}
                  className="px-3 py-2 text-left font-medium text-xs text-foreground"
                >
                  {plan}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((feature) => (
              <tr key={feature.slug} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="max-w-56 truncate py-2 pr-4 text-left font-normal text-dense text-foreground"
                  title={feature.label}
                >
                  {feature.label}
                </th>
                {plans.map((plan) => {
                  const cell = feature.byPlan.get(plan);
                  const changed = changedCells.has(`${feature.slug}|${plan}`);
                  return (
                    <td
                      key={plan}
                      className={cn(
                        "px-3 py-2 align-baseline tabular-nums",
                        changed && "bg-medium/10",
                      )}
                    >
                      <CellValue cell={cell} changed={changed} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        From their pricing page. Highlighted cells changed since the previous capture.
      </p>
    </TabSection>
  );
}

function CellValue({ cell, changed }: { cell: EntitlementCell | undefined; changed: boolean }) {
  if (!cell) {
    return (
      <span aria-label="Not included" className="text-muted-foreground">
        —
      </span>
    );
  }
  if (cell.kind === "boolean") {
    return <CheckIcon size={16} aria-label="Included" className={cn(changed ? "text-foreground" : "text-muted-foreground")} />;
  }
  if (cell.value_num != null) {
    return (
      <span className={cn(changed && "font-medium")}>
        {cell.value_num.toLocaleString("en-US")}
        {cell.unit ? ` ${cell.unit}` : ""}
      </span>
    );
  }
  return <span className={cn(changed && "font-medium")}>{cell.value_text ?? "✓"}</span>;
}

interface FeatureRow {
  slug: string;
  label: string;
  canonical: boolean;
  byPlan: Map<string, EntitlementCell>;
}

function buildMatrix(current: EntitlementCell[], previous: EntitlementCell[]) {
  // Column order: as the batch lists plans (page order is lost to storage, but
  // the stable plan/label sort the API applies keeps captures comparable).
  const plans: string[] = [];
  for (const c of current) if (!plans.includes(c.plan_name)) plans.push(c.plan_name);

  const bySlug = new Map<string, FeatureRow>();
  for (const c of current) {
    const row = bySlug.get(c.feature_slug) ?? {
      slug: c.feature_slug,
      label: c.feature_label,
      canonical: c.is_canonical,
      byPlan: new Map<string, EntitlementCell>(),
    };
    if (!row.byPlan.has(c.plan_name)) row.byPlan.set(c.plan_name, c);
    bySlug.set(c.feature_slug, row);
  }

  // Canonical features first, each group in its stored order.
  const features = [...bySlug.values()].sort(
    (a, b) => Number(b.canonical) - Number(a.canonical),
  );

  // A cell is "changed" when its value differs from the previous batch — or
  // when the feature/plan pair appeared or vanished. Vanished pairs have no
  // cell to paint, so presence changes surface on the appearing side only.
  const prevBySlugPlan = new Map<string, EntitlementCell>();
  for (const p of previous) prevBySlugPlan.set(`${p.feature_slug}|${p.plan_name}`, p);
  const changedCells = new Set<string>();
  if (previous.length > 0) {
    for (const c of current) {
      const key = `${c.feature_slug}|${c.plan_name}`;
      const before = prevBySlugPlan.get(key);
      if (
        !before ||
        before.value_num !== c.value_num ||
        (before.value_text ?? null) !== (c.value_text ?? null)
      ) {
        changedCells.add(key);
      }
    }
  }

  return { plans, features, changedCells };
}
