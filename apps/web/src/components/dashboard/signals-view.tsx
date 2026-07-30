"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  keepPreviousData,
  type InfiniteData,
} from "@tanstack/react-query";
import { signalsFeedQuery, signalsFacetsQuery, competitorsQuery } from "@/lib/queries";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { CheckIcon, CaretDownIcon, TrayIcon, FlaskIcon, ScanIcon } from "@/components/icons";
import { startOfWeek, endOfWeek, format, isToday, isYesterday } from "date-fns";
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
import { useSetAskContext, type AskEntity } from "./ask-context";
import { cn } from "@/lib/utils";
import { feedItemMotion } from "@/lib/motion";
import {
  SignalsListHeader,
  QUICK_VIEWS,
  GROUP_MODES,
  type FilterKey,
  type GroupMode,
  type QuickView,
  type Sev,
} from "./signals-list-header";
import { SignalsListFooter } from "./signals-list-footer";
import { SignalDetailPanel } from "./signal-detail-panel";
import {
  useSignalsBrief,
  SignalsBriefRow,
  SignalsBriefPanel,
} from "./signals-brief";
import { SignalRow } from "./signal-row";
import { EmptyState } from "./empty-state";
import { SampleBanner } from "./sample-banner";
import { ShortcutsHelp } from "./shortcuts-help";
import { ListRowsSkeleton } from "./skeletons";
import { ListError } from "@/components/outrival/list-error";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";
import { useSampleMode } from "@/hooks/use-sample-mode";
import { getSampleData, getSampleSignalDetail } from "@/lib/sample-data";

// The synthetic list row for the AI brief. It sits above the feed and opens in
// the detail pane, so it needs an id in the keyboard-nav order like any row.
const BRIEF_ID = "brief";

// Day bucket for the "By day" grouping — a stable key + a human label.
function dayGroup(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  return {
    key: format(d, "yyyy-MM-dd"),
    label: isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "MMM d"),
  };
}

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

  // A competitor filter names competitors of the scope it was set in. Switching the
  // product left those ids in the URL: the feed came back empty and the chip printed
  // a raw uuid (no name to resolve). Drop the ids the new scope doesn't track, keep
  // the rest. Read against the product's ROSTER, not the feed's facets: a tracked
  // competitor with no signals yet must keep filtering (an empty feed is the honest
  // answer) — only one that belongs to another product is meaningless here. Shares
  // the sidebar's scoped query, so it costs no extra request.
  const scopedRosterQ = useQuery({
    ...competitorsQuery(productId ?? undefined),
    enabled: !sample && Boolean(productId) && comp.size > 0,
  });
  const scopedRoster = scopedRosterQ.data;
  useEffect(() => {
    if (sample || !scopedRoster || !comp.size) return;
    const tracked = new Set(scopedRoster.map((c) => c.id));
    const kept = [...comp].filter((id) => tracked.has(id));
    if (kept.length === comp.size) return;
    setParam({ competitor: kept.length ? kept.join(",") : null });
  }, [sample, scopedRoster, comp, setParam]);

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

  // The AI brief of the current feed — a pinned row above the list, read in the
  // detail pane. Best-effort: no brief, no row.
  const briefState = useSignalsBrief(productId ?? undefined, !sample && total >= 3);
  const brief = briefState.brief;

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

  // Intel → action loop (Phase B): the detail panel persists the status; keep the
  // local array in sync so the "Actions" tab and its count update immediately.
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

  // One signal per row and exactly ONE signal in the detail — batch collapsing is
  // intentionally disabled. It grouped signals by `batchedIntoId`, which could pile
  // several (even unrelated, cross-competitor) signals into the detail pane; the feed
  // must always open a single signal. `BatchRow` stays in signal-row.tsx for the day
  // batching is re-enabled, but nothing renders it today.
  const groups = useMemo<{ key: string; label: string; items: Signal[] }[]>(() => {
    if (group === "none") return [{ key: "__all", label: "", items: filtered }];
    const map = new Map<string, { key: string; label: string; items: Signal[] }>();
    const order: string[] = [];
    for (const sig of filtered) {
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
      g.items.push(sig);
    }
    return order.map((k) => map.get(k)!);
  }, [filtered, group]);

  // Master-detail nav order. Selection (j/k or click) drives the right pane; no
  // inline expansion to traverse. Runs over the VISIBLE rows only, so j/k skips
  // rows hidden inside a collapsed group. The brief leads when there is one.
  const navIds = useMemo(() => {
    const out: string[] = [];
    if (brief) out.push(BRIEF_ID);
    for (const g of groups) {
      if (group !== "none" && collapsed.has(g.key)) continue;
      for (const sig of g.items) out.push(sig.id);
    }
    return out;
  }, [groups, collapsed, group, brief]);

  // Selectable ids = visible signal rows (the brief isn't a signal to act on).
  const selectableIds = useMemo(
    () => navIds.filter((id) => id !== BRIEF_ID),
    [navIds],
  );

  // Prune the selection to rows still in the feed. Non-destructive bulk actions
  // (mark read/unread, track) keep the selection so a follow-up action hits the
  // same set — but if one of those rows later leaves the view (e.g. marking read
  // in the Unread view, next poll drops it), its stale id must not linger and
  // inflate the "N selected" count. Returns `prev` unchanged when nothing left,
  // so a stable selectableIds ref can't loop.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(selectableIds);
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [selectableIds]);

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
    // Keep the selection: the rows stay in the feed, so a follow-up bulk action
    // can hit the same set (stale ids are pruned by the effect above).
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
    // Keep the selection (rows stay in the feed); stale ids are pruned above.
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
      `${n} signal${n > 1 ? "s" : ""} dismissed. Outrival will show fewer like ${
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
    (id: string) => (id === BRIEF_ID ? "row-brief" : `row-${id}`),
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
    if (key >= "1" && key <= "5") {
      const v = QUICK_VIEWS[Number(key) - 1];
      if (v) setParam({ view: v.value === "all" ? null : v.value });
      return true;
    }
    if (!fid || fid === BRIEF_ID) return false;
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
      // The open signal's own controls live in the detail panel, which listens
      // for these — the shortcuts help has always advertised them.
      case "t":
      case "c":
        document.dispatchEvent(
          new CustomEvent("signal-detail-action", {
            detail: key === "t" ? "track" : "discuss",
          }),
        );
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
      if (id !== BRIEF_ID) {
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

  // The signal backing the detail pane (null when the brief is open, or nothing is).
  const selectedSignal = useMemo<Signal | null>(() => {
    if (!selectedId || selectedId === BRIEF_ID) return null;
    return filtered.find((s) => s.id === selectedId) ?? null;
  }, [selectedId, filtered]);
  const briefOpen = selectedId === BRIEF_ID && Boolean(brief);

  // Mobile: the detail renders as a full-screen sheet, which reads as its own
  // screen — so the OS/browser back button and iOS edge-swipe must dismiss it
  // back to the list, not leave /dashboard/signals. The sheet's open state isn't
  // a route, so while it's up we push a throwaway history entry and close on the
  // resulting popstate; dismissed another way (the in-app back button, a filter
  // dropping the row) we pop our own entry so history stays balanced. Body scroll
  // is locked underneath so the list can't scroll behind the sheet.
  const sheetOpen = Boolean(selectedSignal) || briefOpen;
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

  // Mirror the OS back button: pop our history sentinel so both paths converge on
  // the same popstate → close. Fallback for the rare case the sentinel isn't
  // there (opened before a resize).
  function closeSheet() {
    if (window.history.state?.__signalSheet) window.history.back();
    else setFocusedId(null);
  }

  // Scope Ask to the open signal, else to the single filtered competitor, else the feed.
  const askContext = useMemo<AskEntity | null>(() => {
    if (selectedSignal) {
      return {
        kind: "signal",
        label: selectedSignal.insight.slice(0, 60),
        competitorId: selectedSignal.competitorId,
      };
    }
    if (comp.size === 1) {
      return {
        kind: "view",
        label: "Signals feed, filtered to one competitor",
        competitorId: Array.from(comp)[0],
      };
    }
    return { kind: "view", label: "Signals feed" };
  }, [selectedSignal, comp]);
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
    const m = new Map<string, { id: string; name: string; url?: string | null }>();
    sampleData.signals.forEach((s) =>
      m.set(s.competitorId, {
        id: s.competitorId,
        name: s.competitorName,
        url: s.competitorUrl ?? null,
      }),
    );
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sample, facetsQ.data, sampleData]);

  const activeFilterCount = sev.size + cat.size + comp.size;

  function toggleInSet(key: FilterKey, value: string) {
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

  // One master-list row. No reserved selection gutter (that read as a permanent
  // empty column): the checkbox overlays the row's severity-icon slot, which fades
  // out underneath (SignalRow `selecting`), so the list is a clean single column at
  // rest and the box appears on row hover — or on every row once a selection is
  // live. The checkbox is a SIBLING of the row button (never nested — invalid HTML).
  const renderRow = (signal: Signal) => {
    const id = signal.id;
    const isChecked = selected.has(id);
    return (
      <motion.div key={id} role="presentation" {...feedItemMotion}>
        <div className="group/row relative">
          <div
            className={cn(
              "absolute left-3 top-3 z-10 transition-opacity",
              // Reveal-on-hover is gated to hover-capable devices. globals.css drops
              // the `@media (hover: hover)` gate from `hover:` project-wide (tap
              // feedback), but on touch that makes a tap reveal this interactive
              // overlay — which mobile WebKit consumes as the first tap (swallowing
              // the click that opens + marks the signal read). Selection lives on
              // hover (desktop) or an active selection; on touch a tap just opens.
              selectionActive || isChecked
                ? "opacity-100"
                : "pointer-events-none opacity-0 [@media(hover:hover)]:group-hover/row:pointer-events-auto [@media(hover:hover)]:group-hover/row:opacity-100",
            )}
          >
            <SelectCheckbox
              active={selectionActive}
              checked={isChecked}
              onToggle={(e) => {
                e.stopPropagation();
                toggleSelectId(id, e.shiftKey);
              }}
            />
          </div>
          <SignalRow
            signal={signal}
            selecting={selectionActive || isChecked}
            selected={selectedId === id}
            tabStop={tabStopId === id}
            onFocus={() => setFocusedId(id)}
            onSelect={() => selectRow(id)}
          />
        </div>
      </motion.div>
    );
  };

  // Cold start and hard failure are page-level states — the workspace frame would
  // only add two empty columns around them.
  if (err && signals === null) {
    return (
      <div className="h-full overflow-y-auto px-4 py-8 lg:px-8">
        <ListError error={err} onRetry={() => feedQ.refetch()} />
      </div>
    );
  }

  // Cold start = the workspace has never produced a signal. An empty tab or an
  // over-narrow filter is a different state (the feed exists, this slice of it
  // doesn't) and must keep the filters reachable, so it renders inside the list.
  const coldStart =
    signals !== null &&
    signals.length === 0 &&
    quickCounts.all === 0 &&
    quickView === "all" &&
    activeFilterCount === 0 &&
    !query;

  if (coldStart) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-8">
        <EmptyState
          icon={ScanIcon}
          title="No signals yet"
          description="Outrival turns every competitor move into a signal: what changed, why it matters, and what to do. Add a competitor to start, or explore with sample data first."
          actions={
            <>
              <Button asChild size="sm">
                <Link href="/dashboard/competitors">Add a competitor</Link>
              </Button>
              {!sample && (
                <Button size="sm" variant="ghost" onClick={() => setSample(true)}>
                  <FlaskIcon size={16} /> Explore with sample data
                </Button>
              )}
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Flatten the banner's card into a full-width strip — in a workspace a
          floating rounded box at the top edge reads as a stray element. */}
      <div className="shrink-0 [&>*]:rounded-none [&>*]:border-x-0 [&>*]:border-t-0">
        <SampleBanner />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Master list — its own column, its own scroll, its own chrome. */}
        <div className="flex w-full min-w-0 flex-col border-border lg:w-[400px] lg:shrink-0 lg:border-r">
          <SignalsListHeader
            loading={signals === null}
            total={total}
            unreadCount={quickCounts.unread}
            quickView={quickView}
            quickCounts={quickCounts}
            sort={sort}
            group={group}
            sev={sev}
            cat={cat}
            comp={comp}
            allCategories={allCategories}
            allCompetitors={allCompetitors}
            searchInput={searchInput}
            onSearchInput={setSearchInput}
            setParam={setParam}
            onToggleFilter={toggleInSet}
            onClearFilters={clearFilters}
            currentFilters={currentFilters}
            onApplyView={applyView}
            onExportCsv={exportCsv}
            onMarkAllRead={markAllRead}
            onShowShortcuts={() => setHelpOpen(true)}
          />

          <div
            role="listbox"
            aria-label="Signals"
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1.5"
          >
            {signals === null ? (
              <ListRowsSkeleton rows={8} />
            ) : filtered.length === 0 ? (
              <div className="px-3 py-10">
                <EmptyState
                  icon={TrayIcon}
                  title="No matching signals"
                  description="Your filters exclude every signal in the feed."
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
              </div>
            ) : (
              <>
                {brief && (
                  <SignalsBriefRow
                    count={briefState.count}
                    selected={selectedId === BRIEF_ID}
                    tabStop={tabStopId === BRIEF_ID}
                    onFocus={() => setFocusedId(BRIEF_ID)}
                    onSelect={() => selectRow(BRIEF_ID)}
                  />
                )}
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
              </>
            )}
          </div>

          <SignalsListFooter
            selectedCount={selected.size}
            onBulkMarkRead={bulkMarkRead}
            onBulkTrack={bulkSetAction}
            onBulkSnooze={(ms) => snoozeSignals([...selected], ms)}
            onBulkDismiss={() => dismissSignals([...selected])}
            onClearSelection={clearSelection}
            onShowShortcuts={() => setHelpOpen(true)}
          />
        </div>

        {/* Detail — the right column on desktop, a full-screen sheet on mobile.
            Rendered once (no duplicate ids, no double fetch). */}
        <div
          className={cn(
            "min-w-0",
            sheetOpen
              ? "fixed inset-0 z-50 bg-background lg:static lg:z-auto lg:block lg:flex-1"
              : "hidden lg:block lg:flex-1",
          )}
        >
          {briefOpen && brief ? (
            <SignalsBriefPanel
              brief={brief}
              count={briefState.count}
              refresh={briefState.refresh}
              refreshing={briefState.refreshing}
              onBack={closeSheet}
            />
          ) : selectedSignal ? (
            <SignalDetailPanel
              // Keyed on the signal: every disclosure and the scroll position
              // reset with it, which is what opening the next one should mean.
              key={selectedSignal.id}
              signal={selectedSignal}
              interactive={!sample}
              detail={
                sample ? getSampleSignalDetail(selectedSignal.id) : undefined
              }
              related={(signals ?? []).filter(
                (s) =>
                  s.competitorId === selectedSignal.competitorId &&
                  s.id !== selectedSignal.id,
              )}
              onSelectRelated={selectRow}
              onBack={closeSheet}
              onMarkRead={!sample ? markRead : undefined}
              onMarkUnread={!sample ? markUnread : undefined}
              onActionChange={onActionChange}
              onDismiss={(id) => dismissSignals([id])}
              onSnooze={(id, ms) => snoozeSignals([id], ms)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <div className="max-w-xs text-center">
                <span
                  className="mx-auto flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 text-muted-foreground"
                  aria-hidden
                >
                  <ScanIcon size={20} />
                </span>
                <p className="mt-3 text-sm font-medium text-foreground">
                  No signal open
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Pick one from the list to read what changed, why it matters, and
                  what to do.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

// Row selection checkbox — overlays the row's severity-icon slot (positioned by the
// wrapper in renderRow). Its visibility/pointer-events are driven there (hover, or a
// live selection); here it's just the box. Not a tab stop until a selection is live
// or it's checked, so an invisible-at-rest overlay never traps keyboard focus.
function SelectCheckbox({
  checked,
  active,
  onToggle,
}: {
  checked: boolean;
  // A selection is in progress (≥1 row checked) → every checkbox stays visible.
  active: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Deselect signal" : "Select signal"}
      tabIndex={active || checked ? 0 : -1}
      onClick={onToggle}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-transparent hover:border-foreground/50",
      )}
    >
      <CheckIcon size={16} />
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
      <CaretDownIcon
        size={16}
        className={cn(
          "shrink-0 text-muted-foreground transition-transform",
          collapsed && "-rotate-90",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-dense font-semibold text-foreground/90">
        {label}
      </span>
      <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
        {count}
      </span>
    </button>
  );
}
