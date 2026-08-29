"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  keepPreviousData,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  signalsFeedQuery,
  signalsFacetsQuery,
  competitorsQuery,
  adjustCompetitorUnread,
} from "@/lib/queries";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { CheckIcon, CaretDownIcon, TrayIcon, FlaskIcon, ScanIcon } from "@/components/icons";
import { startOfWeek, endOfWeek, format, isToday, isYesterday } from "date-fns";
import { toast } from "@/lib/toast";
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
import { disclosureMotion, feedItemMotion } from "@/lib/motion";
import {
  SignalsListHeader,
  QUICK_VIEWS,
  GROUP_MODES,
  DEFAULT_GROUP,
  type FilterKey,
  type GroupMode,
  type QuickView,
  type Sev,
} from "./signals-list-header";
import {
  signalTier,
  URGENCY_META,
  URGENCY_ORDER,
  type DigestUrgency,
} from "@/lib/signal-shape";
import { SignalsListFooter } from "./signals-list-footer";
import { SignalDetailPanel } from "./signal-detail-panel";
import {
  useSignalsBrief,
  SignalsBriefRow,
  SignalsBriefPanel,
} from "./signals-brief";
import { SignalRow, FoldRow } from "./signal-row";
import { CatchUpBanner } from "./signals-catch-up";
import { EmptyState } from "./empty-state";
import { SampleBanner } from "./sample-banner";
import { ShortcutsHelp } from "./shortcuts-help";
import { ListRowsSkeleton } from "./skeletons";
import { ListError } from "@/components/outrival/list-error";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";
import { useSampleMode } from "@/hooks/use-sample-mode";
import { useSignalsGroup } from "@/hooks/use-signals-group";
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

// Folding near-duplicates ("Fold similar"). Two rules keep it honest, and they are
// the reason the first attempt at this (patch-26, collapsed by `batchedIntoId` in
// the list) had to be turned off:
//   1. a fold NEVER spans two competitors — it has to read as one sentence;
//   2. an urgent signal is never folded away — critical/high always get their row.
// The trigger is redundancy, not volume: a big feed of distinct signals is a big
// read either way, and folding it would hide information rather than compress it.
const FOLD_MIN = 3;
const FOLD_WINDOW_MS = 7 * 24 * 3600_000;

type FeedRow =
  | { kind: "signal"; signal: Signal }
  | { kind: "fold"; key: string; summary: string | null; signals: Signal[] };

// The list is two levels deep, at most. In the default "By priority" mode the
// section is a tier of the brief and the sub-group is a competitor; every other
// mode keeps one unlabelled sub-group, so a single walker renders them all and
// there is no second code path for "grouped" versus "flat".
// `unread` rides alongside `count` at both levels: a collapsed header is the only
// thing left on screen for the group under it, so it has to say how much of that
// group is still waiting. Without it, folding the list away folds the backlog away.
type SubGroup = {
  key: string;
  label: string;
  count: number;
  unread: number;
  rows: FeedRow[];
};
type Section = {
  key: string;
  label: string;
  /** The tier's colour band in the brief. Absent outside "By priority". */
  swatch?: string;
  count: number;
  unread: number;
  subs: SubGroup[];
};

// A server batch (same key across every page) wins over the client key, so a fold
// survives pagination: a member landing on page 3 joins the fold already on screen.
function foldKeyOf(s: Signal): string {
  return s.batchedIntoId
    ? `batch:${s.batchedIntoId}`
    : `sim:${s.competitorId}:${s.category}`;
}

function buildFeedRows(items: Signal[]): FeedRow[] {
  const rows: FeedRow[] = [];
  // The fold currently open for a key, plus the time it is anchored on. A run that
  // outgrows the window starts a new fold instead of stretching across a quarter.
  const open = new Map<string, { row: Extract<FeedRow, { kind: "fold" }>; anchor: number }>();

  for (const signal of items) {
    const sev = signal.severityOverride ?? signal.severity;
    if (sev === "critical" || sev === "high") {
      rows.push({ kind: "signal", signal });
      continue;
    }
    const key = foldKeyOf(signal);
    const at = new Date(signal.createdAt).getTime();
    const current = open.get(key);
    if (current && Math.abs(at - current.anchor) <= FOLD_WINDOW_MS) {
      current.row.signals.push(signal);
      continue;
    }
    // The anchor's id keys the fold, so two runs of the same competitor+category
    // can't collide on one React key.
    const row: Extract<FeedRow, { kind: "fold" }> = {
      kind: "fold",
      key: `${key}:${signal.id}`,
      summary: null,
      signals: [signal],
    };
    rows.push(row);
    open.set(key, { row, anchor: at });
  }

  // A fold of two claims a grouping over rows the reader could have just read.
  // Below the threshold it unfolds back into plain rows, in place.
  const out: FeedRow[] = [];
  for (const row of rows) {
    if (row.kind !== "fold") {
      out.push(row);
    } else if (row.signals.length < FOLD_MIN) {
      for (const signal of row.signals) out.push({ kind: "signal", signal });
    } else {
      out.push({
        ...row,
        summary: row.signals.find((s) => s.batchSummary)?.batchSummary ?? null,
      });
    }
  }
  return out;
}

// Backlog past which the list leads with the catch-up strip instead of row 1.
const CATCH_UP_UNREAD = 15;

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
  // Folds are closed by default (that is the point) and their open state is
  // client-only, like `collapsed`. Dismissing the catch-up strip lasts the visit.
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set());
  const [catchUpDismissed, setCatchUpDismissed] = useState(false);

  const focusId = searchParams.get("focus");
  const quickView = (searchParams.get("view") as QuickView) || "all";
  // Grouping is a display preference the reader keeps between visits (?group=
  // alone died the moment they navigated away). A mode named in the URL still
  // wins, so deep links and shared links render what they say.
  const [storedGroup, setStoredGroup] = useSignalsGroup();
  const group = (GROUP_MODES as readonly string[]).includes(
    searchParams.get("group") ?? "",
  )
    ? (searchParams.get("group") as GroupMode)
    : storedGroup;
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

  // Picking a grouping writes both: storage (so it survives leaving the page) and
  // the URL (so the current link still describes what is on screen).
  const setGroup = useCallback(
    (mode: GroupMode) => {
      setStoredGroup(mode);
      setParam({ group: mode === DEFAULT_GROUP ? null : mode });
    },
    [setStoredGroup, setParam],
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

  // The sidebar competitor counting this signal — null when the row isn't loaded
  // or the flip is a no-op (re-reading a read row moves no count).
  function unreadOwner(id: string, nextRead: boolean) {
    const sig = (signals ?? []).find((s) => s.id === id);
    return sig && sig.isRead !== nextRead ? sig.competitorId : null;
  }

  async function markRead(id: string) {
    const owner = unreadOwner(id, true);
    mutateSignals((prev) => prev.map((s) => (s.id === id ? { ...s, isRead: true } : s)));
    if (sample) return;
    // Keep the sidebar roster in step with the row: it reads its unread badge off
    // the ["competitors"] cache, which no poll refreshes for another 60s.
    if (owner) adjustCompetitorUnread(queryClient, owner, -1);
    try {
      await api.markSignalRead(id);
    } catch {
      // Revert, or the row reads "read" until the next poll contradicts it — and
      // selectRow fires this without awaiting, so an uncaught rejection would be
      // silent. Mark-unread below has always done this.
      mutateSignals((prev) => prev.map((s) => (s.id === id ? { ...s, isRead: false } : s)));
      if (owner) adjustCompetitorUnread(queryClient, owner, 1);
      toast.error("Couldn't mark read. Try again.");
    }
  }

  async function markUnread(id: string) {
    const owner = unreadOwner(id, false);
    mutateSignals((prev) => prev.map((s) => (s.id === id ? { ...s, isRead: false } : s)));
    if (sample) return;
    if (owner) adjustCompetitorUnread(queryClient, owner, 1);
    try {
      await api.markSignalRead(id, false);
    } catch {
      // The row itself stays optimistically unread here, so leave the count with
      // it: both reconcile on the next poll, and a half-reverted pair would read
      // as a sidebar that disagrees with the feed.
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
      // The sidebar roster carries a per-competitor unread count off the same rows.
      // It polls at 60s, which is fine for a signal read one at a time — but "mark
      // all read" is a deliberate zeroing, so it must not keep a stale count.
      queryClient.invalidateQueries({ queryKey: ["competitors"] });
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
                      queryClient.invalidateQueries({ queryKey: ["competitors"] });
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

  // The list, sectioned. Folding near-duplicates happens INSIDE every sub-group,
  // in every mode — it used to be a mode of its own that the reader had to go and
  // find, which meant the backlog they actually met was the unfolded one.
  const sections = useMemo<Section[]>(() => {
    const sub = (key: string, label: string, items: Signal[]): SubGroup => ({
      key,
      label,
      count: items.length,
      unread: items.reduce((n, s) => (s.isRead ? n : n + 1), 0),
      rows: buildFeedRows(items),
    });

    // Default: the brief's three tiers, competitor by competitor inside each.
    // Insertion order carries the feed's own ranking down into the sub-groups, so
    // the competitor with the most pressing move still heads its tier.
    if (group === "priority") {
      const byTier = new Map<DigestUrgency, Map<string, Signal[]>>();
      for (const sig of filtered) {
        const tier = signalTier(sig);
        let comps = byTier.get(tier);
        if (!comps) {
          comps = new Map();
          byTier.set(tier, comps);
        }
        const items = comps.get(sig.competitorId);
        if (items) items.push(sig);
        else comps.set(sig.competitorId, [sig]);
      }
      return URGENCY_ORDER.flatMap((tier) => {
        const comps = byTier.get(tier);
        if (!comps) return [];
        const subs = [...comps].map(([id, items]) =>
          sub(`${tier}:${id}`, items[0]!.competitorName, items),
        );
        return [
          {
            key: tier,
            label: URGENCY_META[tier].label,
            swatch: URGENCY_META[tier].swatch,
            count: subs.reduce((n, s) => n + s.count, 0),
            unread: subs.reduce((n, s) => n + s.unread, 0),
            subs,
          },
        ];
      });
    }

    if (group === "none") {
      const all = sub("__all", "", filtered);
      return [
        { key: "__all", label: "", count: all.count, unread: all.unread, subs: [all] },
      ];
    }

    const map = new Map<string, { label: string; items: Signal[] }>();
    const order: string[] = [];
    for (const sig of filtered) {
      const { key, label } =
        group === "competitor"
          ? { key: sig.competitorId, label: sig.competitorName }
          : dayGroup(sig.createdAt);
      let g = map.get(key);
      if (!g) {
        g = { label, items: [] };
        map.set(key, g);
        order.push(key);
      }
      g.items.push(sig);
    }
    return order.map((k) => {
      const g = map.get(k)!;
      const only = sub(k, "", g.items);
      return {
        key: k,
        label: g.label,
        count: only.count,
        unread: only.unread,
        subs: [only],
      };
    });
  }, [filtered, group]);

  // What the catch-up strip states, over the unread rows that are LOADED. The
  // headline count beside it is the server's, whole-set — a backlog deeper than
  // one page breaks the breakdown down further as the reader loads more, rather
  // than claiming a total it can't see.
  const catchUp = useMemo(() => {
    const tiers: Record<DigestUrgency, number> = {
      action_required: 0,
      watch: 0,
      fyi: 0,
    };
    const competitors = new Set<string>();
    for (const s of filtered) {
      if (s.isRead) continue;
      tiers[signalTier(s)]++;
      competitors.add(s.competitorId);
    }
    return { tiers, competitors: competitors.size };
  }, [filtered]);

  function toggleFold(key: string) {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Master-detail nav order. Selection (j/k or click) drives the right pane; no
  // inline expansion to traverse. Runs over the VISIBLE rows only, so j/k skips
  // rows hidden inside a collapsed group or a closed fold. The brief leads when
  // there is one. A fold row is NOT in here: it's a disclosure, not a signal, and
  // landing on it would empty the detail pane. It stays reachable by Tab (a plain
  // button in the list, like the group headers).
  const navIds = useMemo(() => {
    const out: string[] = [];
    if (brief) out.push(BRIEF_ID);
    for (const sec of sections) {
      if (sec.label && collapsed.has(sec.key)) continue;
      for (const sub of sec.subs) {
        if (sub.label && collapsed.has(sub.key)) continue;
        for (const row of sub.rows) {
          if (row.kind === "signal") out.push(row.signal.id);
          else if (expandedFolds.has(row.key))
            for (const sig of row.signals) out.push(sig.id);
        }
      }
    }
    return out;
  }, [sections, collapsed, brief, expandedFolds]);

  // Selectable ids = visible signal rows (the brief isn't a signal to act on).
  const selectableIds = useMemo(
    () => navIds.filter((id) => id !== BRIEF_ID),
    [navIds],
  );

  // The first unread row in reading order — what the reader came for. Read off
  // navIds rather than the feed so it is a row they can actually see move: an
  // unread signal inside a collapsed group is not the one to open on arrival.
  const firstUnreadId = useMemo(() => {
    const unread = new Set(filtered.filter((s) => !s.isRead).map((s) => s.id));
    return navIds.find((id) => unread.has(id)) ?? null;
  }, [navIds, filtered]);

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
      queryClient.invalidateQueries({ queryKey: ["competitors"] });
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
  // default to the first UNREAD row on desktop so the detail pane is never empty
  // and lands on the thing the reader came for. Mobile starts unselected
  // (list-first).
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
        // Counts as the default selection having run: without this, Esc on a
        // deep-linked signal fell through to the branch below and snapped the
        // pane back open on another row, so it took two Escs to close one.
        focusedRef.current = "init";
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
      // The first unread, not the top row: the feed is threat-sorted, so on a
      // returning visit the top is usually something already read and the
      // backlog the reader came for stayed one click away. Falls back to the top
      // row — the brief when there is one — once everything is read.
      selectRow(firstUnreadId ?? navIds[0]!);
    }
  }, [focusedId, navIds, focusId, firstUnreadId, selectRow]);

  // A focus that resolves to nothing is the blank right column this ticket is
  // about. The open row can leave the feed without the reader touching it: a poll
  // drops it (marked read while the Unread view is on), a saved view is applied,
  // the week rolls over and the brief goes. `focusedId` then names a row nothing
  // renders, and ~40% of the window goes empty while the list beside it looks
  // normal. Treat it as no focus so the bootstrap above opens the next one, and
  // clear focusedRef with it — a row that vanished is not the reader deselecting.
  useEffect(() => {
    if (!focusedId || !signals?.length) return;
    const resolves =
      focusedId === BRIEF_ID
        ? Boolean(brief)
        : signals.some((s) => s.id === focusedId);
    if (resolves) return;
    focusedRef.current = null;
    setFocusedId(null);
  }, [focusedId, signals, brief, setFocusedId]);

  // The signal backing the detail pane (null when the brief is open, or nothing is).
  // Resolved against the whole loaded feed rather than the filtered view: in the
  // Unread view, reading the open signal drops its row from `filtered`, and
  // resolving there blanked the pane under the reader mid-read. The row leaves the
  // list; what they are reading stays until they move off it.
  const selectedSignal = useMemo<Signal | null>(() => {
    if (!selectedId || selectedId === BRIEF_ID) return null;
    return (signals ?? []).find((s) => s.id === selectedId) ?? null;
  }, [selectedId, signals]);
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

  // This week's funnel, straight from the server (OUT-192). Sample mode has no
  // change history behind its fixtures, so it shows nothing rather than a made-up
  // ratio.
  const funnel = sample ? null : (facetsQ.data?.funnel ?? null);

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
  // empty column): the checkbox overlays the row's competitor avatar, which fades
  // out underneath (SignalRow `selecting`), so the list is a clean single column at
  // rest and the box appears on row hover — or on every row once a selection is
  // live. The severity gauge UNDER it stays lit throughout: it is why the row is
  // worth reading, so hovering must not blank it. left-3/top-2.5 is that avatar's
  // box — it now leads the gutter (row px-3 + row py-2.5), with the gauge stacked
  // beneath it rather than abreast of it.
  // The checkbox is a SIBLING of the row button (never nested — invalid HTML).
  const renderRow = (signal: Signal, showCompetitor: boolean) => {
    const id = signal.id;
    const isChecked = selected.has(id);
    return (
      <motion.div key={id} role="presentation" {...feedItemMotion}>
        <div className="group/row relative">
          <div
            className={cn(
              "absolute left-3 top-2.5 z-10 transition-opacity",
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
            showCompetitor={showCompetitor}
            // Selecting on FOCUS, not only on click: on mobile the detail opens as
            // `fixed inset-0` over the list, so the row under the finger is covered
            // between mousedown and mouseup and the browser retargets the click to a
            // common ancestor — onSelect never fired, and the signal was never marked
            // read. Focus lands before that reflow. Both handlers stay: WebKit does
            // not focus a <button> on tap (so click is the one that fires there, and
            // nothing moves to swallow it), and selectRow is idempotent — the second
            // pass sees isRead and skips the PATCH.
            onFocus={() => selectRow(id)}
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

  // Two cold starts, not one, and the same funnel that dates the header separates
  // them. Zero signals AND zero changes = nothing is being watched yet, and adding a
  // competitor is the answer. Zero signals while changes ARE landing is a different
  // workspace: monitoring works, so "add a competitor" reads as an accusation of not
  // having set the product up, and it sends the reader to the one screen that cannot
  // help. It is also the shape a stalled generation pipeline produces — Activity keeps
  // filling while the feed stays empty — so that state points at the raw changes,
  // where the difference between "nothing was significant" and "nothing was generated"
  // is visible in one look.
  const detectedThisWeek = funnel?.detected ?? 0;

  if (coldStart) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-8">
        {detectedThisWeek > 0 ? (
          <EmptyState
            icon={ScanIcon}
            title="No signals yet"
            description={`Monitoring is running: ${detectedThisWeek} ${detectedThisWeek === 1 ? "change" : "changes"} detected this week, none significant enough to become a signal. The raw changes are on the activity feed.`}
            actions={
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/activity">View activity</Link>
              </Button>
            }
          />
        ) : (
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
        )}
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
            funnel={funnel}
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
            onGroupChange={setGroup}
            onToggleFilter={toggleInSet}
            onClearFilters={clearFilters}
            currentFilters={currentFilters}
            onApplyView={applyView}
            onExportCsv={exportCsv}
            onMarkAllRead={markAllRead}
            onShowShortcuts={() => setHelpOpen(true)}
          />

          {/* Catch-up: a backlog is a volume problem, not a redundancy one, so it
              gets its own answer above the list rather than more grouping inside
              it. Only where an unread count is what the reader came for. */}
          {signals !== null &&
            !catchUpDismissed &&
            quickCounts.unread >= CATCH_UP_UNREAD &&
            (quickView === "all" || quickView === "unread") && (
              <CatchUpBanner
                unread={quickCounts.unread}
                tiers={catchUp.tiers}
                competitors={catchUp.competitors}
                brief={brief !== null}
                onReadBrief={() => selectRow(BRIEF_ID)}
                onMarkAllRead={markAllRead}
                onDismiss={() => setCatchUpDismissed(true)}
              />
            )}

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
                {sections.map((sec) => {
                  const secOpen = !(sec.label && collapsed.has(sec.key));
                  return (
                    <div key={sec.key} className="mb-1 last:mb-0">
                      {sec.label && (
                        <GroupHeader
                          label={sec.label}
                          swatch={sec.swatch}
                          count={sec.count}
                          unread={sec.unread}
                          collapsed={!secOpen}
                          onToggle={() => toggleCollapsed(sec.key)}
                        />
                      )}
                      {secOpen &&
                        sec.subs.map((sub) => {
                          const subOpen = !(sub.label && collapsed.has(sub.key));
                          return (
                            <div key={sub.key}>
                              {sub.label && (
                                <GroupHeader
                                  nested
                                  label={sub.label}
                                  count={sub.count}
                                  unread={sub.unread}
                                  collapsed={!subOpen}
                                  onToggle={() => toggleCollapsed(sub.key)}
                                />
                              )}
                              {subOpen && (
                                <AnimatePresence initial={false} mode="popLayout">
                                  {sub.rows.map((row) =>
                                    row.kind === "signal" ? (
                                      renderRow(row.signal, !sub.label)
                                    ) : (
                                      <motion.div
                                        key={row.key}
                                        role="presentation"
                                        {...feedItemMotion}
                                        // The fold grows in place, so this wrapper keeps
                                        // only its POSITION animated: a full `layout`
                                        // projects the collapsed box over the expanded one
                                        // and scales the whole band and its text while it
                                        // opens, which reads as the row bouncing rather
                                        // than as members appearing under it.
                                        layout="position"
                                      >
                                        <FoldRow
                                          signals={row.signals}
                                          summary={row.summary}
                                          expanded={expandedFolds.has(row.key)}
                                          onToggle={() => toggleFold(row.key)}
                                          showCompetitor={!sub.label}
                                        />
                                        {/* Expansion is INLINE: the members become ordinary
                                            rows, each opening on its own in the detail pane.
                                            They used to appear in one frame, shoving every
                                            row below them down with nothing to say what
                                            pushed. The band opens on the shared disclosure
                                            fold now. `initial={false}` so the members ride
                                            the height instead of each sliding in on top of
                                            it. */}
                                        <AnimatePresence initial={false}>
                                          {expandedFolds.has(row.key) && (
                                            <motion.div key="members" {...disclosureMotion}>
                                              <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-1.5">
                                                {row.signals.map((s) =>
                                                  renderRow(s, !sub.label),
                                                )}
                                              </div>
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </motion.div>
                                    ),
                                  )}
                                </AnimatePresence>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
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
            <DetailPlaceholder
              unread={
                filtered.reduce((n, s) => (s.isRead ? n : n + 1), 0)
              }
              hasRows={filtered.length > 0}
              hasBrief={brief !== null}
              onOpenFirstUnread={
                firstUnreadId ? () => selectRow(firstUnreadId) : null
              }
              onMarkAllRead={markAllRead}
              onReadBrief={() => selectRow(BRIEF_ID)}
            />
          )}
        </div>
      </div>

      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

/**
 * The right column with nothing open. It is roughly 40% of a laptop window, so
 * it carries the next action rather than describing the one the reader did not
 * take (OUT-219). The view opens the first unread on arrival, so what is left
 * for this panel is deselecting (Esc), and a feed the filters emptied.
 */
function DetailPlaceholder({
  unread,
  hasRows,
  hasBrief,
  onOpenFirstUnread,
  onMarkAllRead,
  onReadBrief,
}: {
  /** Unread rows in the current view: the same scope the action opens. */
  unread: number;
  /** false = the filters exclude every signal, so there is nothing to open. */
  hasRows: boolean;
  hasBrief: boolean;
  /** null when no unread row is visible to open. */
  onOpenFirstUnread: (() => void) | null;
  onMarkAllRead: () => void;
  onReadBrief: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      {!hasRows ? (
        // The list beside it already offers "Reset filters"; saying it twice in
        // one screen reads as two different problems.
        <EmptyState
          icon={TrayIcon}
          title="Nothing to open"
          description="No signal matches the current filters."
        />
      ) : unread > 0 && onOpenFirstUnread ? (
        <EmptyState
          icon={ScanIcon}
          title={`${unread} unread signal${unread === 1 ? "" : "s"}`}
          description="The feed is sorted by threat, so the first unread is the one worth reading now."
          actions={
            <>
              <Button size="sm" onClick={onOpenFirstUnread}>
                Open the first unread
              </Button>
              <Button size="sm" variant="ghost" onClick={onMarkAllRead}>
                Mark all read
              </Button>
            </>
          }
        />
      ) : (
        <EmptyState
          icon={CheckIcon}
          tone="positive"
          title="You are all caught up"
          description="Nothing unread here. Pick any signal to reread what changed, why it matters, and what to do."
          actions={
            hasBrief ? (
              <Button size="sm" variant="outline" onClick={onReadBrief}>
                Read this week&apos;s brief
              </Button>
            ) : null
          }
        />
      )}
    </div>
  );
}

// Row selection checkbox — overlays the row's competitor avatar (positioned by the
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
      // -m-2/p-2 grows the press target to 32px while the drawn box stays 16px on
      // the pixel it was on: a 16px target in a 37px row is a miss waiting to
      // happen, and padding is the only way to widen a target without moving the
      // mark it replaces. The hover that darkens the border follows the target
      // (group/box), not the box, so the affordance matches what is clickable.
      className="group/box -m-2 flex shrink-0 rounded-md p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded-sm border transition-colors",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border text-transparent group-hover/box:border-foreground/50",
        )}
      >
        <CheckIcon size={16} />
      </span>
    </button>
  );
}

// A collapsible group header. The section level (a tier, a competitor, a day)
// sticks to the top of the scrolling list so the current group stays labelled
// while scrolling; the `nested` level (a competitor inside a tier) does not — two
// bars stacking as you scroll eats a third of a 400px column.
function GroupHeader({
  label,
  count,
  unread,
  collapsed,
  onToggle,
  swatch,
  nested = false,
}: {
  label: string;
  count: number;
  /** How many of `count` are still unread — the whole point of a collapsed header. */
  unread: number;
  collapsed: boolean;
  onToggle: () => void;
  /** The brief's colour for this tier, so the two surfaces band alike. */
  swatch?: string;
  nested?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={cn(
        // min-h, not padding: the label's own line-height differs between the two
        // levels, so padding alone gave a 30px tier and a 24px competitor — both
        // under the 32px this list wants for something you are meant to hit.
        // Full accent on hover rather than /50: at half strength the fill was
        // indistinguishable from the row hover underneath it, so the header did
        // not read as the clickable thing it is.
        "group/hdr flex w-full items-center gap-1.5 rounded-md px-2 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent",
        nested
          ? "min-h-8 py-1 pl-3"
          : "sticky top-0 z-10 min-h-9 bg-card/95 py-1.5 backdrop-blur",
      )}
    >
      <CaretDownIcon
        size={16}
        className={cn(
          "shrink-0 transition-transform group-hover/hdr:text-foreground",
          // The tier's caret carries the section; the competitor's stays quiet so
          // the two levels don't compete for the same eye.
          nested ? "text-muted-foreground" : "text-foreground",
          collapsed && "-rotate-90",
        )}
        aria-hidden
      />
      {swatch && (
        <span className={cn("size-1.5 shrink-0 rounded-full", swatch)} aria-hidden />
      )}
      <span
        className={cn(
          // Tier over competitor: 14 semibold at full contrast against 13 medium
          // muted. Both were 14/400 before, which flattened the two levels into one.
          "min-w-0 flex-1 truncate",
          nested
            ? "text-dense font-medium text-muted-foreground"
            : "text-sm font-semibold text-foreground",
        )}
      >
        {label}
      </span>
      {unread > 0 && (
        // Dot first, so the two numerals on this line can never be read as one:
        // the tinted pair is what is left to read, the muted one is the total. The
        // dot is the row's unread dot, one size down.
        <span className="flex shrink-0 items-center gap-1 text-meta font-semibold text-primary tabular-nums">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          {unread}
          <span className="sr-only">
            {unread === 1 ? "unread signal" : "unread signals"}
          </span>
        </span>
      )}
      <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
        {count}
        <span className="sr-only"> total</span>
      </span>
    </button>
  );
}
