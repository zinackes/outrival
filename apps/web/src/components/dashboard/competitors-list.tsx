"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Plus,
  Search,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Flame,
  Loader2,
  MoreHorizontal,
  Trash2,
  ExternalLink,
  Telescope,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api, type Competitor } from "@/lib/api";
import { emitCompetitorsChanged } from "@/lib/competitor-events";
import { track } from "@/lib/posthog/events";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn, prettyUrl } from "@/lib/utils";
import { PageHead } from "./page-head";
import { DeltaPill, computeDelta } from "./delta-pill";
import { CompAvatar } from "./comp-avatar";
import { FreshnessDot } from "@/components/outrival/freshness-dot";
import { ListError } from "@/components/outrival/list-error";
import { toastApiError } from "@/lib/error-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CatPill } from "./cat-pill";
import { CategoryBar, CategoryLegend, CategoryKey } from "./category-bar";
import { TableSkeleton, GridCardsSkeleton } from "./skeletons";
import { feedItemMotion, feedItemVariants, feedItemTransition } from "@/lib/motion";

type SortBy = "name" | "overlap" | "signals" | "delta" | "lastSignal";
type SortDir = "asc" | "desc";

const TH_BASE =
  "text-left px-3.5 py-2.5 font-mono text-meta uppercase tracking-wide text-muted-foreground font-medium border-b border-border whitespace-nowrap";

export function CompetitorsList() {
  const router = useRouter();
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [view, setView] = useState<"table" | "cards">("table");
  const [sortBy, setSortBy] = useState<SortBy>("signals");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterCat, setFilterCat] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competitor | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    try {
      const c = await api.listCompetitors();
      setCompetitors(c.competitors);
      setErr(null);
    } catch (e) {
      setErr(e);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      refresh();
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteCompetitor(deleteTarget.id);
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      await refresh();
      emitCompetitorsChanged();
    } catch (e) {
      toastApiError(e);
    } finally {
      setDeleting(false);
    }
  }

  function toggleSort(col: SortBy) {
    if (sortBy === col) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  const enriched = useMemo(() => {
    if (!competitors) return [];
    return competitors.map((c) => {
      const stats = c.stats ?? {
        signals7d: 0,
        signalsPrev: 0,
        lastSignalAt: null,
        categoryCounts: {},
      };
      const delta = computeDelta(stats.signals7d, stats.signalsPrev);
      return {
        ...c,
        signals7d: stats.signals7d,
        signalsPrev: stats.signalsPrev,
        delta,
        categoryCounts: stats.categoryCounts,
        lastSignal: stats.lastSignalAt,
        overlap:
          c.overlapScore != null ? Math.round(c.overlapScore) : null,
      };
    });
  }, [competitors]);

  const kpis = useMemo(() => {
    if (!enriched.length)
      return {
        total7d: 0,
        totalPrev: 0,
        mostActive: null as null | (typeof enriched)[number],
        biggestMover: null as null | (typeof enriched)[number],
      };
    const total7d = enriched.reduce<number>((acc, c) => acc + c.signals7d, 0);
    const totalPrev = enriched.reduce<number>((acc, c) => acc + c.signalsPrev, 0);
    const mostActive = enriched.reduce<(typeof enriched)[number] | null>(
      (best, c) => (best == null || c.signals7d > best.signals7d ? c : best),
      null,
    );
    const biggestMover = enriched
      .filter((c) => c.signals7d >= 2)
      .reduce<(typeof enriched)[number] | null>(
        (best, c) =>
          best == null || c.delta.delta > best.delta.delta ? c : best,
        null,
      );
    return { total7d, totalPrev, mostActive, biggestMover };
  }, [enriched]);

  const totalDelta = computeDelta(kpis.total7d, kpis.totalPrev);

  const sorted = useMemo(() => {
    let arr = [...enriched];
    if (filterCat.size)
      arr = arr.filter((c) => c.category && filterCat.has(c.category));
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.url.toLowerCase().includes(q),
      );
    }
    arr.sort((a, b) => {
      const dir = sortDir === "desc" ? -1 : 1;
      if (sortBy === "name") return a.name.localeCompare(b.name) * dir;
      if (sortBy === "overlap")
        return ((a.overlap ?? 0) - (b.overlap ?? 0)) * dir;
      if (sortBy === "signals") return (a.signals7d - b.signals7d) * dir;
      if (sortBy === "delta") return (a.delta.delta - b.delta.delta) * dir;
      if (sortBy === "lastSignal") {
        const ta = a.lastSignal ? new Date(a.lastSignal).getTime() : 0;
        const tb = b.lastSignal ? new Date(b.lastSignal).getTime() : 0;
        return (ta - tb) * dir;
      }
      return 0;
    });
    return arr;
  }, [enriched, sortBy, sortDir, filterCat, query]);

  const cats = useMemo(
    () =>
      Array.from(
        new Set(
          (competitors ?? [])
            .map((c) => c.category)
            .filter((c): c is string => Boolean(c)),
        ),
      ),
    [competitors],
  );

  if (err && competitors === null) {
    return (
      <div className="space-y-6">
        <PageHead title="Competitors" sub="Everyone you're tracking." />
        <ListError error={err} onRetry={refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      <PageHead
        title="Competitors"
        sub={
          competitors
            ? `${competitors.length} tracked`
            : "Loading…"
        }
        actions={
          <Button onClick={() => setShowDialog(true)}>
            <Plus size={13} /> Add competitor
          </Button>
        }
      />

      {competitors && competitors.length > 0 && (
        <Card className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <KpiCell
            label="Signals 7d"
            value={kpis.total7d}
            delta={totalDelta.label}
            deltaKind={totalDelta.kind}
            sub={`${kpis.totalPrev} in previous 7d`}
          />
          <KpiCell
            label="Most active"
            value={kpis.mostActive?.name ?? "—"}
            sub={
              kpis.mostActive
                ? `${kpis.mostActive.signals7d} signals · ${kpis.mostActive.delta.label}`
                : undefined
            }
            highlight={!!kpis.mostActive}
            onClick={
              kpis.mostActive
                ? () =>
                    router.push(
                      `/dashboard/competitors/${kpis.mostActive!.id}`,
                    )
                : undefined
            }
          />
          <KpiCell
            label="Biggest mover"
            value={kpis.biggestMover?.name ?? "—"}
            sub={
              kpis.biggestMover
                ? `${kpis.biggestMover.signals7d} signals · ${kpis.biggestMover.delta.label}`
                : "Not enough activity"
            }
            deltaKind={kpis.biggestMover?.delta.kind}
            icon={kpis.biggestMover ? <Flame size={13} /> : undefined}
            onClick={
              kpis.biggestMover
                ? () =>
                    router.push(
                      `/dashboard/competitors/${kpis.biggestMover!.id}`,
                    )
                : undefined
            }
          />
        </Card>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {cats.length > 0 && (
          <>
            <span className="font-mono text-meta tracking-widest text-muted-foreground uppercase mr-1">
              Category
            </span>
            <ToggleGroup
              type="multiple"
              value={Array.from(filterCat)}
              onValueChange={(v) => setFilterCat(new Set(v as string[]))}
              variant="outline"
              size="sm"
              spacing={4}
            >
              {cats.map((c) => (
                <ToggleGroupItem key={c} value={c}>
                  {c}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </>
        )}
        {(filterCat.size > 0 || query.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterCat(new Set());
              setQuery("");
            }}
            className="h-7 px-2 text-meta text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </Button>
        )}
        <div className="flex-1" />
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as "table" | "cards")}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="table">Table</ToggleGroupItem>
          <ToggleGroupItem value="cards">Cards</ToggleGroupItem>
        </ToggleGroup>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-xs w-48"
          />
        </div>
      </div>

      {competitors === null && (
        view === "table"
          ? <TableSkeleton rows={6} columns={6} />
          : <GridCardsSkeleton cards={6} minWidth={280} cardHeight={220} />
      )}

      {competitors && competitors.length === 0 && (
        <Card className="px-6 py-12 text-center text-muted-foreground border-dashed">
          <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
            No competitors
          </div>
          <div className="text-sm mb-4">
            Add one yourself, or let Discovery suggest competitors for you.
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button onClick={() => setShowDialog(true)}>
              <Plus size={13} /> Add competitor
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push("/dashboard/discovery")}
            >
              <Telescope size={13} /> Explore Discovery
            </Button>
          </div>
        </Card>
      )}

      {competitors && competitors.length > 0 && sorted.length === 0 && (
        <Card className="px-6 py-10 text-center border-dashed text-muted-foreground">
          <p className="text-sm mb-3">No competitors match your filters.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFilterCat(new Set());
              setQuery("");
            }}
          >
            Clear filters
          </Button>
        </Card>
      )}

      {competitors && competitors.length > 0 && sorted.length > 0 && view === "table" && (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-dense min-w-[760px]">
            <thead className="bg-background">
              <tr>
                <th className={cn(TH_BASE, "w-8")} />
                <SortHeader
                  col="name"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onClick={toggleSort}
                >
                  Competitor
                </SortHeader>
                <th className={TH_BASE}>Category</th>
                <SortHeader
                  col="overlap"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  tip="How closely this competitor overlaps with your product (0–100)."
                >
                  Overlap
                </SortHeader>
                <SortHeader
                  col="signals"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  num
                >
                  Signals 7d
                </SortHeader>
                <SortHeader
                  col="delta"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  num
                  tip="Signals in the last 7 days vs the previous 7 days"
                >
                  7d trend
                </SortHeader>
                <th className={TH_BASE}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        Signal mix (7d)
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="mb-1.5 font-medium normal-case tracking-normal">
                        Share of the last 7 days&apos; signals by category
                      </p>
                      <CategoryKey />
                    </TooltipContent>
                  </Tooltip>
                </th>
                <SortHeader
                  col="lastSignal"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onClick={toggleSort}
                >
                  Last signal
                </SortHeader>
                <th className={cn(TH_BASE, "w-8")} />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
              {sorted.map((c) => (
                <motion.tr
                  key={c.id}
                  variants={feedItemVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={feedItemTransition}
                  onClick={() =>
                    router.push(`/dashboard/competitors/${c.id}`)
                  }
                  className="border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-3.5 py-3 align-middle">
                    <CompAvatar name={c.name} />
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <div className="flex items-center gap-1.5 font-medium">
                      {c.name}
                      {c.freshness && (
                        <FreshnessDot
                          lastScrapedAt={c.freshness.lastScrapedAt}
                          status={c.freshness.status}
                        />
                      )}
                    </div>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="group/url inline-flex items-center gap-1 mt-px w-fit max-w-full font-mono text-meta text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span className="truncate underline-offset-2 group-hover/url:underline">
                        {prettyUrl(c.url)}
                      </span>
                      <ExternalLink
                        size={10}
                        className="shrink-0 opacity-0 transition-opacity group-hover/url:opacity-100"
                      />
                    </a>
                  </td>
                  <td className="px-3.5 py-3 align-middle text-muted-foreground">
                    {c.category ?? "—"}
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    {c.overlap != null ? (
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-[70px] bg-background rounded border border-border overflow-hidden">
                          <span
                            className="block h-full bg-primary rounded"
                            style={{ width: `${c.overlap}%` }}
                          />
                        </div>
                        <span className="tabular-nums font-mono text-xs w-6">
                          {c.overlap}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-3 align-middle text-right tabular-nums font-mono font-semibold">
                    {c.signals7d}
                  </td>
                  <td className="px-3.5 py-3 align-middle text-right">
                    <DeltaPill delta={c.delta} />
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <CategoryBar counts={c.categoryCounts} w={110} />
                  </td>
                  <td className="px-3.5 py-3 align-middle text-muted-foreground tabular-nums font-mono text-xs">
                    {c.lastSignal
                      ? formatDistanceToNow(new Date(c.lastSignal), { addSuffix: true })
                      : "—"}
                  </td>
                  <td className="w-8 text-right px-3.5 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
                        >
                          <ArrowRight size={13} /> Open detail
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(c)}
                          className="text-critical focus:text-critical"
                        >
                          <Trash2 size={13} /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </motion.tr>
              ))}
              </AnimatePresence>
            </tbody>
          </table>
        </Card>
      )}

      {competitors && competitors.length > 0 && sorted.length > 0 && view === "cards" && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
          <AnimatePresence initial={false} mode="popLayout">
          {sorted.map((c) => (
            <motion.div key={c.id} {...feedItemMotion}>
            <Card
              onClick={() => router.push(`/dashboard/competitors/${c.id}`)}
              className="cursor-pointer transition-colors hover:bg-accent/30"
            >
              <div className="p-5">
                <div className="flex items-center gap-2.5 mb-3.5">
                  <CompAvatar name={c.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold text-content">
                      {c.name}
                      {c.freshness && (
                        <FreshnessDot
                          lastScrapedAt={c.freshness.lastScrapedAt}
                          status={c.freshness.status}
                        />
                      )}
                    </div>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="group/url inline-flex max-w-full items-center gap-1 font-mono text-meta text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span className="truncate underline-offset-2 group-hover/url:underline">
                        {prettyUrl(c.url)}
                      </span>
                      <ExternalLink
                        size={10}
                        className="shrink-0 opacity-0 transition-opacity group-hover/url:opacity-100"
                      />
                    </a>
                  </div>
                </div>
                {c.category && (
                  <div className="flex gap-1.5 mb-3 flex-wrap">
                    <CatPill>{c.category}</CatPill>
                  </div>
                )}
                {c.overlap != null && (
                  <div className="mb-3">
                    <div className="flex justify-between text-meta text-muted-foreground mb-1.5">
                      <span>Overlap</span>
                      <span className="tabular-nums font-mono">
                        {c.overlap}/100
                      </span>
                    </div>
                    <div className="h-1.5 bg-background rounded border border-border overflow-hidden">
                      <span
                        className="block h-full bg-primary rounded"
                        style={{ width: `${c.overlap}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-end pt-3 border-t border-border">
                  <div>
                    <div className="text-title font-bold tracking-tight leading-none">
                      {c.signals7d}
                    </div>
                    <div className="text-meta text-muted-foreground font-mono uppercase tracking-widest mt-1">
                      signals 7d
                    </div>
                  </div>
                  <DeltaPill delta={c.delta} />
                </div>
                <div className="mt-3">
                  <CategoryBar counts={c.categoryCounts} w={244} />
                  <div className="mt-2">
                    <CategoryLegend counts={c.categoryCounts} />
                  </div>
                </div>
              </div>
            </Card>
            </motion.div>
          ))}
          </AnimatePresence>
        </div>
      )}

      <AddCompetitorDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        onAdded={refresh}
        onPaywall={(reason) => {
          setShowDialog(false);
          setPaywall(reason);
        }}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete competitor?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name} and all its monitors, snapshots, changes,
              signals and battle cards will be soft-deleted. This cannot be
              undone from the UI.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 size={13} className="animate-spin" />}
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  delta,
  deltaKind = "neutral",
  highlight,
  icon,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: string;
  deltaKind?: "pos" | "neg" | "neutral";
  highlight?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  const isPos = deltaKind === "pos";
  const isNeg = deltaKind === "neg";
  const Wrap = (onClick ? "button" : "div") as "button" | "div";
  return (
    <Wrap
      onClick={onClick}
      className={cn(
        "px-5 py-4 flex flex-col gap-1.5 text-left min-w-0",
        onClick && "transition-colors hover:bg-accent/30",
      )}
    >
      <div className="font-mono text-meta tracking-widest text-muted-foreground uppercase flex items-center justify-between gap-2">
        <span>{label}</span>
        {delta && (
          <span
            className={cn(
              "font-mono text-meta inline-flex items-center gap-0.5",
              isPos && "text-positive",
              isNeg && "text-critical",
              !isPos && !isNeg && "text-muted-foreground",
            )}
          >
            {isPos ? (
              <ArrowUp className="size-3" />
            ) : isNeg ? (
              <ArrowDown className="size-3" />
            ) : (
              "·"
            )}{" "}
            {delta}
          </span>
        )}
      </div>
      <div
        className={cn(
          "font-bold tracking-tight leading-none truncate flex items-center gap-2",
          typeof value === "number"
            ? "text-title-lg font-mono tabular-nums"
            : "text-lg",
          highlight && "text-foreground",
        )}
      >
        {icon}
        <span className="truncate">{value}</span>
      </div>
      {sub && (
        <div className="text-muted-foreground text-meta font-mono truncate">
          {sub}
        </div>
      )}
    </Wrap>
  );
}

function SortHeader({
  col,
  sortBy,
  sortDir,
  onClick,
  children,
  num,
  tip,
}: {
  col: SortBy;
  sortBy: SortBy;
  sortDir: SortDir;
  onClick: (col: SortBy) => void;
  children: React.ReactNode;
  num?: boolean;
  tip?: string;
}) {
  const active = sortBy === col;
  const label = (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        active && "text-foreground",
      )}
    >
      {children}
      {active &&
        (sortDir === "desc" ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
    </span>
  );
  return (
    <th
      className={cn(TH_BASE, "cursor-pointer select-none", num && "text-right")}
      onClick={() => onClick(col)}
    >
      {tip ? (
        <Tooltip>
          <TooltipTrigger asChild>{label}</TooltipTrigger>
          <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
      ) : (
        label
      )}
    </th>
  );
}

function AddCompetitorDialog({
  open,
  onOpenChange,
  onAdded,
  onPaywall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  onPaywall: (reason: PaywallReason) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setUrl("");
      setErr(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.createCompetitor({ name, url });
      track("competitor_added", { source: "manual" });
      await onAdded();
      emitCompetitorsChanged();
      onOpenChange(false);
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        onPaywall(reason);
      } else {
        setErr(String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a competitor</DialogTitle>
          <DialogDescription>
            Enter the name and URL — monitoring starts as soon as it&apos;s created.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="competitor-name">Name</Label>
            <Input
              id="competitor-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="competitor-url">URL</Label>
            <Input
              id="competitor-url"
              required
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          {err && <p className="text-critical text-sm">{err}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 size={13} className="animate-spin" />}
              {busy ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
