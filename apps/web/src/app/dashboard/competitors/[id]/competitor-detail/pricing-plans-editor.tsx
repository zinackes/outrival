"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { DollarSign, Pencil, Plus, Trash2, Sparkles, TriangleAlert } from "lucide-react";
import { normalizePlanKey } from "@outrival/shared";
import {
  api,
  type PricingHistoryPoint,
  type PricingTier,
  type PricingPlanOverride,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { TabSection } from "@/components/outrival/tab-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// One row in the edit form. Mirrors PricingTier but keeps price as a string so an
// empty field can mean "no public price" (quote-based / Custom tier).
type DraftRow = { planName: string; price: string; currency: string; billingPeriod: string };

function toDraft(t: PricingTier): DraftRow {
  return {
    planName: t.planName,
    price: t.price == null ? "" : String(t.price),
    currency: t.currency,
    billingPeriod: t.billingPeriod,
  };
}

function draftToTier(r: DraftRow): PricingTier {
  const trimmed = r.price.trim();
  const price = trimmed === "" ? null : Number(trimmed);
  return {
    planName: r.planName.trim(),
    price: price != null && Number.isFinite(price) ? price : null,
    currency: (r.currency || "USD").trim(),
    billingPeriod: (r.billingPeriod || "monthly").trim(),
  };
}

function tiersEqual(a: PricingTier, b: PricingTier): boolean {
  return a.price === b.price && a.currency === b.currency && a.billingPeriod === b.billingPeriod;
}

// Diff the edited plan list against the detected baseline into a minimal override
// set — matching resolveCurrentPricing's semantics exactly: a plan left equal to
// detection produces NO override (so the scraper keeps it fresh); a changed or
// brand-new plan becomes edit/add; a removed detected plan becomes hide.
function computeOverrides(edited: PricingTier[], detected: PricingTier[]): PricingPlanOverride[] {
  const now = new Date().toISOString();
  const detByKey = new Map(detected.map((d) => [normalizePlanKey(d.planName), d]));
  const out: PricingPlanOverride[] = [];
  const editedKeys = new Set<string>();
  for (const e of edited) {
    if (!e.planName) continue;
    const key = normalizePlanKey(e.planName);
    editedKeys.add(key);
    const d = detByKey.get(key);
    if (d && tiersEqual(e, d)) continue; // matches detection → let it flow
    out.push({ planKey: key, action: d ? "edit" : "add", value: e, lastEditedByUserAt: now });
  }
  for (const d of detected) {
    const key = normalizePlanKey(d.planName);
    if (!editedKeys.has(key)) out.push({ planKey: key, action: "hide", lastEditedByUserAt: now });
  }
  return out;
}

function priceLabel(price: number | null, currency: string, period: string): string {
  if (price == null) return "Custom";
  return `${price} ${currency} / ${period.replace(/_/g, "-")}`;
}

/**
 * The competitor's editable "Current plans": the latest detected pricing batch with
 * the user's per-plan overlay applied. The user can edit a plan's price, add a plan
 * the scraper never captured, or hide one — locked plans survive future scrapes,
 * untouched plans stay fresh, and a scrape that diverges from a locked value is
 * surfaced as drift rather than silently overwriting it. The price-over-time chart
 * stays on raw detection (this never writes to pricing_history).
 */
export function PricingPlansEditor({
  competitorId,
  history,
  onSaved,
  className,
}: {
  competitorId: string;
  history: PricingHistoryPoint[];
  onSaved?: () => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const plansQuery = useQuery({
    queryKey: ["competitor", competitorId, "pricingPlans"],
    queryFn: () => api.getCompetitorPricingPlans(competitorId),
    placeholderData: keepPreviousData,
  });

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Per-plan price movement (first vs latest capture) from the observed history,
  // keyed by normalized plan name so it lines up with the resolved plans.
  const deltaByKey = useMemo(() => {
    const sorted = [...history].sort(
      (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
    );
    const first = new Map<string, number>();
    const last = new Map<string, number>();
    for (const p of sorted) {
      if (p.price == null) continue;
      const k = normalizePlanKey(p.plan_name);
      if (!first.has(k)) first.set(k, p.price);
      last.set(k, p.price);
    }
    const out = new Map<string, number>();
    for (const [k, l] of last) {
      const f = first.get(k);
      if (f != null && l !== f) out.set(k, l - f);
    }
    return out;
  }, [history]);

  const data = plansQuery.data;
  const resolved = data?.resolved ?? [];
  const detected = data?.detected ?? [];

  function startEdit() {
    setRows(resolved.length > 0 ? resolved.map(toDraft) : []);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const edited = rows.map(draftToTier).filter((t) => t.planName);
      const overrides = computeOverrides(edited, detected);
      await api.putCompetitorPricingPlans(competitorId, overrides);
      await qc.invalidateQueries({ queryKey: ["competitor", competitorId, "pricingPlans"] });
      setEditing(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  const action =
    !editing && !plansQuery.isLoading ? (
      <div className="flex items-center gap-2">
        {resolved.some((r) => r.locked) && (
          <span className="text-meta text-muted-foreground">edited by you</span>
        )}
        <Button size="sm" variant="ghost" onClick={startEdit}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      </div>
    ) : null;

  return (
    <TabSection title="Current plans" icon={DollarSign} action={action} className={className}>
      {plansQuery.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={r.planName}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, planName: e.target.value } : x)))
                  }
                  placeholder="Plan name"
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={0}
                  value={r.price}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, price: e.target.value } : x)))
                  }
                  placeholder="—"
                  className="w-24"
                />
                <Input
                  value={r.currency}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, currency: e.target.value } : x)))
                  }
                  placeholder="USD"
                  className="w-20"
                />
                <Input
                  value={r.billingPeriod}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, billingPeriod: e.target.value } : x)))
                  }
                  placeholder="monthly"
                  className="w-28"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                  aria-label="Remove plan"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                setRows((rs) => [...rs, { planName: "", price: "", currency: "USD", billingPeriod: "monthly" }])
              }
            >
              <Plus className="size-3.5" /> Add plan
            </Button>
          </div>
          <p className="text-meta text-muted-foreground">
            Leave the price empty for a quote-based tier. Edited plans stay put on the next scrape;
            untouched plans keep updating on their own.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save plans"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : resolved.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No plans captured yet. Add them by hand, useful when pricing is gated or behind a demo.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {resolved.map((p) => {
            const key = normalizePlanKey(p.planName);
            const delta = deltaByKey.get(key);
            return (
              <li key={key} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {p.planName}
                    </span>
                    {p.price != null ? (
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {p.price} {p.currency}
                        <span className="text-xs font-normal text-muted-foreground">
                          {" "}/ {p.billingPeriod.replace(/_/g, "-")}
                        </span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-sm font-medium text-muted-foreground">Custom</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.origin === "edited" && (
                      <Badge variant="secondary" className="text-meta">
                        <Pencil className="mr-1 size-2.5" /> Edited
                      </Badge>
                    )}
                    {p.origin === "added" && (
                      <Badge variant="outline" className="text-meta">
                        <Plus className="mr-1 size-2.5" /> Added
                      </Badge>
                    )}
                    {p.origin === "detected" && delta != null && (
                      <span
                        className={cn(
                          "text-xs font-mono tabular-nums",
                          delta > 0 ? "text-critical" : "text-positive",
                        )}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(0)} {p.currency}
                      </span>
                    )}
                  </div>
                </div>
                {p.drift && (
                  <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
                    <Sparkles className="size-3" /> Source now shows{" "}
                    {priceLabel(p.drift.price, p.drift.currency, p.drift.billingPeriod)}
                  </span>
                )}
                {p.noLongerDetected && (
                  <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
                    <TriangleAlert className="size-3" /> No longer on their pricing page
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </TabSection>
  );
}
