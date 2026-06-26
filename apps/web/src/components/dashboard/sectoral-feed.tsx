"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Globe, Lock } from "lucide-react";
import { minPlanForSectoral, PLAN_LABELS } from "@outrival/shared";
import {
  api,
  type SectoralSignal,
  type SectoralCategory,
  type SectoralEligibility,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ListRowsSkeleton } from "@/components/dashboard/skeletons";
import { CATEGORY_META, EvidenceModal, SectoralRow } from "./sectoral-signals";
import { PageHead } from "./page-head";

const PAGE_SIZE = 25;
const CATEGORIES = Object.keys(CATEGORY_META) as SectoralCategory[];

type View = "active" | "dismissed";

// Full sector-trends feed (consumption cockpit). Reuses the row + evidence modal
// from the overview teaser; adds category filter, dismissed toggle and paging.
export function SectoralFeed({
  initialSignals = null,
  initialEligibility = null,
}: {
  initialSignals?: SectoralSignal[] | null;
  initialEligibility?: SectoralEligibility | null;
} = {}) {
  const [signals, setSignals] = useState<SectoralSignal[] | null>(initialSignals);
  const [eligibility, setEligibility] = useState<SectoralEligibility | null>(
    initialEligibility,
  );
  const [active, setActive] = useState<SectoralSignal | null>(null);
  const [category, setCategory] = useState<SectoralCategory | null>(null);
  const [view, setView] = useState<View>("active");
  const [hasMore, setHasMore] = useState(
    initialSignals ? initialSignals.length === PAGE_SIZE : false,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  // Seed covers the default page (no category, active view) → skip first fetch.
  const seededRef = useRef(initialSignals !== null);

  const fetchPage = useCallback(
    (offset: number) =>
      api.listSectoral({
        limit: PAGE_SIZE,
        offset,
        category: category ?? undefined,
        dismissed: view === "dismissed",
      }),
    [category, view],
  );

  // (Re)load from the top whenever a filter changes.
  useEffect(() => {
    if (seededRef.current) {
      seededRef.current = false;
      return;
    }
    let cancelled = false;
    setSignals(null);
    fetchPage(0)
      .then((r) => {
        if (cancelled) return;
        setSignals(r.signals);
        // Eligibility is plan/competitor scoped, not filter scoped — only the
        // first page carries it; keep the last known value otherwise.
        if (r.eligibility) setEligibility(r.eligibility);
        setHasMore(r.signals.length === PAGE_SIZE);
      })
      .catch(() => {
        if (!cancelled) setSignals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    if (!signals) return;
    setLoadingMore(true);
    try {
      const { signals: rows } = await fetchPage(signals.length);
      setSignals((prev) => (prev ? [...prev, ...rows] : rows));
      setHasMore(rows.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  function openDetail(s: SectoralSignal) {
    setActive(s);
    if (s.readAt === null) {
      api.markSectoralRead(s.id).catch(() => {});
      setSignals((prev) =>
        prev
          ? prev.map((x) => (x.id === s.id ? { ...x, readAt: new Date().toISOString() } : x))
          : prev,
      );
    }
  }

  function dismiss(id: string) {
    setSignals((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    api.dismissSectoral(id).catch(() => {});
  }

  // A plan that can't reach the competitor floor (free, max 2 < 4) can never
  // populate this page — show an upsell instead of filters over a dead feed.
  // Eligibility null (prefetch/fetch not back yet) → fail open to the normal view.
  if (eligibility && !eligibility.planCanReach) {
    const planLabel = PLAN_LABELS[minPlanForSectoral()];
    return (
      <div className="flex flex-col gap-5">
        <PageHead
          flush
          icon={<Globe size={18} className="text-muted-foreground" aria-hidden />}
          title="Sector trends"
          sub="Patterns across your competitors — not single-competitor signals."
        />
        <Card className="px-6 py-14 text-center text-muted-foreground border-dashed">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-background border border-border flex items-center justify-center">
            <Lock size={16} className="text-muted-foreground" aria-hidden />
          </div>
          <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
            Sector trends are a {planLabel} feature
          </div>
          <div className="text-sm max-w-[420px] mx-auto">
            They compare patterns across at least {eligibility.minCompetitors}{" "}
            competitors — more than your current plan can monitor. Upgrade to{" "}
            {planLabel} to track a wider set and unlock cross-competitor trends.
          </div>
          <Button asChild size="sm" className="mt-4">
            <Link href="/dashboard/settings/billing">Upgrade to {planLabel}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  // Default active view empty state: explain *why*. Below the competitor floor →
  // "add N more"; at/above it → patterns still building. (planCanReach is true
  // here — the upsell case returned above.)
  const belowFloor =
    eligibility !== null && eligibility.competitorCount < eligibility.minCompetitors;
  const floorTarget = eligibility?.minCompetitors ?? 0;
  const trackedCount = eligibility?.competitorCount ?? 0;
  const remainingCompetitors = Math.max(floorTarget - trackedCount, 1);

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        flush
        icon={<Globe size={18} className="text-muted-foreground" aria-hidden />}
        title="Sector trends"
        sub="Patterns across your competitors — not single-competitor signals."
      />

      <div className="flex items-center gap-2 flex-wrap">
        <Tabs
          value={category ?? "all"}
          onValueChange={(v) => setCategory(v === "all" ? null : (v as SectoralCategory))}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c}>
                {CATEGORY_META[c].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => v && setView(v as View)}
          className="ml-auto"
        >
          <ToggleGroupItem value="active">Active</ToggleGroupItem>
          <ToggleGroupItem value="dismissed">Dismissed</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {signals === null ? (
        <ListRowsSkeleton rows={5} />
      ) : signals.length === 0 ? (
        <Card className="px-6 py-14 text-center text-muted-foreground border-dashed">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-background border border-border flex items-center justify-center">
            <Globe size={16} className="text-muted-foreground" aria-hidden />
          </div>
          <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
            {view === "dismissed"
              ? "Nothing dismissed"
              : category !== null
                ? "No trends in this category"
                : belowFloor
                  ? `Add ${remainingCompetitors} more competitor${remainingCompetitors > 1 ? "s" : ""}`
                  : "No sector trends yet"}
          </div>
          <div className="text-sm max-w-[420px] mx-auto">
            {view === "dismissed"
              ? "Trends you dismiss land here so you can revisit them later."
              : category !== null
                ? "Try another category or clear the filter to see all trends."
                : belowFloor
                  ? `Sector trends compare patterns across your competitors — they turn on at ${floorTarget}. You're tracking ${trackedCount}.`
                  : "Sector trends surface as patterns build across your competitors. Add more competitors to spot them sooner."}
          </div>
          {category !== null ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setCategory(null)}
            >
              Clear filter
            </Button>
          ) : belowFloor ? (
            <Button asChild size="sm" className="mt-4">
              <Link href="/dashboard/competitors">Add competitors</Link>
            </Button>
          ) : null}
        </Card>
      ) : (
        <>
          <div>
            {signals.map((s) => (
              <SectoralRow
                key={s.id}
                signal={s}
                onOpen={() => openDetail(s)}
                onDismiss={view === "active" ? () => dismiss(s.id) : undefined}
              />
            ))}
          </div>
          {hasMore && (
            <div>
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}

      <EvidenceModal signal={active} onClose={() => setActive(null)} />
    </div>
  );
}
