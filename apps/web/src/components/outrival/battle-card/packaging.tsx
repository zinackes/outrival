"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { TagIcon } from "@/components/icons";
import { diffEntitlements, resolveFeatureSlug } from "@outrival/shared";
import { api, type EntitlementCell } from "@/lib/api";
import { myProductQuery } from "@/lib/queries";
import { SectionHeading } from "./sections";

/**
 * Packaging (Pricing Intelligence P2) — 3-5 lines derived DETERMINISTICALLY
 * from the competitor's captured entitlement matrix: which features they gate
 * in their top plan, where the seat limits sit, what moved recently, and — when
 * the self-profile lists one of those gated features — the fact that we ship
 * it too. No AI writes here, so unlike the six generated sections these lines
 * can never claim something the pricing page does not say.
 */
export function PackagingSection({
  competitorId,
  competitorName,
  productId,
}: {
  competitorId: string;
  competitorName: string;
  productId?: string;
}) {
  const entitlementsQ = useQuery({
    queryKey: ["competitor", competitorId, "entitlements"],
    queryFn: () => api.getCompetitorEntitlements(competitorId),
    placeholderData: keepPreviousData,
  });
  const myProductQ = useQuery({ ...myProductQuery(productId), retry: false });

  const lines = useMemo(() => {
    const data = entitlementsQ.data;
    if (!data || data.current.length === 0) return [];
    return deriveLines({
      current: data.current,
      previous: data.previous,
      competitorName,
      selfFeatures: myProductQ.data?.profile.features?.value ?? [],
    });
  }, [entitlementsQ.data, myProductQ.data, competitorName]);

  if (lines.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-t border-border p-5">
      <SectionHeading icon={TagIcon}>Packaging</SectionHeading>
      <ul className="flex flex-col gap-2.5">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-content leading-relaxed">
            <span className="mt-px shrink-0 text-muted-foreground" aria-hidden>
              •
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Read from their pricing page&apos;s feature matrix — not AI-written.
      </p>
    </section>
  );
}

const MAX_LINES = 5;

export function deriveLines(args: {
  current: EntitlementCell[];
  previous: EntitlementCell[];
  competitorName: string;
  selfFeatures: string[];
}): string[] {
  const { current, previous, competitorName, selfFeatures } = args;
  const lines: string[] = [];

  // Feature count per plan; the plan carrying the most is the top tier (upper
  // tiers list supersets) — deterministic without needing the price rank here.
  const perPlan = new Map<string, EntitlementCell[]>();
  for (const c of current) {
    const list = perPlan.get(c.plan_name) ?? [];
    list.push(c);
    perPlan.set(c.plan_name, list);
  }
  const topPlan =
    perPlan.size >= 2
      ? [...perPlan.entries()].sort((a, b) => b[1].length - a[1].length)[0]![0]
      : null;

  // Features gated exclusively behind the top plan — the classic enterprise wall.
  const gated: EntitlementCell[] = [];
  if (topPlan) {
    const bySlug = new Map<string, Set<string>>();
    for (const c of current) {
      const set = bySlug.get(c.feature_slug) ?? new Set();
      set.add(c.plan_name);
      bySlug.set(c.feature_slug, set);
    }
    for (const c of current) {
      const plans = bySlug.get(c.feature_slug)!;
      if (plans.size === 1 && plans.has(topPlan) && c.plan_name === topPlan && c.is_canonical) {
        gated.push(c);
      }
    }
  }
  if (topPlan && gated.length > 0) {
    const names = gated.slice(0, 4).map((g) => g.feature_label);
    lines.push(
      `They gate ${names.join(", ")}${gated.length > 4 ? ` (+${gated.length - 4} more)` : ""} behind ${topPlan}.`,
    );
  }

  // The seat ladder, when captured ("Starter 5 · Pro 25 · Enterprise unlimited").
  const seats = current.filter((c) => c.feature_slug === "seats_included");
  if (seats.length >= 2) {
    const steps = seats.map((s) => {
      const value =
        s.value_num != null ? s.value_num.toLocaleString("en-US") : (s.value_text ?? "included");
      return `${s.plan_name} ${value}`;
    });
    lines.push(`Seats included: ${steps.join(" · ")}.`);
  }

  // Recent packaging moves — the shared differ, so this line and the signal
  // feed can never tell two different stories.
  if (previous.length > 0) {
    for (const move of diffEntitlements(previous, current).slice(0, 2)) {
      lines.push(`Recently changed: ${move.summary}.`);
    }
  }

  // Self overlap: a feature they wall off that our own profile lists.
  if (selfFeatures.length > 0 && gated.length > 0) {
    const selfSlugs = new Set(selfFeatures.map((f) => resolveFeatureSlug(f).slug));
    const overlap = gated.find((g) => selfSlugs.has(g.feature_slug));
    if (overlap) {
      lines.push(
        `${competitorName} sells ${overlap.feature_label} as a ${topPlan}-only feature — your product profile lists it too.`,
      );
    }
  }

  return lines.slice(0, MAX_LINES);
}
