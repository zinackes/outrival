"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  Plus,
  RefreshCw,
  Loader2,
  ExternalLink,
  SlidersHorizontal,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ApiError, api, type CompetitorCandidate } from "@/lib/api";
import { emitCompetitorsChanged } from "@/lib/competitor-events";
import { toastApiError } from "@/lib/error-helpers";
import { ListError } from "@/components/outrival/list-error";
import {
  PaywallDialog,
  paywallFromError,
  tierLimitFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DetectionConfigSheet } from "@/components/outrival/detection-config-sheet";
import { PageHead } from "@/components/dashboard/page-head";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { GridCardsSkeleton } from "@/components/dashboard/skeletons";
import { feedItemMotion } from "@/lib/motion";

type SortMode = "overlap" | "recent";
type Tab = "new" | "dismissed";

export function DiscoveryView({
  initialData = null,
}: {
  initialData?: {
    candidates: CompetitorCandidate[];
    counts: { new: number; dismissed: number };
    discoveryFresh: boolean;
  } | null;
} = {}) {
  const [items, setItems] = useState<CompetitorCandidate[] | null>(
    initialData?.candidates ?? null,
  );
  const [error, setError] = useState<unknown>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>("overlap");
  const [minOverlap, setMinOverlap] = useState(0);
  const [discoveryFresh, setDiscoveryFresh] = useState(
    initialData?.discoveryFresh ?? false,
  );
  const [tab, setTab] = useState<Tab>("new");
  const [counts, setCounts] = useState<{ new: number; dismissed: number } | null>(
    initialData?.counts ?? null,
  );
  // Seed covers the "new" tab + staleness → skip both mount fetches once.
  const seededRef = useRef(initialData !== null);
  // Read the live tab inside async callbacks (a toast's Undo can fire after a switch).
  const tabRef = useRef<Tab>("new");

  const load = useCallback(async (which: Tab) => {
    setError(null);
    setItems(null);
    try {
      const { candidates, counts } = await api.listCandidates(which);
      setItems(candidates);
      setCounts(counts);
    } catch (e) {
      setError(e);
    }
  }, []);

  // Keep the tab badges in sync with optimistic list mutations (a server reload only
  // happens on tab switch / refresh). Clamps at 0 so a race can't show a negative.
  const bumpCounts = useCallback(
    (delta: { new?: number; dismissed?: number }) =>
      setCounts((c) =>
        c
          ? {
              new: Math.max(0, c.new + (delta.new ?? 0)),
              dismissed: Math.max(0, c.dismissed + (delta.dismissed ?? 0)),
            }
          : c,
      ),
    [],
  );

  // Intelligent rate limiting (patch-22): re-running discovery when nothing changed
  // is friction, not blocked. If the last run is recent and the profile is unchanged,
  // nudge the user to edit their profile instead — but let them search anyway.
  function requestDetection() {
    if (discoveryFresh) {
      toast.info("Already up to date", {
        description:
          "No profile changes since the last search — new suggestions are unlikely. Edit your product profile for fresh matches.",
        action: { label: "Search anyway", onClick: () => void runDetection() },
      });
      return;
    }
    void runDetection();
  }

  async function runDetection() {
    setRefreshing(true);
    try {
      const { detected } = await api.detectCandidates();
      // New candidates land in the "new" queue — make sure that's what's shown.
      if (tabRef.current === "new") {
        await load("new");
      } else {
        setTab("new");
      }
      if (detected > 0) {
        toast.success(
          `${detected} new competitor${detected > 1 ? "s" : ""} detected`,
        );
      } else {
        toast.info("No new competitors found");
      }
    } catch (e) {
      const tierLimit = tierLimitFromError(e);
      if (tierLimit) {
        // Monthly discovery quota (per tier) — not the short anti-spam cooldown.
        const limit = tierLimit.limit ?? 0;
        toast.error("Monthly discovery limit reached", {
          description: `Your plan includes ${limit} discover${limit === 1 ? "y" : "ies"} per month. It resets next month.`,
          action: tierLimit.upgradeHint
            ? {
                label: "View plans",
                onClick: () => {
                  window.location.href = "/dashboard/settings/billing";
                },
              }
            : undefined,
        });
      } else if (e instanceof ApiError && e.status === 429) {
        const retryInSec = Number(e.data.retryInSec) || 0;
        const mins = Math.max(1, Math.ceil(retryInSec / 60));
        toast.error(`Try again in ~${mins} min`, {
          description: "Detection is rate-limited to avoid excess API costs.",
        });
      } else if (e instanceof ApiError && e.data.error === "missing_profile") {
        toast.error("Complete onboarding first", {
          description: "Your product profile is required to detect competitors.",
        });
      } else {
        toastApiError(e, { title: "Detection failed" });
      }
    } finally {
      setRefreshing(false);
    }
  }

  // Staleness is tab-independent — fetch once on mount.
  useEffect(() => {
    if (initialData) return; // server-seeded
    api
      .getDiscoveryStaleness()
      .then((s) => setDiscoveryFresh(!s.needsRediscovery))
      .catch(() => setDiscoveryFresh(false)); // best-effort — fall back to always-enabled
  }, []);

  useEffect(() => {
    tabRef.current = tab;
    // Server-seeded first paint for the "new" tab → skip the redundant fetch.
    if (seededRef.current) {
      seededRef.current = false;
      return;
    }
    void load(tab);
  }, [tab, load]);

  // Quality feedback (patch-21): tracking a suggestion is an implicit "useful"
  // verdict, dismissing it a "not useful" one. Best-effort — never block the
  // primary action on the feedback write.
  function recordDiscoveryFeedback(id: string, verdict: "useful" | "not_useful") {
    void api
      .submitQualityFeedback({ targetType: "discovery_suggestion", targetId: id, verdict })
      .catch(() => {});
  }

  async function add(id: string) {
    setActingId(id);
    try {
      await api.addCandidate(id);
      recordDiscoveryFeedback(id, "useful");
      emitCompetitorsChanged();
      setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
      bumpCounts({ new: -1 });
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
      } else {
        setError(e);
      }
    } finally {
      setActingId(null);
    }
  }

  // Optimistic dismiss with an undo window (quick triage). The card leaves the list
  // immediately; the "not useful" feedback is only recorded once the toast auto-closes,
  // so an Undo within the window leaves no trace in the relevance learning.
  async function dismiss(id: string) {
    const item = items?.find((c) => c.id === id);
    if (!item) return;
    setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
    bumpCounts({ new: -1, dismissed: 1 });
    try {
      await api.dismissCandidate(id);
    } catch (e) {
      setItems((prev) => [...(prev ?? []), item]); // rollback
      bumpCounts({ new: 1, dismissed: -1 });
      toastApiError(e, { title: "Dismiss failed" });
      return;
    }
    toast("Suggestion dismissed", {
      action: { label: "Undo", onClick: () => void undoDismiss([item]) },
      onAutoClose: () => recordDiscoveryFeedback(id, "not_useful"),
      duration: 6000,
    });
  }

  // Bulk dismiss (Dismiss all / below threshold). No per-item feedback: clearing the
  // queue in one gesture is a weaker signal than a deliberate single judgment.
  async function dismissMany(targets: CompetitorCandidate[]) {
    if (targets.length === 0) return;
    const idSet = new Set(targets.map((t) => t.id));
    setItems((prev) => prev?.filter((c) => !idSet.has(c.id)) ?? null);
    bumpCounts({ new: -targets.length, dismissed: targets.length });
    try {
      await api.dismissCandidates([...idSet]);
    } catch (e) {
      setItems((prev) => [...(prev ?? []), ...targets]); // rollback
      bumpCounts({ new: targets.length, dismissed: -targets.length });
      toastApiError(e, { title: "Dismiss failed" });
      return;
    }
    toast(`${targets.length} suggestion${targets.length > 1 ? "s" : ""} dismissed`, {
      action: { label: "Undo", onClick: () => void undoDismiss(targets) },
      duration: 6000,
    });
  }

  // Send dismissed candidates back to "new". Shared by the Undo toast (New tab) and the
  // Restore button (Dismissed tab) — the local effect depends on which list is showing,
  // read fresh via tabRef so a tab switch mid-window can't misplace a row.
  async function undoDismiss(targets: CompetitorCandidate[]) {
    const ids = new Set(targets.map((t) => t.id));
    try {
      await api.restoreCandidates([...ids]);
      bumpCounts({ new: ids.size, dismissed: -ids.size });
      setItems((prev) => {
        const base = prev ?? [];
        if (tabRef.current === "new") {
          const present = new Set(base.map((c) => c.id));
          return [...base, ...targets.filter((t) => !present.has(t.id))]; // re-sorts via `view`
        }
        return base.filter((c) => !ids.has(c.id)); // no longer dismissed
      });
    } catch (e) {
      toastApiError(e, { title: "Undo failed" });
    }
  }

  // Explicit restore from the Dismissed tab: optimistic removal + a toast that jumps back.
  async function restore(item: CompetitorCandidate) {
    setItems((prev) => prev?.filter((c) => c.id !== item.id) ?? null);
    bumpCounts({ new: 1, dismissed: -1 });
    try {
      await api.restoreCandidates([item.id]);
    } catch (e) {
      setItems((prev) => [...(prev ?? []), item]); // rollback
      bumpCounts({ new: -1, dismissed: 1 });
      toastApiError(e, { title: "Restore failed" });
      return;
    }
    toast("Moved back to review", {
      action: { label: "View", onClick: () => setTab("new") },
    });
  }

  if (error && items === null) return <ListError error={error} />;

  const view = (items ?? [])
    .filter((c) => (c.overlapScore ?? 0) >= minOverlap)
    .sort((a, b) =>
      sort === "overlap"
        ? (b.overlapScore ?? -1) - (a.overlapScore ?? -1)
        : new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime(),
    );
  const belowThreshold = (items ?? []).filter((c) => (c.overlapScore ?? 0) < 70);

  return (
    <div className="space-y-6">
      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      <PageHead
        title="Discovery"
        sub={
          tab === "dismissed"
            ? "Dismissed suggestions — restore any to send it back to review."
            : items && items.length > 0
              ? `${items.length} new competitor${items.length > 1 ? "s" : ""} identified by Exa.ai.`
              : "Automatic detection of similar competitors by AI."
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfigOpen(true)}
            >
              <SlidersHorizontal size={13} />
              Configure
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={requestDetection}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              {refreshing ? "Detecting…" : "Refresh"}
            </Button>
          </>
        }
      />

      <DetectionConfigSheet open={configOpen} onOpenChange={setConfigOpen} />

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={tab}
        onValueChange={(v) => v && setTab(v as Tab)}
        className="w-fit"
      >
        <ToggleGroupItem value="new" className="gap-1.5">
          New
          {counts != null && (
            <span className="text-meta tabular-nums text-muted-foreground">
              {counts.new}
            </span>
          )}
        </ToggleGroupItem>
        <ToggleGroupItem value="dismissed" className="gap-1.5">
          Dismissed
          {counts != null && (
            <span className="text-meta tabular-nums text-muted-foreground">
              {counts.dismissed}
            </span>
          )}
        </ToggleGroupItem>
      </ToggleGroup>

      {items === null && (
        <GridCardsSkeleton cards={6} minWidth={320} cardHeight={220} />
      )}

      {items && items.length === 0 && (
        <Card className="px-6 py-12 text-center text-muted-foreground border-dashed">
          {tab === "dismissed" ? (
            <>
              <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
                Nothing dismissed
              </div>
              <div className="text-sm max-w-[380px] mx-auto">
                Suggestions you dismiss land here so you can restore them later.
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
                No new competitors to review
              </div>
              <div className="text-sm max-w-[380px] mx-auto">
                Detection runs every Sunday evening. The next candidates will
                appear here as soon as they cross the configured overlap threshold.
              </div>
            </>
          )}
        </Card>
      )}

      {items && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={sort}
            onValueChange={(v) => v && setSort(v as SortMode)}
          >
            <ToggleGroupItem value="overlap">Overlap</ToggleGroupItem>
            <ToggleGroupItem value="recent">Recent</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(minOverlap)}
            onValueChange={(v) => v !== "" && setMinOverlap(Number(v))}
          >
            <ToggleGroupItem value="0">All</ToggleGroupItem>
            <ToggleGroupItem value="70">≥ 70</ToggleGroupItem>
            <ToggleGroupItem value="85">≥ 85</ToggleGroupItem>
          </ToggleGroup>

          {tab === "new" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="ml-auto">
                  <Trash2 size={13} />
                  Dismiss…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={view.length === 0}
                  onClick={() => void dismissMany(view)}
                >
                  Dismiss all visible ({view.length})
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={belowThreshold.length === 0}
                  onClick={() => void dismissMany(belowThreshold)}
                >
                  Dismiss below 70 ({belowThreshold.length})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {items && items.length > 0 && view.length === 0 && (
        <Card className="px-6 py-10 text-center text-sm text-muted-foreground border-dashed">
          No candidate above this overlap threshold.
        </Card>
      )}

      {view.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
          <AnimatePresence initial={false} mode="popLayout">
          {view.map((c) => {
            const name = c.title ?? c.url.replace(/^https?:\/\//, "");
            const overlap =
              c.overlapScore != null ? Math.round(c.overlapScore) : null;
            return (
              <motion.div key={c.id} {...feedItemMotion}>
              <Card>
                <div className="p-5 flex flex-col flex-1">
                  <div className="flex items-center gap-2.5 mb-3.5">
                    <CompAvatar name={name} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-content">{name}</div>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 min-w-0 text-muted-foreground hover:text-primary transition-colors text-meta font-mono"
                      >
                        <span className="truncate">{c.url}</span>
                        <ExternalLink size={10} className="shrink-0" />
                      </a>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.source === "onboarding" && (
                        <StatusPill status="neutral">from setup</StatusPill>
                      )}
                      {tab === "dismissed" ? (
                        <StatusPill status="neutral">dismissed</StatusPill>
                      ) : (
                        <StatusPill status="warn">new</StatusPill>
                      )}
                    </div>
                  </div>

                  {overlap != null && (
                    <div className="mb-3.5">
                      <div className="flex justify-between text-meta text-muted-foreground mb-1.5">
                        <span>Estimated overlap</span>
                        <span className="tabular-nums font-mono">
                          {overlap}/100
                        </span>
                      </div>
                      <div className="h-2 bg-background rounded border border-border overflow-hidden">
                        <span
                          className="block h-full bg-primary rounded"
                          style={{ width: `${overlap}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {c.reason && (
                    <p className="text-sm leading-snug m-0 mb-3.5 text-muted-foreground">
                      <span className="text-primary text-meta font-medium capitalize mr-1.5">
                        reason
                      </span>
                      {c.reason}
                    </p>
                  )}

                  <div className="flex justify-between items-center text-meta text-muted-foreground mb-3.5 font-mono mt-auto">
                    <span>via Exa.ai</span>
                    <span>
                      detected {formatDistanceToNow(new Date(c.firstSeenAt), { addSuffix: true })}
                    </span>
                  </div>

                  {tab === "dismissed" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => void restore(c)}
                    >
                      <RotateCcw size={11} />
                      Restore
                    </Button>
                  ) : (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={actingId === c.id}
                        onClick={() => add(c.id)}
                      >
                        {actingId === c.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Plus size={11} />
                        )}
                        Track
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={actingId === c.id}
                            onClick={() => dismiss(c.id)}
                            aria-label="Dismiss"
                          >
                            <X size={11} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Dismiss</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </Card>
              </motion.div>
            );
          })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
