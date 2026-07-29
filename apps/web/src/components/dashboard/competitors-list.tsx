"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { AnimatePresence, motion } from "motion/react";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  ArrowRightIcon,
  SpinnerIcon,
  DotsThreeIcon,
  TrashIcon,
  ArrowSquareOutIcon,
  BinocularsIcon,
  BuildingsIcon,
  PauseCircleIcon,
} from "@/components/icons";
import { EmptyState } from "./empty-state";
import { toast } from "sonner";
import { api, type Competitor } from "@/lib/api";
import { competitorsQuery } from "@/lib/queries";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COMPETITOR_NAME_MAX_LENGTH } from "@outrival/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, prettyUrl } from "@/lib/utils";
import { shortAge } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { PageHead } from "./page-head";
import { useSetAskContext } from "./ask-context";
import { DeltaPill, computeDelta } from "./delta-pill";
import { CompAvatar } from "./comp-avatar";
import { CompetitorColorPicker } from "./competitor-color-picker";
import {
  competitorNameColor,
  competitorColorVars,
  COMP_ACCENT,
} from "@/lib/competitor-color";
import { SeverityGauge } from "@/components/outrival/severity-scale";
import { AnalysisBadge } from "@/components/outrival/analysis-status";
import { ProductChips } from "./product-chip";
import { ListError } from "@/components/outrival/list-error";
import { toastApiError } from "@/lib/error-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CatText } from "./cat-pill";
import { TableSkeleton } from "./skeletons";
import { ActivitySpark } from "./activity-spark";
import { feedItemMotion } from "@/lib/motion";

type SortBy = "lastMove" | "activity" | "overlap" | "name";
type Bucket = "all" | "moving" | "quiet" | "attention";

// Past this, a competitor's last move stops being news and the row says so by
// dropping the headline to muted. Matches the 7 day window the counts run on.
const QUIET_AFTER_DAYS = 7;

// The row's seven slots. Tracks are dropped from the right as the content column
// narrows (the dashboard rail eats ~256px), each one paired with the cell's own
// `hidden @Nxl:flex` so the grid never holds an empty track. Order follows the
// DOM: gauge, identity, latest move, activity, overlap, coverage, actions.
const GRID = cn(
  "grid items-center gap-x-3.5",
  "grid-cols-[0.625rem_minmax(0,1.15fr)_minmax(0,1.6fr)_1.75rem]",
  "@2xl:grid-cols-[0.625rem_minmax(0,1.15fr)_minmax(0,1.7fr)_7rem_1.75rem]",
  "@4xl:grid-cols-[0.625rem_minmax(0,1.15fr)_minmax(0,1.75fr)_7rem_9rem_1.75rem]",
  "@5xl:grid-cols-[0.625rem_minmax(0,1.15fr)_minmax(0,1.8fr)_7rem_4rem_9rem_1.75rem]",
);

// Marks a competitor the plan cap froze (over-cap after a downgrade). The scheduler
// skips it non-destructively; the tooltip points the user to billing to resume it.
function PausedByPlanBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/dashboard/settings/billing"
          className="relative z-10 flex shrink-0 items-center gap-1 rounded-sm border border-high/40 px-1.5 py-0.5 text-meta font-medium text-medium"
        >
          <PauseCircleIcon size={16} className="shrink-0" />
          Plan limit
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        Over your plan&apos;s competitor limit, so monitoring is paused. Upgrade to
        resume.
      </TooltipContent>
    </Tooltip>
  );
}

// Marks a competitor the user deliberately paused (kebab → Pause monitoring on its
// page). Distinct from the plan-cap freeze above: nothing to upgrade, just a calm
// reminder that this row's sources are intentionally frozen.
function MonitoringPausedBadge() {
  return (
    <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
      Paused
    </span>
  );
}

// Current-color chip on the quick-set trigger: a filled swatch at the accent
// lightness when set, a neutral outlined square when the competitor has no color.
function ColorSwatchButton({ color }: { color: string | null | undefined }) {
  const vars = competitorColorVars(color);
  return (
    <span
      aria-hidden
      className="block h-3.5 w-3.5 rounded-[4px] border border-border-strong"
      style={vars ? { ...vars, background: COMP_ACCENT, borderColor: "transparent" } : undefined}
    />
  );
}

// Per-row color picker popover — assign a competitor's identity color without
// opening its detail page, so the whole roster's palette is editable in one view.
// Revealed with the kebab on hover: at rest the roster shows data, not controls.
function ColorQuickSet({
  competitor,
  onChange,
}: {
  competitor: { id: string; name: string; color: string | null };
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 w-6 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
            open && "opacity-100",
          )}
          aria-label={`Set color for ${competitor.name}`}
          title="Set color"
        >
          <ColorSwatchButton color={competitor.color} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[16rem] p-2.5">
        <CompetitorColorPicker
          value={competitor.color}
          onChange={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

type Row = ReturnType<typeof enrich>[number];

// One roster row's worth of derived state, computed once per render pass.
function enrich(competitors: Competitor[]) {
  const now = Date.now();
  return competitors.map((c) => {
    const stats = c.stats ?? {
      signals7d: 0,
      signalsPrev: 0,
      lastSignalAt: null,
      categoryCounts: {},
    };
    const move = c.latestMove ?? null;
    const moveAgeDays = move
      ? (now - new Date(move.createdAt).getTime()) / 86_400_000
      : null;
    const coverage = c.coverage ?? { sources: 0, failing: 0, failingSource: null };
    return {
      ...c,
      signals7d: stats.signals7d,
      delta: computeDelta(stats.signals7d, stats.signalsPrev),
      lastSignal: stats.lastSignalAt,
      activity: c.activity ?? [],
      coverage,
      move,
      stale: moveAgeDays === null || moveAgeDays > QUIET_AFTER_DAYS,
      overlap: c.overlapScore != null ? Math.round(c.overlapScore) : null,
      // A row asks for attention when we have stopped watching properly: a source
      // refused us, the last scan failed, or the plan cap froze the whole thing.
      // A deliberate pause is not a problem, so it never lands here.
      needsAttention:
        coverage.failing > 0 ||
        c.pausedByPlan === true ||
        c.freshness?.status === "failed",
    };
  });
}

export function CompetitorsList() {
  const router = useRouter();
  useSetAskContext({ kind: "view", label: "Competitors list" });
  // Server-seeded on first paint (competitors/page.tsx); shares the ["competitors"]
  // cache with the Overview roster. Polls every 30s via refetchInterval.
  const queryClient = useQueryClient();
  // patch-28 — active product scope (cookie-backed switcher, URL ?product= overrides).
  const productId = useProductScope() ?? undefined;
  // Product-attribution chips only make sense in all-products scope (when scoped to one
  // product everything is already filtered → the chip would be redundant noise).
  const allProducts = !productId;
  const competitorsQ = useQuery({ ...competitorsQuery(productId), refetchInterval: 30_000 });
  const competitors = competitorsQ.data ?? null;
  const err = competitorsQ.error;
  const [sortBy, setSortBy] = useState<SortBy>("lastMove");
  const [bucket, setBucket] = useState<Bucket>("all");
  const [query, setQuery] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competitor | null>(null);
  const [deleting, setDeleting] = useState(false);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: competitorsQuery(productId).queryKey });
  }

  // Quick-set a competitor's color from the list (the dedicated "manage colors"
  // surface, alongside the per-competitor edit dialog). Optimistic write-through so
  // the tint flips instantly, rolled back on failure.
  async function setColor(id: string, value: string | null) {
    const key = competitorsQuery(productId).queryKey;
    const prev = queryClient.getQueryData<Competitor[]>(key);
    queryClient.setQueryData<Competitor[]>(key, (old) =>
      old?.map((c) => (c.id === id ? { ...c, color: value } : c)),
    );
    try {
      await api.updateCompetitor(id, { color: value });
      void queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      queryClient.setQueryData(key, prev);
      toastApiError(e);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteCompetitor(deleteTarget.id);
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      toastApiError(e);
    } finally {
      setDeleting(false);
    }
  }

  const rows = useMemo(() => (competitors ? enrich(competitors) : []), [competitors]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      moving: rows.filter((r) => r.signals7d > 0).length,
      quiet: rows.filter((r) => r.signals7d === 0).length,
      attention: rows.filter((r) => r.needsAttention).length,
    }),
    [rows],
  );

  const sorted = useMemo(() => {
    let arr = [...rows];
    if (bucket === "moving") arr = arr.filter((r) => r.signals7d > 0);
    if (bucket === "quiet") arr = arr.filter((r) => r.signals7d === 0);
    if (bucket === "attention") arr = arr.filter((r) => r.needsAttention);
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(
        (r) => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q),
      );
    }
    // One direction per field, the only one that is ever useful: newest move,
    // busiest week, closest competitor, alphabetical.
    arr.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "overlap") return (b.overlap ?? -1) - (a.overlap ?? -1);
      if (sortBy === "activity") return b.signals7d - a.signals7d;
      const ta = a.move ? new Date(a.move.createdAt).getTime() : 0;
      const tb = b.move ? new Date(b.move.createdAt).getTime() : 0;
      return tb - ta;
    });
    return arr;
  }, [rows, bucket, query, sortBy]);

  if (err && competitors === null) {
    return (
      <div className="space-y-6">
        <PageHead title="Competitors" sub="Everyone you're tracking." />
        <ListError error={err} onRetry={refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      <PageHead
        title="Competitors"
        sub={
          competitors ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                <b className="font-mono font-medium text-foreground tabular-nums">
                  {counts.all}
                </b>{" "}
                tracked
              </span>
              {counts.moving > 0 && (
                <>
                  <span className="text-border-strong">·</span>
                  <span>
                    <b className="font-mono font-medium text-foreground tabular-nums">
                      {counts.moving}
                    </b>{" "}
                    moved this week
                  </span>
                </>
              )}
              {counts.attention > 0 && (
                <>
                  <span className="text-border-strong">·</span>
                  <span className="text-high">
                    <b className="font-mono font-medium tabular-nums">
                      {counts.attention}
                    </b>{" "}
                    needs attention
                  </span>
                </>
              )}
            </span>
          ) : (
            "Loading…"
          )
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push("/dashboard/discovery")}>
              <BinocularsIcon size={16} /> Discovery
            </Button>
            <Button onClick={() => setShowDialog(true)}>
              <PlusIcon size={16} /> Add competitor
            </Button>
          </>
        }
      />

      {competitors && competitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5" role="group" aria-label="Filter roster">
            <BucketChip
              label="All"
              count={counts.all}
              active={bucket === "all"}
              onClick={() => setBucket("all")}
            />
            {counts.moving > 0 && (
              <BucketChip
                label="Moving"
                count={counts.moving}
                active={bucket === "moving"}
                onClick={() => setBucket("moving")}
              />
            )}
            {counts.quiet > 0 && (
              <BucketChip
                label="Quiet"
                count={counts.quiet}
                active={bucket === "quiet"}
                onClick={() => setBucket("quiet")}
              />
            )}
            {counts.attention > 0 && (
              <BucketChip
                label="Needs attention"
                count={counts.attention}
                warn
                active={bucket === "attention"}
                onClick={() => setBucket("attention")}
              />
            )}
          </div>

          <div className="flex-1" />

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger size="sm" className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastMove">Last move</SelectItem>
              <SelectItem value="activity">Most active</SelectItem>
              <SelectItem value="overlap">Overlap</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative">
            <MagnifyingGlassIcon
              size={16}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
        </div>
      )}

      {competitors === null && <TableSkeleton rows={6} columns={5} />}

      {competitors && competitors.length === 0 && (
        <EmptyState
          icon={BuildingsIcon}
          title="No competitors"
          description="Add one yourself, or let Discovery suggest competitors for you."
          actions={
            <>
              <Button onClick={() => setShowDialog(true)}>
                <PlusIcon size={16} /> Add competitor
              </Button>
              <Button
                variant="secondary"
                onClick={() => router.push("/dashboard/discovery")}
              >
                <BinocularsIcon size={16} /> Explore Discovery
              </Button>
            </>
          }
        />
      )}

      {competitors && competitors.length > 0 && sorted.length === 0 && (
        <Card className="border-dashed px-6 py-10 text-center text-muted-foreground">
          <p className="mb-3 text-sm">No competitors match this view.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setBucket("all");
              setQuery("");
            }}
          >
            Clear filters
          </Button>
        </Card>
      )}

      {competitors && sorted.length > 0 && (
        <div className="@container">
          <div
            className={cn(
              GRID,
              "border-b border-border px-2 pb-2 text-meta font-medium text-muted-foreground",
            )}
          >
            <span />
            <span>Competitor</span>
            <span>Latest move</span>
            <ColumnLabel
              className="hidden @2xl:flex"
              tip="Signals in the last 7 days against the 7 before. The bars are one per day over 14 days."
            >
              Activity
            </ColumnLabel>
            <ColumnLabel
              className="hidden @5xl:flex"
              tip="How closely this competitor overlaps with your product (0 to 100)."
            >
              Overlap
            </ColumnLabel>
            <ColumnLabel
              className="hidden @4xl:flex"
              tip="Sources we are actively watching, and when the stalest one last answered."
            >
              Coverage
            </ColumnLabel>
            <span />
          </div>

          <AnimatePresence initial={false} mode="popLayout">
            {sorted.map((row) => (
              <motion.div key={row.id} {...feedItemMotion}>
                <CompetitorRow
                  row={row}
                  allProducts={allProducts}
                  onColor={(v) => void setColor(row.id, v)}
                  onDelete={() => setDeleteTarget(row)}
                />
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
              {deleting && <SpinnerIcon size={16} className="animate-spin" />}
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One competitor, answering three questions in the order an analyst asks them:
 * who are they, what did they just do, are we watching them properly.
 *
 * Fixed height and two text lines, so fifty rows keep one rhythm. State badges sit
 * inline after the name rather than stacking under it, which is what used to make
 * a row anywhere between 56 and 120px tall. The whole row navigates via a stretched
 * link on the name; everything else that is clickable lifts itself above it.
 */
function CompetitorRow({
  row,
  allProducts,
  onColor,
  onDelete,
}: {
  row: Row;
  allProducts: boolean;
  onColor: (value: string | null) => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const href = `/dashboard/competitors/${row.id}`;
  const cov = row.coverage;
  const live = cov.sources - cov.failing;

  return (
    <div
      className={cn(
        GRID,
        "group relative rounded-md border-b border-border px-2 py-2.5 transition-colors hover:bg-surface-2 focus-within:bg-surface-2",
      )}
    >
      <SeverityGauge severity={row.move && !row.stale ? row.move.severity : null} />

      <div className="flex min-w-0 items-center gap-2.5">
        <CompAvatar name={row.name} url={row.url} size={28} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={href}
              // Stretched link: the pseudo-element covers the row, so the whole
              // row navigates without nesting interactive elements inside an <a>.
              className="min-w-0 truncate rounded-sm text-dense font-semibold outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50"
              style={competitorNameColor(row.color)}
            >
              {row.name}
            </Link>
            {/* No freshness dot beside the name: the coverage cell owns that
                reading now, and a second dot on the same row said it twice while
                sitting under the row's navigation overlay, where its tooltip
                could never open. */}
            {row.pausedByPlan ? (
              <PausedByPlanBadge />
            ) : row.monitoringPaused ? (
              <MonitoringPausedBadge />
            ) : null}
            <AnalysisBadge analysis={row.analysis} />
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/url relative z-10 inline-flex min-w-0 items-center gap-1 font-mono text-meta text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="truncate underline-offset-2 group-hover/url:underline">
                {prettyUrl(row.url)}
              </span>
              <ArrowSquareOutIcon
                size={16}
                className="shrink-0 opacity-0 transition-opacity group-hover/url:opacity-100"
              />
            </a>
            {allProducts && (
              <ProductChips productIds={row.productIds} className="shrink-0" />
            )}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        {row.monitoringPaused ? (
          <span className="truncate text-dense text-muted-foreground">
            Monitoring is paused, so no sources are being scraped.
          </span>
        ) : row.move ? (
          <>
            <span
              className={cn(
                "truncate text-dense leading-snug",
                row.stale ? "text-muted-foreground" : "font-medium text-foreground",
              )}
            >
              {row.move.insight}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
              <CatText category={row.move.category} />
              <span aria-hidden className="text-border-strong">
                ·
              </span>
              <span className="font-mono tabular-nums">{shortAge(row.move.createdAt)}</span>
            </span>
          </>
        ) : (
          <>
            <span className="truncate text-dense text-muted-foreground">
              Nothing detected yet.
            </span>
            <span className="text-meta text-muted-foreground">
              Added <span className="font-mono tabular-nums">{shortAge(row.createdAt)}</span> ago
            </span>
          </>
        )}
      </div>

      <div className="hidden min-w-0 flex-col gap-1.5 @2xl:flex">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-dense font-semibold tabular-nums">
            {row.signals7d}
          </span>
          {row.signals7d > 0 ? (
            <DeltaPill delta={row.delta} />
          ) : (
            <span className="font-mono text-xs text-muted-foreground">—</span>
          )}
        </span>
        <ActivitySpark
          values={row.activity}
          label={`${row.signals7d} signals in the last 7 days`}
        />
      </div>

      <div className="hidden min-w-0 flex-col gap-1.5 @5xl:flex">
        {row.overlap != null ? (
          <>
            <span className="font-mono text-dense font-semibold tabular-nums">
              {row.overlap}
            </span>
            <span className="h-[3px] overflow-hidden rounded-sm bg-surface-3">
              <span
                className="block h-full bg-muted-foreground"
                style={{ width: `${row.overlap}%` }}
              />
            </span>
          </>
        ) : (
          <span className="text-dense text-muted-foreground">—</span>
        )}
      </div>

      <div className="hidden min-w-0 flex-col gap-0.5 text-xs @4xl:flex">
        {row.monitoringPaused ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-border-strong" />
            Paused
          </span>
        ) : cov.failing > 0 ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-high">
              <span className="size-1.5 shrink-0 rounded-full bg-high" />
              <span className="truncate">{sourceLabel(cov.failingSource)} blocked</span>
            </span>
            <span className="font-mono text-meta text-muted-foreground tabular-nums">
              {live} of {cov.sources} live
            </span>
          </>
        ) : cov.sources > 0 ? (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-positive" />
              {cov.sources} source{cov.sources > 1 ? "s" : ""} live
            </span>
            <span className="font-mono text-meta text-muted-foreground">
              {row.freshness?.lastScrapedAt
                ? `checked ${shortAge(row.freshness.lastScrapedAt)} ago`
                : "not scanned yet"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">No sources yet</span>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-end gap-0.5">
        <ColorQuickSet competitor={row} onChange={onColor} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`More actions for ${row.name}`}
              className="h-6 w-6 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <DotsThreeIcon size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => router.push(href)}>
              <ArrowRightIcon size={16} /> Open detail
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-critical focus:text-critical"
            >
              <TrashIcon size={16} /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function BucketChip({
  label,
  count,
  active,
  warn,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs outline-none transition-colors",
        "hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/70",
        active ? "border-border bg-surface-2 font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "font-mono text-meta tabular-nums",
          warn ? "text-high" : active ? "text-muted-foreground" : "text-text-subtle",
        )}
      >
        {count}
      </span>
    </button>
  );
}

// A column label that explains its own encoding once, in the header, instead of
// per row: the rows have no width to spare, and a tooltip inside a row would sit
// under the stretched navigation link anyway.
function ColumnLabel({
  children,
  tip,
  className,
}: {
  children: React.ReactNode;
  tip: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("w-fit cursor-help items-center", className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
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
  const productId = useProductScope() ?? undefined;
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
      await api.createCompetitor({ name, url, productId });
      track("competitor_added", { source: "manual" });
      await onAdded();
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
            Enter the name and URL. Monitoring starts as soon as it&apos;s created.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="competitor-name">Name</Label>
            <Input
              id="competitor-name"
              required
              maxLength={COMPETITOR_NAME_MAX_LENGTH}
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
          {err && <p className="text-sm text-critical">{err}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <SpinnerIcon size={16} className="animate-spin" />}
              {busy ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
