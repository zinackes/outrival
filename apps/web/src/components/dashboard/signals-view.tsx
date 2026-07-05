"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  keepPreviousData,
  type InfiniteData,
} from "@tanstack/react-query";
import { signalsFeedQuery, signalsFacetsQuery } from "@/lib/queries";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import {
  Download,
  Check,
  Search,
  SlidersHorizontal,
  X,
  ChevronDown,
  ArrowUpDown,
  Keyboard,
  Inbox,
  FlaskConical,
  ArrowLeft,
  ArrowUpRight,
  Radar,
  Rows3,
  ListTodo,
  EyeOff,
  Clock,
} from "lucide-react";
import {
  startOfWeek,
  endOfWeek,
  formatDistanceToNow,
  format,
  isToday,
  isYesterday,
} from "date-fns";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  api,
  type Signal,
  type ActionStatus,
  type SavedViewFilters,
  type SignalsFeedParams,
  type SignalsPage,
} from "@/lib/api";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SavedViewsMenu } from "./saved-views-menu";
import { useSetAskContext, type AskEntity } from "./ask-context";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { feedItemMotion } from "@/lib/motion";
import { PageHead } from "./page-head";
import { SignalsBrief } from "./signals-brief";
import { SignalCard, SNOOZE_PRESETS } from "./signal-card";
import { SignalEvidence } from "@/components/outrival/signal-evidence";
import { SignalRow, BatchRow } from "./signal-row";
import { SeverityBadge } from "./severity-pill";
import { EmptyState } from "./empty-state";
import { SampleBanner } from "./sample-banner";
import { ShortcutsHelp } from "./shortcuts-help";
import { ListRowsSkeleton } from "./skeletons";
import { ListError } from "@/components/outrival/list-error";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";
import { useSampleMode } from "@/hooks/use-sample-mode";
import { getSampleData } from "@/lib/sample-data";

type Sev = Signal["severity"];
type QuickView = "all" | "alerts" | "unread" | "week" | "critical" | "actions";

// patch-29 — "Alerts" surfaces the urgent feed (critical + high) as a first-class
// tab, replacing the standalone /dashboard/alerts page in the navigation.
// Phase B — "Actions" surfaces the intel→action board (todo + doing).
const QUICK_VIEWS: { value: QuickView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "alerts", label: "Alerts" },
  { value: "unread", label: "Unread" },
  { value: "week", label: "This week" },
  { value: "critical", label: "Critical" },
  { value: "actions", label: "Actions" },
];

const SEVERITIES: Sev[] = ["critical", "high", "medium", "low"];

const SEV_DOT: Record<Sev, string> = {
  critical: "bg-critical",
  high: "bg-high",
  medium: "bg-medium",
  low: "bg-muted-foreground/45",
};

const SEV_RANK: Record<Sev, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// Master-list grouping (client-only — pure presentation, never touches feedParams
// so it costs no refetch). Persisted in ?group= so a refresh keeps the view.
const GROUP_MODES = ["none", "competitor", "day"] as const;
type GroupMode = (typeof GROUP_MODES)[number];
const GROUP_LABEL: Record<GroupMode, string> = {
  none: "No grouping",
  competitor: "By competitor",
  day: "By day",
};

// Bulk "Track" targets — mirrors SignalCard's ACTION_OPTIONS, applied to a selection.
const TRACK_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "dismissed", label: "Dismissed" },
];

// Day bucket for the "By day" grouping — a stable key + a human label.
function dayGroup(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  return {
    key: format(d, "yyyy-MM-dd"),
    label: isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "MMM d"),
  };
}

// A feed row is either a standalone signal or a batch of similar ones (patch-26)
// collapsed under a single summary card.
type FeedItem =
  | { kind: "single"; signal: Signal }
  | { kind: "batch"; batchId: string; summary: string | null; count: number; signals: Signal[] };

function parseSet(s: string | null): Set<string> {
  if (!s) return new Set();
  return new Set(s.split(",").filter(Boolean));
}

function serializeSet(set: Set<string>): string | null {
  if (!set.size) return null;
  return Array.from(set).join(",");
}

export function SignalsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Sample / demo mode shared with the Overview (Step 0). When on, the feed reads
  // the fixed fictional dataset and the detail renders read-only — no API writes.
  const [sample, setSample] = useSampleMode();

  const [helpOpen, setHelpOpen] = useState(false);
  // Tracks whether the desktop default-selection has run, so deselecting (Esc)
  // doesn't keep snapping back to the first row.
  const focusedRef = useRef<string | null>(null);

  // Collapsed group keys (client-only). Multi-select (checkboxes / x / bulk bar) is
  // orthogonal to the single "open in detail" focus: `selected` drives bulk actions,
  // `focusedId` still drives the detail pane. lastSelectedRef anchors shift-click ranges.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);

  const focusId = searchParams.get("focus");
  const quickView = (searchParams.get("view") as QuickView) || "all";
  const group = (GROUP_MODES as readonly string[]).includes(
    searchParams.get("group") ?? "",
  )
    ? (searchParams.get("group") as GroupMode)
    : "none";
  const sev = useMemo(() => parseSet(searchParams.get("severity")) as Set<Sev>, [searchParams]);
  const cat = useMemo(() => parseSet(searchParams.get("category")), [searchParams]);
  const comp = useMemo(() => parseSet(searchParams.get("competitor")), [searchParams]);
  const query = searchParams.get("q") ?? "";

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  // Debounced search: type into local state for instant feedback, but write the URL
  // (which refetches the feed + facets server-side) at most once per 300ms instead of
  // on every keystroke. Re-syncs when `q` changes externally (e.g. Clear filters).
  const [searchInput, setSearchInput] = useState(query);
  useEffect(() => {
    setSearchInput(query);
  }, [query]);
  useEffect(() => {
    if (searchInput === query) return;
    const t = setTimeout(() => setParam({ q: searchInput || null }), 300);
    return () => clearTimeout(t);
  }, [searchInput, query, setParam]);

  // patch-28 — scope the feed to the active product (cookie-backed switcher, URL
  // ?product= overrides); absent = aggregate "All products".
  const productId = useProductScope();

  // P0 — feed ordering. Default "threat" (server ranks by severity × overlap ×
  // relevance); "recent" restores the chronological feed. Server-side, so changing
  // it re-fetches.
  const sort = searchParams.get("sort") === "recent" ? "recent" : "threat";

  // Debounce the search box so typing doesn't refetch the server feed on every
  // keystroke — the input stays instant (URL param), only the query hitting the server
  // is delayed.
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Every feed filter now resolves server-side. Build the params so the "no filters"
  // state is exactly { productId?, sort } — matching the SSR seed key (signals/page.tsx)
  // so the first page hydrates without a client refetch. Arrays sorted so selection
  // order doesn't churn the query key.
  const feedParams = useMemo<SignalsFeedParams>(() => {
    const p: SignalsFeedParams = { sort };
    if (productId) p.productId = productId;
    if (quickView !== "all") p.view = quickView;
    if (cat.size) p.categories = Array.from(cat).sort();
    if (comp.size) p.competitors = Array.from(comp).sort();
    if (sev.size) p.severities = Array.from(sev).sort();
    if (debouncedQuery) p.q = debouncedQuery;
    return p;
  }, [sort, productId, quickView, cat, comp, sev, debouncedQuery]);

  const queryClient = useQueryClient();
  const sampleData = useMemo(() => getSampleData(), []);
  const feedOpts = signalsFeedQuery(feedParams);
  // Poll every 30s so a freshly-generated signal lands on its own; keepPreviousData
  // avoids a skeleton flash when filters/sort change. Disabled in sample mode (fixtures).
  const feedQ = useInfiniteQuery({
    ...feedOpts,
    enabled: !sample,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  // Facets back the tab counts + the filter dropdowns — product-scoped, filter-agnostic,
  // so switching a tab never recounts. Polled alongside the feed.
  const facetsQ = useQuery({
    ...signalsFacetsQuery(productId ?? undefined),
    enabled: !sample,
    refetchInterval: 30_000,
  });
  const loadedPages = feedQ.data?.pages;
  const signals = sample
    ? sampleData.signals
    : loadedPages
      ? loadedPages.flatMap((pg) => pg.signals)
      : null;
  // Total matching the current filters (from the server, whole set); sample counts its
  // fixtures.
  const total = sample
    ? sampleData.signals.length
    : (loadedPages?.[0]?.total ?? signals?.length ?? 0);
  const err = feedQ.error;

  // Optimistic write-through to the loaded pages (mark-read/unread, action status).
  // The updaters are id-keyed, so applying per page == applying to the flat list.
  function mutateSignals(updater: (prev: Signal[]) => Signal[]) {
    queryClient.setQueryData<InfiniteData<SignalsPage>>(feedOpts.queryKey, (data) =>
      data
        ? { ...data, pages: data.pages.map((pg) => ({ ...pg, signals: updater(pg.signals) })) }
        : data,
    );
  }

  async function markRead(id: string) {
    mutateSignals((prev) => prev.map((s) => (s.id === id ? { ...s, isRead: true } : s)));
    if (sample) return;
    await api.markSignalRead(id);
  }

  async function markUnread(id: string) {
    mutateSignals((prev) => prev.map((s) => (s.id === id ? { ...s, isRead: false } : s)));
    if (sample) return;
    try {
      await api.markSignalRead(id, false);
    } catch {
      toast.error("Couldn't mark unread. Try again.");
    }
  }

  // Mark all read — full scope, server-side (not just the loaded pages). The server
  // returns the flipped ids (capped) so Undo reverts exactly those. Refetch facets (the
  // unread count) + the feed (the unread-first tier reorders the just-read rows).
  async function markAllRead() {
    if (sample) {
      const idSet = new Set(sampleData.signals.filter((s) => !s.isRead).map((s) => s.id));
      if (!idSet.size) return;
      mutateSignals((prev) => prev.map((s) => (idSet.has(s.id) ? { ...s, isRead: true } : s)));
      toast.success(`${idSet.size} signal${idSet.size > 1 ? "s" : ""} marked read`);
      return;
    }
    // Optimistic: flip every loaded unread row read immediately.
    mutateSignals((prev) => prev.map((s) => (s.isRead ? s : { ...s, isRead: true })));
    try {
      const res = await api.markAllSignalsRead(feedParams);
      queryClient.invalidateQueries({ queryKey: ["signals", "facets"] });
      queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
      if (res.count === 0) return;
      const flipped = res.ids;
      toast.success(
        `${res.count} signal${res.count > 1 ? "s" : ""} marked read`,
        flipped && flipped.length
          ? {
              action: {
                label: "Undo",
                onClick: () => {
                  api
                    .setSignalsRead(flipped, false)
                    .then(() => {
                      queryClient.invalidateQueries({ queryKey: ["signals", "facets"] });
                      queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
                    })
                    .catch(() => toast.error("Couldn't undo. Some signals stay read."));
                },
              },
            }
          : undefined,
      );
    } catch {
      toast.error("Couldn't mark all read. Try again.");
      queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
    }
  }

  // Intel → action loop (Phase B): SignalCard persists the status; keep the local
  // array in sync so the "Actions" tab and its count update immediately.
  function onActionChange(id: string, status: ActionStatus | null) {
    mutateSignals((prev) => prev.map((s) => (s.id === id ? { ...s, actionStatus: status } : s)));
  }

  // The real feed is already filtered server-side → passthrough. Sample mode reads the
  // fixtures (not server-filtered), so it keeps the client-side predicates.
  const filtered = useMemo(() => {
    if (!signals) return [];
    if (!sample) return signals;
    const q = query.toLowerCase();
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
    return signals.filter((s) => {
      if (quickView === "unread" && s.isRead) return false;
      if (
        quickView === "alerts" &&
        s.severity !== "critical" &&
        s.severity !== "high"
      )
        return false;
      if (quickView === "critical" && s.severity !== "critical") return false;
      if (
        quickView === "actions" &&
        s.actionStatus !== "todo" &&
        s.actionStatus !== "doing"
      )
        return false;
      if (quickView === "week") {
        const t = new Date(s.createdAt).getTime();
        if (t < weekStart || t > weekEnd) return false;
      }
      if (sev.size && !sev.has(s.severity)) return false;
      if (cat.size && !cat.has(s.category)) return false;
      if (comp.size && !comp.has(s.competitorId)) return false;
      if (
        q &&
        !s.insight.toLowerCase().includes(q) &&
        !s.competitorName.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [signals, sample, sev, cat, comp, quickView, query]);

  // One signal per row and exactly ONE card in the detail — batch collapsing is
  // intentionally disabled. It grouped signals by `batchedIntoId`, which could pile
  // several (even unrelated, cross-competitor) cards into the detail pane; the feed
  // must always open a single signal. Every row is its own single-card detail, so
  // the batch render branches below never fire.
  const feedItems = useMemo<FeedItem[]>(
    () => filtered.map((signal) => ({ kind: "single", signal })),
    [filtered],
  );

  // Grouped view of the feed (client-only). group="none" → a single implicit group
  // holding every item (same order as the flat feed). Groups keep first-appearance
  // order so the server's threat/recent ranking still drives the top of the list.
  const groups = useMemo<{ key: string; label: string; items: FeedItem[] }[]>(() => {
    if (group === "none") return [{ key: "__all", label: "", items: feedItems }];
    const map = new Map<string, { key: string; label: string; items: FeedItem[] }>();
    const order: string[] = [];
    for (const it of feedItems) {
      const sig = it.kind === "single" ? it.signal : it.signals[0]!;
      const { key, label } =
        group === "competitor"
          ? { key: sig.competitorId, label: sig.competitorName }
          : dayGroup(sig.createdAt);
      let g = map.get(key);
      if (!g) {
        g = { key, label, items: [] };
        map.set(key, g);
        order.push(key);
      }
      g.items.push(it);
    }
    return order.map((k) => map.get(k)!);
  }, [feedItems, group]);

  // Master-detail nav: one id per feed item — a batch is a single selectable row
  // whose members render together in the detail pane. Selection (j/k or click)
  // drives the right pane; no inline expansion to traverse. Runs over the VISIBLE
  // rows only, so j/k skips rows hidden inside a collapsed group.
  const navIds = useMemo(() => {
    const out: string[] = [];
    for (const g of groups) {
      if (group !== "none" && collapsed.has(g.key)) continue;
      for (const it of g.items)
        out.push(it.kind === "single" ? it.signal.id : `batch:${it.batchId}`);
    }
    return out;
  }, [groups, collapsed, group]);

  // Selectable ids = visible single-signal rows (batches aren't individually selectable).
  const selectableIds = useMemo(
    () => navIds.filter((id) => !id.startsWith("batch:")),
    [navIds],
  );

  const selectionActive = selected.size > 0;

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Toggle a row's selection. `range` (shift-click) selects every row between the
  // last-touched row and this one along the visible order.
  function toggleSelectId(id: string, range: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const anchor = lastSelectedRef.current;
      if (range && anchor && anchor !== id) {
        const a = selectableIds.indexOf(anchor);
        const b = selectableIds.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(selectableIds[i]!);
          lastSelectedRef.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      lastSelectedRef.current = id;
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    lastSelectedRef.current = null;
  }

  // Bulk read/unread — one server call (setSignalsRead) over the selection.
  async function bulkMarkRead(read: boolean) {
    const ids = [...selected];
    if (!ids.length) return;
    const idSet = new Set(ids);
    mutateSignals((prev) =>
      prev.map((s) => (idSet.has(s.id) ? { ...s, isRead: read } : s)),
    );
    clearSelection();
    if (sample) return;
    try {
      await api.setSignalsRead(ids, read);
      queryClient.invalidateQueries({ queryKey: ["signals", "facets"] });
    } catch {
      toast.error("Couldn't update those signals. Try again.");
      queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
    }
  }

  // Bulk track/dismiss — no bulk endpoint, so fan out setSignalAction per id.
  async function bulkSetAction(status: ActionStatus | null) {
    const ids = [...selected];
    if (!ids.length) return;
    const idSet = new Set(ids);
    const n = ids.length;
    mutateSignals((prev) =>
      prev.map((s) => (idSet.has(s.id) ? { ...s, actionStatus: status } : s)),
    );
    clearSelection();
    if (sample) {
      toast.success(`${n} signal${n > 1 ? "s" : ""} updated`);
      return;
    }
    try {
      await Promise.all(ids.map((id) => api.setSignalAction(id, status)));
      toast.success(
        `${n} signal${n > 1 ? "s" : ""} ${status ? "updated" : "cleared"}`,
      );
    } catch {
      toast.error("Couldn't update those signals. Try again.");
      queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
    }
  }

  // Remove signals from the loaded feed cache (optimistic hide). Keeps per-page
  // totals roughly right; the next poll reconciles with the server, which filters
  // hiddenForUserAt out of the feed anyway.
  function removeFromFeed(ids: Set<string>) {
    queryClient.setQueryData<InfiniteData<SignalsPage>>(
      feedOpts.queryKey,
      (data) => {
        if (!data) return data;
        let removed = 0;
        const pages = data.pages.map((pg) => {
          const keep = pg.signals.filter((s) => !ids.has(s.id));
          removed += pg.signals.length - keep.length;
          return { ...pg, signals: keep };
        });
        return {
          ...data,
          pages: pages.map((pg) => ({
            ...pg,
            total: Math.max(0, pg.total - removed),
          })),
        };
      },
    );
  }

  // If the open signal is being dismissed, advance to the next surviving visible row
  // so the detail pane never points at a removed signal.
  function nextSelectionAfter(removing: Set<string>): string | null {
    if (!selectedId || !removing.has(selectedId)) return selectedId;
    const idx = navIds.indexOf(selectedId);
    for (let i = idx + 1; i < navIds.length; i++)
      if (!removing.has(navIds[i]!)) return navIds[i]!;
    for (let i = idx - 1; i >= 0; i--)
      if (!removing.has(navIds[i]!)) return navIds[i]!;
    return null;
  }

  // Dismiss as noise — a not_useful verdict hides the signal AND trains the org's
  // relevance threshold (both server-side, patch-26). Optimistic + undoable: the
  // toast's Undo deletes the feedback, which un-hides and re-surfaces the signal.
  async function dismissSignals(ids: string[]) {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const nextSel = nextSelectionAfter(idSet);
    removeFromFeed(idSet);
    if (nextSel !== selectedId) setFocusedId(nextSel);
    clearSelection();
    const n = ids.length;
    if (sample) {
      toast.success(`${n} signal${n > 1 ? "s" : ""} dismissed`);
      return;
    }
    let feedbackIds: string[];
    try {
      const results = await Promise.all(
        ids.map((id) =>
          api.submitQualityFeedback({
            targetType: "signal",
            targetId: id,
            verdict: "not_useful",
            reason: "irrelevant",
          }),
        ),
      );
      feedbackIds = results.map((r) => r.feedbackId);
      queryClient.invalidateQueries({ queryKey: ["signals", "facets"] });
    } catch {
      toast.error("Couldn't dismiss those signals. Try again.");
      queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
      return;
    }
    toast.success(
      `${n} signal${n > 1 ? "s" : ""} dismissed — Outrival will show fewer like ${
        n > 1 ? "these" : "this"
      }`,
      {
        action: {
          label: "Undo",
          onClick: () => {
            Promise.all(feedbackIds.map((fid) => api.deleteQualityFeedback(fid)))
              .then(() => {
                queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
                queryClient.invalidateQueries({ queryKey: ["signals", "facets"] });
              })
              .catch(() =>
                toast.error("Couldn't undo. Some signals stay dismissed."),
              );
          },
        },
      },
    );
  }

  // Snooze — hide the signal(s) from the feed until `ms` from now; they reappear on
  // the next poll (the feed filters snoozed_until <= now(), no cron). Optimistic +
  // undoable, reusing the same removal/selection helpers as dismiss.
  async function snoozeSignals(ids: string[], ms: number) {
    if (!ids.length) return;
    const until = new Date(Date.now() + ms).toISOString();
    const idSet = new Set(ids);
    const nextSel = nextSelectionAfter(idSet);
    removeFromFeed(idSet);
    if (nextSel !== selectedId) setFocusedId(nextSel);
    clearSelection();
    const n = ids.length;
    if (sample) {
      toast.success(`${n} signal${n > 1 ? "s" : ""} snoozed`);
      return;
    }
    try {
      await Promise.all(ids.map((id) => api.snoozeSignal(id, until)));
      queryClient.invalidateQueries({ queryKey: ["signals", "facets"] });
    } catch {
      toast.error("Couldn't snooze those signals. Try again.");
      queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
      return;
    }
    toast.success(`${n} signal${n > 1 ? "s" : ""} snoozed`, {
      action: {
        label: "Undo",
        onClick: () => {
          Promise.all(ids.map((id) => api.snoozeSignal(id, null)))
            .then(() => {
              queryClient.invalidateQueries({ queryKey: feedOpts.queryKey });
              queryClient.invalidateQueries({ queryKey: ["signals", "facets"] });
            })
            .catch(() => toast.error("Couldn't undo the snooze."));
        },
      },
    });
  }

  const elementId = useCallback(
    (id: string) =>
      id.startsWith("batch:") ? `row-batch-${id.slice(6)}` : `row-${id}`,
    [],
  );

  // App-specific keys; nav (j/k/arrows/Esc) is owned by the hook. Defined inline
  // (the hook reads the latest via a ref) so it always sees current state.
  function onKey(key: string, fid: string | null): boolean | void {
    if (key === "?") {
      setHelpOpen(true);
      return true;
    }
    if (key === "/") {
      document.getElementById("signals-search")?.focus();
      return true;
    }
    if (key >= "1" && key <= "6") {
      const v = QUICK_VIEWS[Number(key) - 1];
      if (v) setParam({ view: v.value === "all" ? null : v.value });
      return true;
    }
    if (!fid || fid.startsWith("batch:")) return false;
    const sig = (signals ?? []).find((s) => s.id === fid);
    if (!sig) return false;
    switch (key) {
      case "Enter":
      case "o":
        router.push(`/dashboard/competitors/${sig.competitorId}`);
        return true;
      case "r":
        if (sig.isRead) markUnread(fid);
        else markRead(fid);
        return true;
      case "x":
        toggleSelectId(fid, false);
        return true;
    }
    return false;
  }

  const { focusedId, setFocusedId } = useListKeyboardNav({
    ids: navIds,
    elementId,
    onKey,
  });
  const selectedId = focusedId;
  // The single Tab entry point into the listbox (roving tabindex): the open row, or
  // the first row when nothing is open yet. Tab lands here, then j/k/arrows take over.
  const tabStopId = focusedId ?? navIds[0] ?? null;

  // Select a row: drive the detail pane + mark the signal read (selecting is
  // reading, the Linear/Superhuman model). Click and keyboard share this path.
  const selectRow = useCallback(
    (id: string) => {
      setFocusedId(id);
      if (!id.startsWith("batch:")) {
        const s = (signals ?? []).find((x) => x.id === id);
        if (s && !s.isRead) markRead(id);
      }
    },
    // markRead is recreated each render but closes over current state; safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signals, setFocusedId],
  );

  // Persist the open signal in the URL (?focus=) so a refresh — or navigating away
  // and back — reopens the same signal. Mirrors every selection path (click, j/k,
  // and Esc/back which clears it). The ref guard leaves a deep-linked ?focus=
  // untouched until the bootstrap below consumes it, and never writes on mobile's
  // list-first (unselected) state.
  const focusSyncedRef = useRef(false);
  useEffect(() => {
    // Desktop only. The side pane's open row is mirrored to ?focus= for deep-links
    // and refresh-persistence. On mobile the detail is a full-screen sheet whose
    // open/close is owned by the history-back effect below (so the OS back button
    // dismisses it) — writing ?focus= there would fight that history entry.
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 1024px)").matches
    )
      return;
    if (!focusedId && !focusSyncedRef.current) return;
    focusSyncedRef.current = true;
    // Mirror the open signal to ?focus= via the NATIVE history API, never
    // router.replace. router.replace re-executes the Server Component
    // (signals/page.tsx reads searchParams), which re-fetches the feed + facets and
    // re-hydrates the TanStack cache on *every* selection — and the re-hydrated feed
    // is re-sorted server-side (the just-read signal drops in the isRead tier of the
    // threat sort), churning the animated list so rows pile up. history.replaceState
    // updates the URL with zero navigation, keeping selection a pure client concern;
    // a fresh load still reads ?focus= server-side for the deep-link bootstrap.
    const url = new URL(window.location.href);
    if (focusedId) url.searchParams.set("focus", focusedId);
    else url.searchParams.delete("focus");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [focusedId]);

  // Bootstrap selection: open the signal named by ?focus= (deep-link from the
  // Overview, or a reload — the sync effect above keeps it in the URL), else
  // default to the first row on desktop so the detail pane is never empty. Mobile
  // starts unselected (list-first).
  const deepLinkConsumedRef = useRef(false);
  useEffect(() => {
    if (focusedId || !navIds.length) return;
    // Consume a deep-linked ?focus= exactly once. On mobile the URL keeps the
    // stale param after the sheet closes (we don't write it back) — re-reading it
    // every time focus clears would reopen the signal the user just backed out of.
    if (!deepLinkConsumedRef.current) {
      deepLinkConsumedRef.current = true;
      const wanted = focusId && navIds.includes(focusId) ? focusId : null;
      if (wanted) {
        selectRow(wanted);
        return;
      }
    }
    if (focusedRef.current === "init") return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches
    ) {
      focusedRef.current = "init";
      selectRow(navIds[0]!);
    }
  }, [focusedId, navIds, focusId, selectRow]);

  // The feed item backing the detail pane (a single signal or a batch group).
  const selectedItem = useMemo<FeedItem | null>(() => {
    if (!selectedId) return null;
    if (selectedId.startsWith("batch:")) {
      const bid = selectedId.slice(6);
      return (
        feedItems.find((it) => it.kind === "batch" && it.batchId === bid) ?? null
      );
    }
    return (
      feedItems.find(
        (it) => it.kind === "single" && it.signal.id === selectedId,
      ) ?? null
    );
  }, [selectedId, feedItems]);

  // Mobile: the detail renders as a full-screen sheet, which reads as its own
  // screen — so the OS/browser back button and iOS edge-swipe must dismiss it
  // back to the list, not leave /dashboard/signals. The sheet's open state isn't
  // a route, so while it's up we push a throwaway history entry and close on the
  // resulting popstate; dismissed another way (the in-app back button, a filter
  // dropping the row) we pop our own entry so history stays balanced. Body scroll
  // is locked underneath so the list can't scroll behind the sheet.
  const sheetOpen = Boolean(selectedItem);
  useEffect(() => {
    if (!sheetOpen) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;

    window.history.pushState(
      { ...window.history.state, __signalSheet: true },
      "",
    );
    const onPop = () => setFocusedId(null);
    window.addEventListener("popstate", onPop);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prevOverflow;
      // Closed without a Back (in-app button, filtered out): the sentinel is still
      // on top, so consume it. After a real Back it's already gone (guard false),
      // and navigating deeper put a real route on top (guard false) — so we never
      // pop someone else's entry.
      if (window.history.state?.__signalSheet) window.history.back();
    };
  }, [sheetOpen, setFocusedId]);

  // Scope Ask to the open signal, else to the single filtered competitor, else the feed.
  const askContext = useMemo<AskEntity | null>(() => {
    if (selectedItem?.kind === "single") {
      const s = selectedItem.signal;
      return { kind: "signal", label: s.insight.slice(0, 60), competitorId: s.competitorId };
    }
    if (comp.size === 1) {
      return {
        kind: "view",
        label: "Signals feed, filtered to one competitor",
        competitorId: Array.from(comp)[0],
      };
    }
    return { kind: "view", label: "Signals feed" };
  }, [selectedItem, comp]);
  useSetAskContext(askContext);

  // Tab counts come from facets (whole set, server-side) so they're right at any scale;
  // sample mode counts its fixtures.
  const quickCounts = useMemo(() => {
    if (!sample) {
      const c = facetsQ.data?.counts;
      return {
        all: c?.all ?? 0,
        alerts: c?.alerts ?? 0,
        unread: c?.unread ?? 0,
        week: c?.week ?? 0,
        critical: c?.critical ?? 0,
        actions: c?.actions ?? 0,
      };
    }
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
    let alerts = 0;
    let unread = 0;
    let week = 0;
    let critical = 0;
    let actions = 0;
    for (const s of sampleData.signals) {
      if (!s.isRead) unread++;
      const t = new Date(s.createdAt).getTime();
      if (t >= weekStart && t <= weekEnd) week++;
      if (s.severity === "critical") critical++;
      if (s.severity === "critical" || s.severity === "high") alerts++;
      if (s.actionStatus === "todo" || s.actionStatus === "doing") actions++;
    }
    return { all: sampleData.signals.length, alerts, unread, week, critical, actions };
  }, [sample, facetsQ.data, sampleData]);

  // Filter dropdowns from facets (whole set); sample derives from its fixtures.
  const allCategories = useMemo(() => {
    if (!sample) return facetsQ.data?.categories ?? [];
    const set = new Set<string>();
    sampleData.signals.forEach((s) => set.add(s.category));
    return Array.from(set).sort();
  }, [sample, facetsQ.data, sampleData]);

  const allCompetitors = useMemo(() => {
    if (!sample) return facetsQ.data?.competitors ?? [];
    const m = new Map<string, string>();
    sampleData.signals.forEach((s) => m.set(s.competitorId, s.competitorName));
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sample, facetsQ.data, sampleData]);

  const activeFilterCount = sev.size + cat.size + comp.size;

  function toggleInSet(key: "severity" | "category" | "competitor", value: string) {
    const current = key === "severity" ? sev : key === "category" ? cat : comp;
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setParam({ [key]: serializeSet(next) });
  }

  function clearFilters() {
    setParam({ severity: null, category: null, competitor: null });
  }

  // Saved views (Phase B): snapshot the current feed filters, and apply a saved set.
  const currentFilters: SavedViewFilters = {
    severities: Array.from(sev),
    categories: Array.from(cat),
    competitorIds: Array.from(comp),
    view: quickView,
    sort,
  };
  function applyView(f: SavedViewFilters) {
    setParam({
      severity: f.severities?.length ? f.severities.join(",") : null,
      category: f.categories?.length ? f.categories.join(",") : null,
      competitor: f.competitorIds?.length ? f.competitorIds.join(",") : null,
      view: f.view && f.view !== "all" ? f.view : null,
      // "threat" is the default; a legacy view without a sort resets to it, so
      // applying a view always yields a deterministic feed order.
      sort: f.sort === "recent" ? "recent" : null,
    });
  }

  // Sample mode exports its loaded fixtures client-side; the real feed streams the full
  // filtered scope from the server (every match, not just the loaded pages).
  async function exportCsv() {
    if (sample) {
      const rows = filtered;
      if (!rows.length) return;
      const csv = toCsv(rows, [
        { key: "createdAt", label: "Date" },
        { key: "severity", label: "Severity" },
        { key: "category", label: "Category" },
        { key: "competitorName", label: "Competitor" },
        { key: "insight", label: "Insight" },
        { key: "soWhat", label: "So what" },
        { key: "recommendedAction", label: "Recommended action" },
        { key: "isRead", label: "Read", map: (r) => (r.isRead ? "yes" : "no") },
      ]);
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`outrival-signals-${date}.csv`, csv);
      return;
    }
    try {
      const blob = await api.exportSignals(feedParams);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outrival-signals-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't export signals. Try again.");
    }
  }

  // One master-list row: a selection checkbox in a reserved gutter + the row.
  // Shared by the flat and grouped renders. The checkbox is a SIBLING of the row
  // button (never nested — invalid HTML), so signal-row.tsx stays untouched.
  const renderRow = (item: FeedItem) => {
    if (item.kind === "single") {
      const id = item.signal.id;
      return (
        <motion.div key={id} role="presentation" {...feedItemMotion}>
          <div
            className={cn(
              "group/row relative flex items-center",
              selectionActive && "gap-1.5",
            )}
          >
            <SelectCheckbox
              active={selectionActive}
              checked={selected.has(id)}
              onToggle={(e) => {
                e.stopPropagation();
                toggleSelectId(id, e.shiftKey);
              }}
            />
            <div className="min-w-0 flex-1">
              <SignalRow
                signal={item.signal}
                selected={selectedId === id}
                tabStop={tabStopId === id}
                onFocus={() => setFocusedId(id)}
                onSelect={() => selectRow(id)}
              />
            </div>
          </div>
        </motion.div>
      );
    }
    const bid = `batch:${item.batchId}`;
    return (
      <motion.div key={item.batchId} role="presentation" {...feedItemMotion}>
        <div className={cn("flex items-center", selectionActive && "gap-1.5")}>
          {/* Batches aren't individually selectable — match the single rows' gutter
              only while a selection is active, so idle rows all sit flush. */}
          {selectionActive && <span className="size-4 shrink-0" aria-hidden />}
          <div className="min-w-0 flex-1">
            <BatchRow
              batchId={item.batchId}
              signals={item.signals}
              summary={item.summary}
              selected={selectedId === bid}
              tabStop={tabStopId === bid}
              onFocus={() => setFocusedId(bid)}
              onSelect={() => selectRow(bid)}
            />
          </div>
        </div>
      </motion.div>
    );
  };

  if (err && signals === null) {
    return (
      <div className="space-y-6">
        <PageHead title="Signals" sub="Classified by AI." />
        <ListError error={err} onRetry={() => feedQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SampleBanner />
      <PageHead
        title="Signals"
        sub={
          signals
            ? `Classified by AI · ${total} signal${total === 1 ? "" : "s"}.`
            : "Loading…"
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={!signals || total === 0}
            >
              <Download size={13} /> CSV
            </Button>
            <Button
              size="sm"
              onClick={markAllRead}
              disabled={!signals || quickCounts.unread === 0}
            >
              <Check size={13} /> Mark all read
            </Button>
          </>
        }
      />

      {/* AI executive brief of the week's signals — renders only when there's enough
          to summarize; the server caches it, so mounting it here is cheap. */}
      {!sample && (
        <SignalsBrief productId={productId ?? undefined} enabled={total >= 3} />
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-2">
        <Tabs
          className="min-w-0 shrink-0"
          value={quickView}
          onValueChange={(v) => setParam({ view: v === "all" ? null : v })}
        >
          <TabsList>
            {QUICK_VIEWS.map((v) => (
              <TabsTrigger key={v.value} value={v.value}>
                {v.label}
                <span className="ml-1.5 tabular-nums font-mono text-meta text-muted-foreground">
                  {quickCounts[v.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="hidden lg:block lg:flex-1" />

        {/* Controls stay on one wrapping row so mobile stacks them under the
            tabs instead of scattering each button on its own line. */}
        <div className="flex flex-wrap items-center gap-2">
        <SavedViewsMenu current={currentFilters} onApply={applyView} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <ArrowUpDown size={13} />
              {sort === "recent" ? "Most recent" : "Most relevant"}
              <ChevronDown size={11} className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={sort === "threat"}
              onCheckedChange={() => setParam({ sort: null })}
            >
              Most relevant
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={sort === "recent"}
              onCheckedChange={() => setParam({ sort: "recent" })}
            >
              Most recent
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Rows3 size={13} />
              {GROUP_LABEL[group]}
              <ChevronDown size={11} className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Group by</DropdownMenuLabel>
            {GROUP_MODES.map((m) => (
              <DropdownMenuCheckboxItem
                key={m}
                checked={group === m}
                onCheckedChange={() =>
                  setParam({ group: m === "none" ? null : m })
                }
              >
                {GROUP_LABEL[m]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal size={13} />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-meta font-mono tabular-nums">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown size={11} className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64 max-h-[480px] overflow-y-auto" align="end">
            <DropdownMenuLabel>Severity</DropdownMenuLabel>
            {SEVERITIES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={sev.has(s)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => toggleInSet("severity", s)}
              >
                <span className="flex items-center gap-2 capitalize">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full inline-block",
                      SEV_DOT[s],
                    )}
                  />
                  {s}
                </span>
              </DropdownMenuCheckboxItem>
            ))}

            {allCategories.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Category</DropdownMenuLabel>
                {allCategories.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c}
                    checked={cat.has(c)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggleInSet("category", c)}
                  >
                    <span className="capitalize">{c}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}

            {allCompetitors.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Competitor</DropdownMenuLabel>
                {allCompetitors.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={comp.has(c.id)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggleInSet("competitor", c.id)}
                  >
                    {c.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}

            {activeFilterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={clearFilters}
                  className="text-xs text-muted-foreground"
                >
                  Reset filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            id="signals-search"
            aria-label="Search signals"
            placeholder="Search…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-8 pl-8 text-sm w-48"
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Keyboard shortcuts"
              onClick={() => setHelpOpen(true)}
            >
              <Keyboard size={15} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Keyboard shortcuts ·{" "}
            <kbd className="font-mono">?</kbd>
          </TooltipContent>
        </Tooltip>
        </div>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap -mt-2">
          {Array.from(sev).map((s) => (
            <FilterChip key={`s-${s}`} onRemove={() => toggleInSet("severity", s)}>
              <span
                className={cn(
                  "w-2 h-2 rounded-full inline-block",
                  SEV_DOT[s as Sev],
                )}
              />
              <span className="capitalize">{s}</span>
            </FilterChip>
          ))}
          {Array.from(cat).map((c) => (
            <FilterChip key={`c-${c}`} onRemove={() => toggleInSet("category", c)}>
              <span className="capitalize">{c}</span>
            </FilterChip>
          ))}
          {Array.from(comp).map((c) => {
            const name = allCompetitors.find((x) => x.id === c)?.name ?? c;
            return (
              <FilterChip
                key={`comp-${c}`}
                onRemove={() => toggleInSet("competitor", c)}
              >
                {name}
              </FilterChip>
            );
          })}
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2"
          >
            Clear all
          </button>
        </div>
      )}

      {signals === null ? (
        <ListRowsSkeleton rows={6} />
      ) : signals.length === 0 ? (
        // Cold start — no signals exist yet for this workspace.
        <EmptyState
          icon={Radar}
          title="No signals yet"
          description="Outrival turns every competitor move into a signal — what changed, why it matters, and what to do. Add a competitor to start, or explore with sample data first."
          actions={
            <>
              <Button asChild size="sm">
                <Link href="/dashboard/competitors">Add a competitor</Link>
              </Button>
              {!sample && (
                <Button size="sm" variant="ghost" onClick={() => setSample(true)}>
                  <FlaskConical size={13} /> Explore with sample data
                </Button>
              )}
            </>
          }
        />
      ) : feedItems.length === 0 ? (
        // No-results — filters/search exclude every signal (distinct from cold start).
        <EmptyState
          icon={Inbox}
          title="No matching signals"
          description="Your current filters exclude every signal. Reset them to see the full feed."
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                clearFilters();
                setParam({ view: null, q: null });
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <>
          {/* Bulk selection bar — appears once ≥1 row is checked. Actions run over
              the selection (setSignalsRead in one call; setSignalAction fanned out). */}
          {selectionActive && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
              <span className="text-dense font-medium">
                {selected.size} selected
              </span>
              <span className="h-4 w-px bg-border" />
              <Button variant="ghost" size="sm" onClick={() => bulkMarkRead(true)}>
                <Check size={13} /> Mark read
              </Button>
              <Button variant="ghost" size="sm" onClick={() => bulkMarkRead(false)}>
                Mark unread
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <ListTodo size={13} /> Track
                    <ChevronDown size={11} className="opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {TRACK_OPTIONS.map((o) => (
                    <DropdownMenuItem
                      key={o.value}
                      onSelect={() => bulkSetAction(o.value)}
                    >
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                  >
                    <Clock size={13} /> Snooze
                    <ChevronDown size={11} className="opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {SNOOZE_PRESETS.map((p) => (
                    <DropdownMenuItem
                      key={p.label}
                      onSelect={() => snoozeSignals([...selected], p.ms)}
                    >
                      {p.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => dismissSignals([...selected])}
              >
                <EyeOff size={13} /> Dismiss as noise
              </Button>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          )}
          <div className="lg:grid lg:grid-cols-[minmax(0,270px)_minmax(0,1fr)] lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:gap-6">
          {/* Master list — compact, scannable rows; the detail lives on the right. */}
          <div
            role="listbox"
            aria-label="Signals"
            className="flex flex-col gap-0.5 rounded-lg border border-border p-1.5 lg:max-h-[calc(100dvh-220px)] lg:overflow-y-auto"
          >
            {group === "none" ? (
              <AnimatePresence initial={false} mode="popLayout">
                {groups[0]?.items.map(renderRow)}
              </AnimatePresence>
            ) : (
              groups.map((g) => (
                <div key={g.key} className="mb-1 last:mb-0">
                  <GroupHeader
                    label={g.label}
                    count={g.items.length}
                    collapsed={collapsed.has(g.key)}
                    onToggle={() => toggleCollapsed(g.key)}
                  />
                  {!collapsed.has(g.key) && (
                    <AnimatePresence initial={false} mode="popLayout">
                      {g.items.map(renderRow)}
                    </AnimatePresence>
                  )}
                </div>
              ))
            )}
            {!sample && feedQ.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full text-muted-foreground"
                onClick={() => feedQ.fetchNextPage()}
                disabled={feedQ.isFetchingNextPage}
              >
                {feedQ.isFetchingNextPage
                  ? "Loading…"
                  : `Load more · ${total - signals.length} left`}
              </Button>
            )}
          </div>

          {/* Detail pane — sticky right column on desktop; a full-screen sheet on
              mobile when a row is selected. Rendered once (no duplicate ids). */}
          <div
            className={cn(
              "lg:sticky lg:top-4",
              selectedItem
                ? "fixed inset-0 z-50 overflow-y-auto bg-background p-4 animate-in fade-in slide-in-from-bottom-2 duration-200 lg:static lg:inset-auto lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0 lg:animate-none"
                : "hidden lg:block",
            )}
          >
            {selectedItem ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    // Mirror the OS back button: pop our history sentinel so both
                    // paths converge on the same popstate → close. Fallback for the
                    // rare case the sentinel isn't there (opened before a resize).
                    if (window.history.state?.__signalSheet) window.history.back();
                    else setFocusedId(null);
                  }}
                  className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
                >
                  <ArrowLeft size={14} /> Back to signals
                </button>
                {selectedItem.kind === "single" ? (
                  // Single-signal detail. Container-query driven: when the detail
                  // pane itself is wide enough (not the viewport — the pane width
                  // varies with the master list), "More from" moves into a side
                  // rail next to the card+evidence column instead of stacking
                  // below. Narrow pane → single readable column, capped at 820.
                  // The whole thing caps so it never pins to the far edge.
                  <div className="@container/detail w-full">
                    <div className="grid max-w-[820px] grid-cols-1 items-start gap-4 @4xl/detail:max-w-[1148px] @4xl/detail:grid-cols-[minmax(0,820px)_300px] @4xl/detail:gap-6">
                      <div className="min-w-0 space-y-4">
                        <SignalCard
                          // Distinct key prefixes: SignalCard and SignalEvidence are
                          // siblings and MUST NOT share a key, or React's reconciliation
                          // breaks (silently in prod) and the card stacks on focus change.
                          key={`card-${selectedItem.signal.id}`}
                          signal={selectedItem.signal}
                          interactive={!sample}
                          onMarkRead={!sample ? markRead : undefined}
                          onMarkUnread={!sample ? markUnread : undefined}
                          onActionChange={onActionChange}
                          onDismiss={(id) => dismissSignals([id])}
                          onSnooze={(id, ms) => snoozeSignals([id], ms)}
                        />
                        {/* Evidence dossier — best-effort; renders nothing without
                            structured evidence, and is skipped in sample mode (no
                            backend to fetch from). */}
                        {!sample && (
                          <SignalEvidence
                            key={`evidence-${selectedItem.signal.id}`}
                            signalId={selectedItem.signal.id}
                          />
                        )}
                      </div>
                      <MoreFromCompetitor
                        signal={selectedItem.signal}
                        all={signals ?? []}
                        onSelect={selectRow}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 lg:max-w-[760px]">
                    <div className="rounded-lg border border-border bg-card px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge
                          severity={selectedItem.signals.reduce<Sev>(
                            (m, s) =>
                              SEV_RANK[s.severity] > SEV_RANK[m]
                                ? s.severity
                                : m,
                            "low",
                          )}
                        />
                        <span className="text-base font-semibold">
                          {selectedItem.signals[0]!.competitorName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {selectedItem.signals.length} similar{" "}
                          {selectedItem.signals[0]!.category} signals
                        </span>
                      </div>
                      {selectedItem.summary && (
                        <p className="mt-2 text-content leading-relaxed text-foreground/85">
                          {selectedItem.summary}
                        </p>
                      )}
                    </div>
                    {selectedItem.signals.map((s) => (
                      <SignalCard
                        key={s.id}
                        signal={s}
                        interactive={!sample}
                        onMarkRead={!sample ? markRead : undefined}
                        onMarkUnread={!sample ? markUnread : undefined}
                        onActionChange={onActionChange}
                        onDismiss={(id) => dismissSignals([id])}
                        onSnooze={(id, ms) => snoozeSignals([id], ms)}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="hidden min-h-[320px] items-center justify-center rounded-lg border border-dashed border-border lg:flex">
                <p className="text-sm text-muted-foreground">
                  Select a signal to see the full detail.
                </p>
              </div>
            )}
          </div>
        </div>
        </>
      )}

      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

// Row selection checkbox — sits in a reserved gutter left of each row. Hidden until
// the row is hovered, unless a selection is already active (then all show).
function SelectCheckbox({
  checked,
  active,
  onToggle,
}: {
  checked: boolean;
  // A selection is in progress (≥1 row checked) → all checkboxes take a real gutter.
  active: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Deselect signal" : "Select signal"}
      onClick={onToggle}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm border outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/50",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-transparent hover:border-foreground/40",
        // Active selection → in the row flow (a real gutter). Otherwise pinned to the
        // left edge and only faded in on hover, so idle rows carry no empty gutter.
        active
          ? "static opacity-100"
          : cn(
              "absolute left-1.5 top-1/2 z-10 -translate-y-1/2",
              checked ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
            ),
      )}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  );
}

// A collapsible group header for the "By competitor" / "By day" list views. Sticks
// to the top of the scrolling list so the current group stays labelled while scrolling.
function GroupHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="sticky top-0 z-10 flex w-full items-center gap-1.5 rounded-md bg-card/95 px-2 py-1.5 text-left outline-none backdrop-blur transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
    >
      <ChevronDown
        size={13}
        className={cn(
          "shrink-0 text-muted-foreground transition-transform",
          collapsed && "-rotate-90",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-dense font-semibold text-foreground/90">
        {label}
      </span>
      <span className="shrink-0 font-mono text-meta text-muted-foreground tabular-nums">
        {count}
      </span>
    </button>
  );
}

// Cross-links to the selected competitor's other signals, from the already-loaded
// feed (no extra fetch). Turns the detail pane into a small competitor hub and
// gives the master-detail a reason to exist beyond a single card.
function MoreFromCompetitor({
  signal,
  all,
  onSelect,
}: {
  signal: Signal;
  all: Signal[];
  onSelect: (id: string) => void;
}) {
  const related = all
    .filter((s) => s.competitorId === signal.competitorId && s.id !== signal.id)
    .slice(0, 6);
  return (
    <div className="rounded-md border border-border bg-card p-5">
      <div className="mb-3 text-dense font-medium text-muted-foreground">
        More from {signal.competitorName}
      </div>
      {related.length > 0 ? (
        <ul className="-mx-2">
          {related.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    SEV_DOT[s.severityOverride ?? s.severity],
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-dense text-foreground/90 group-hover:text-foreground">
                  {s.insight}
                </span>
                <time className="shrink-0 text-meta text-muted-foreground tabular-nums">
                  {formatDistanceToNow(new Date(s.createdAt), { addSuffix: false })}
                </time>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-dense text-muted-foreground">
          No other signals from this competitor yet.
        </p>
      )}
      <Link
        href={`/dashboard/competitors/${signal.competitorId}`}
        className="mt-3 inline-flex items-center gap-1 text-dense text-muted-foreground transition-colors hover:text-foreground"
      >
        View {signal.competitorName} profile
        <ArrowUpRight size={13} />
      </Link>
    </div>
  );
}

function FilterChip({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-border bg-card text-xs">
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onRemove}
            className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Remove filter"
          >
            <X size={11} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Remove filter</TooltipContent>
      </Tooltip>
    </span>
  );
}
