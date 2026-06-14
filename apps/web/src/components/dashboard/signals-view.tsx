"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Download,
  Check,
  Search,
  SlidersHorizontal,
  X,
  ChevronDown,
  ArrowUpDown,
  Keyboard,
} from "lucide-react";
import { startOfWeek, endOfWeek } from "date-fns";
import { toast } from "sonner";
import { api, type Signal, type ActionStatus, type SavedViewFilters } from "@/lib/api";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SavedViewsMenu } from "./saved-views-menu";
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
import { SignalCard } from "./signal-card";
import { ShortcutsHelp } from "./shortcuts-help";
import { ListRowsSkeleton } from "./skeletons";
import { ListError } from "@/components/outrival/list-error";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";

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

export function SignalsView({
  initialSignals = null,
}: { initialSignals?: Signal[] | null } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [signals, setSignals] = useState<Signal[] | null>(initialSignals);
  const [err, setErr] = useState<unknown>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Signals read automatically by dwell (vs. an explicit click / "Mark all read").
  // Only these can be reverted to unread by clicking the card.
  const [autoReadIds, setAutoReadIds] = useState<Set<string>>(new Set());
  // Batch open/close lifted here (was BatchGroupCard-local) so keyboard nav knows
  // which member cards are visible and can traverse into an expanded group.
  const [openBatches, setOpenBatches] = useState<Set<string>>(new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const focusedRef = useRef<string | null>(null);

  function toggleBatch(batchId: string) {
    setOpenBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  const focusId = searchParams.get("focus");
  const quickView = (searchParams.get("view") as QuickView) || "all";
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

  // patch-28 — scope the feed to the active product (selector sets ?product=);
  // absent = aggregate "All products".
  const productId = searchParams.get("product");

  // P0 — feed ordering. Default "threat" (server ranks by severity × overlap ×
  // relevance); "recent" restores the chronological feed. Server-side, so changing
  // it re-fetches.
  const sort = searchParams.get("sort") === "recent" ? "recent" : "threat";

  const load = useCallback(() => {
    setErr(null);
    api
      .listSignals({ limit: 200, productId: productId ?? undefined, sort })
      .then((r) => setSignals(r.signals))
      .catch((e) => setErr(e));
  }, [productId, sort]);

  // Server-seeded first paint covers the initial product/sort. Consume the seed
  // once, then let load() refetch normally when product/sort change.
  const seededRef = useRef(initialSignals !== null);
  useEffect(() => {
    if (seededRef.current) {
      seededRef.current = false;
      return;
    }
    load();
  }, [load]);

  // patch-29 — arriving from a "Recent signals" link (?focus=<id>): scroll the
  // matching card into view and flash it, then drop the param so it doesn't re-fire.
  useEffect(() => {
    if (!focusId || !signals) return;
    if (focusedRef.current === focusId) return;
    const el = document.getElementById(`signal-${focusId}`);
    if (!el) return;
    focusedRef.current = focusId;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(focusId);
    const t = setTimeout(() => {
      setHighlightId(null);
      setParam({ focus: null });
    }, 1900);
    return () => clearTimeout(t);
  }, [focusId, signals, setParam]);

  async function markRead(id: string) {
    // Explicit read: drop any auto-read flag so the card stops offering "mark unread".
    setAutoReadIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSignals((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, isRead: true } : s)) : prev,
    );
    await api.markSignalRead(id);
  }

  // Dwell auto-read (patch): the card scrolled into view and the user lingered on it.
  // Tracked separately so a click can undo it; an explicit read can't be undone this way.
  async function autoRead(id: string) {
    setAutoReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSignals((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, isRead: true } : s)) : prev,
    );
    try {
      await api.markSignalRead(id);
    } catch {
      // Roll back the optimistic read so the dwell observer can retry.
      setAutoReadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSignals((prev) =>
        prev ? prev.map((s) => (s.id === id ? { ...s, isRead: false } : s)) : prev,
      );
    }
  }

  async function markUnread(id: string) {
    setAutoReadIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSignals((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, isRead: false } : s)) : prev,
    );
    try {
      await api.markSignalRead(id, false);
    } catch {
      toast.error("Couldn't mark unread. Try again.");
    }
  }

  async function markAllRead() {
    const unreadIds = (signals ?? []).filter((s) => !s.isRead).map((s) => s.id);
    if (unreadIds.length === 0) return;
    const idSet = new Set(unreadIds);
    // Optimistic: flip them all read locally, then reconcile with the server.
    setSignals((prev) =>
      prev ? prev.map((s) => (idSet.has(s.id) ? { ...s, isRead: true } : s)) : prev,
    );
    toast.success(
      `${unreadIds.length} signal${unreadIds.length > 1 ? "s" : ""} marked read`,
      {
        action: {
          label: "Undo",
          onClick: () => {
            setSignals((prev) =>
              prev
                ? prev.map((s) =>
                    idSet.has(s.id) ? { ...s, isRead: false } : s,
                  )
                : prev,
            );
            Promise.all(
              unreadIds.map((id) => api.markSignalRead(id, false)),
            ).catch(() => toast.error("Couldn't undo. Some signals stay read."));
          },
        },
      },
    );
    try {
      await Promise.all(unreadIds.map((id) => api.markSignalRead(id)));
    } catch {
      toast.error("Couldn't mark all read. Try again.");
    }
  }

  // Intel → action loop (Phase B): SignalCard persists the status; keep the local
  // array in sync so the "Actions" tab and its count update immediately.
  function onActionChange(id: string, status: ActionStatus | null) {
    setSignals((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, actionStatus: status } : s)) : prev,
    );
  }

  const filtered = useMemo(() => {
    if (!signals) return [];
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
  }, [signals, sev, cat, comp, quickView, query]);

  // Collapse batched signals (patch-26) into one group, preserving the feed order
  // (the group sits at its first member's position). A batch left with a single
  // visible member after filtering degrades back to a normal card.
  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    const batchAt = new Map<string, number>();
    for (const s of filtered) {
      if (s.batchedIntoId) {
        const at = batchAt.get(s.batchedIntoId);
        if (at != null) {
          (items[at] as Extract<FeedItem, { kind: "batch" }>).signals.push(s);
          continue;
        }
        batchAt.set(s.batchedIntoId, items.length);
        items.push({
          kind: "batch",
          batchId: s.batchedIntoId,
          summary: s.batchSummary,
          count: s.batchCount ?? 1,
          signals: [s],
        });
      } else {
        items.push({ kind: "single", signal: s });
      }
    }
    return items.map((it) =>
      it.kind === "batch" && it.signals.length === 1
        ? ({ kind: "single", signal: it.signals[0]! } as FeedItem)
        : it,
    );
  }, [filtered]);

  // Deep-linking to a batched member (?focus=) opens its group so the scroll-into-
  // view target exists (mirrors the old BatchGroupCard-local auto-open).
  useEffect(() => {
    if (!focusId) return;
    const batch = feedItems.find(
      (it) => it.kind === "batch" && it.signals.some((s) => s.id === focusId),
    );
    if (batch && batch.kind === "batch")
      setOpenBatches((prev) =>
        prev.has(batch.batchId) ? prev : new Set(prev).add(batch.batchId),
      );
  }, [focusId, feedItems]);

  // Keyboard nav (j/k) traverses single cards plus the members of any open batch,
  // in feed order. A collapsed batch is one focusable header (Enter expands it).
  const navIds = useMemo(() => {
    const out: string[] = [];
    for (const it of feedItems) {
      if (it.kind === "single") out.push(it.signal.id);
      else {
        out.push(`batch:${it.batchId}`);
        if (openBatches.has(it.batchId))
          for (const s of it.signals) out.push(s.id);
      }
    }
    return out;
  }, [feedItems, openBatches]);

  const elementId = useCallback(
    (id: string) =>
      id.startsWith("batch:") ? `signal-batch-${id.slice(6)}` : `signal-${id}`,
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
    if (!fid) return false;
    if (fid.startsWith("batch:")) {
      if (key === "Enter" || key === "o") {
        toggleBatch(fid.slice(6));
        return true;
      }
      return false;
    }
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
      case "t":
      case "c":
        // The card owns these (open its Track dropdown / toggle comments) via
        // real React state. Dispatch a CustomEvent on its root; the card listens.
        document
          .getElementById(`signal-${fid}`)
          ?.dispatchEvent(
            new CustomEvent("signal-kbd", {
              detail: key === "t" ? "track" : "discuss",
            }),
          );
        return true;
    }
    return false;
  }

  const { focusedId } = useListKeyboardNav({ ids: navIds, elementId, onKey });

  const quickCounts = useMemo(() => {
    if (!signals) return { all: 0, alerts: 0, unread: 0, week: 0, critical: 0, actions: 0 };
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
    let alerts = 0;
    let unread = 0;
    let week = 0;
    let critical = 0;
    let actions = 0;
    for (const s of signals) {
      if (!s.isRead) unread++;
      const t = new Date(s.createdAt).getTime();
      if (t >= weekStart && t <= weekEnd) week++;
      if (s.severity === "critical") critical++;
      if (s.severity === "critical" || s.severity === "high") alerts++;
      if (s.actionStatus === "todo" || s.actionStatus === "doing") actions++;
    }
    return { all: signals.length, alerts, unread, week, critical, actions };
  }, [signals]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    (signals ?? []).forEach((s) => set.add(s.category));
    return Array.from(set).sort();
  }, [signals]);

  const allCompetitors = useMemo(() => {
    const m = new Map<string, string>();
    (signals ?? []).forEach((s) => m.set(s.competitorId, s.competitorName));
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [signals]);

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
  };
  function applyView(f: SavedViewFilters) {
    setParam({
      severity: f.severities?.length ? f.severities.join(",") : null,
      category: f.categories?.length ? f.categories.join(",") : null,
      competitor: f.competitorIds?.length ? f.competitorIds.join(",") : null,
      view: f.view && f.view !== "all" ? f.view : null,
    });
  }

  function exportCsv() {
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
  }

  if (err && signals === null) {
    return (
      <div className="space-y-6">
        <PageHead title="Signals" sub="Classified by AI." />
        <ListError error={err} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHead
        title="Signals"
        sub={
          signals
            ? `Classified by AI · ${signals.length} signal${signals.length > 1 ? "s" : ""}.`
            : "Loading…"
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={!signals || filtered.length === 0}
            >
              <Download size={13} /> CSV
            </Button>
            <Button
              size="sm"
              onClick={markAllRead}
              disabled={!signals || !signals.some((s) => !s.isRead)}
            >
              <Check size={13} /> Mark all read
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <Tabs
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

        <div className="flex-1" />

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
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => setParam({ sort: null })}
            >
              Most relevant
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={sort === "recent"}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => setParam({ sort: "recent" })}
            >
              Most recent
            </DropdownMenuCheckboxItem>
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
                <span className="flex items-center gap-2">
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
                    {c}
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
            placeholder="Search…"
            value={query}
            onChange={(e) => setParam({ q: e.target.value || null })}
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
              {s}
            </FilterChip>
          ))}
          {Array.from(cat).map((c) => (
            <FilterChip key={`c-${c}`} onRemove={() => toggleInSet("category", c)}>
              {c}
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
        <ListRowsSkeleton rows={5} />
      ) : filtered.length === 0 ? (
        <Card className="px-6 py-12 text-center text-muted-foreground">
          <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
            No matching signals
          </div>
          <div className="text-sm max-w-[380px] mx-auto">
            {signals.length === 0
              ? "No signals detected yet. The first ones will appear here after the next scan."
              : "Current filters exclude every signal. Remove one to see results."}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          <AnimatePresence initial={false} mode="popLayout">
            {feedItems.map((item) =>
              item.kind === "single" ? (
                <motion.div key={item.signal.id} {...feedItemMotion}>
                  <SignalCard
                    signal={item.signal}
                    onMarkRead={markRead}
                    onAutoRead={autoRead}
                    onMarkUnread={markUnread}
                    wasAutoRead={autoReadIds.has(item.signal.id)}
                    onActionChange={onActionChange}
                    highlight={item.signal.id === highlightId}
                    focused={focusedId === item.signal.id}
                  />
                </motion.div>
              ) : (
                <motion.div key={item.batchId} {...feedItemMotion}>
                  <BatchGroupCard
                    item={item}
                    open={openBatches.has(item.batchId)}
                    onToggleOpen={() => toggleBatch(item.batchId)}
                    focusedId={focusedId}
                    autoReadIds={autoReadIds}
                    highlightId={highlightId}
                    onMarkRead={markRead}
                    onAutoRead={autoRead}
                    onMarkUnread={markUnread}
                    onActionChange={onActionChange}
                  />
                </motion.div>
              ),
            )}
          </AnimatePresence>
        </div>
      )}

      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

// Collapsed batch of similar signals (patch-26): one summary card that expands to
// the member signals. Replaces N near-duplicate cards in the feed.
function BatchGroupCard({
  item,
  open,
  onToggleOpen,
  focusedId,
  autoReadIds,
  highlightId,
  onMarkRead,
  onAutoRead,
  onMarkUnread,
  onActionChange,
}: {
  item: Extract<FeedItem, { kind: "batch" }>;
  // Open/close is controlled by the parent so keyboard nav can traverse members.
  open: boolean;
  onToggleOpen: () => void;
  focusedId: string | null;
  autoReadIds: Set<string>;
  highlightId: string | null;
  onMarkRead: (id: string) => void;
  onAutoRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onActionChange: (id: string, status: ActionStatus | null) => void;
}) {
  const first = item.signals[0]!;
  const maxSev = item.signals.reduce<Sev>(
    (m, s) => (SEV_RANK[s.severity] > SEV_RANK[m] ? s.severity : m),
    "low",
  );
  const unreadCount = item.signals.filter((s) => !s.isRead).length;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        id={`signal-batch-${item.batchId}`}
        tabIndex={-1}
        aria-expanded={open}
        aria-label={`${first.competitorName}: ${item.signals.length} similar ${first.category} signals`}
        onClick={onToggleOpen}
        className={cn(
          "flex w-full items-center gap-3 p-5 text-left outline-none transition-colors hover:bg-muted/30",
          focusedId === `batch:${item.batchId}` &&
            "ring-2 ring-inset ring-primary/70",
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", SEV_DOT[maxSev])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-semibold">{first.competitorName}</span>
            <span className="text-xs text-muted-foreground">
              {/* Reflect what's actually grouped here (filters/hidden/limit can trim
                  the batch), not the stored batch count which may diverge. */}
              {item.signals.length} similar {first.category} signals
            </span>
            {unreadCount > 0 && <span className="size-1.5 rounded-full bg-primary" />}
          </div>
          {item.summary && (
            <p className="mt-1 text-sm leading-snug text-foreground/85">{item.summary}</p>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-border bg-muted/20 p-2.5">
          {item.signals.map((s) => (
            <SignalCard
              key={s.id}
              signal={s}
              onMarkRead={onMarkRead}
              onAutoRead={onAutoRead}
              onMarkUnread={onMarkUnread}
              wasAutoRead={autoReadIds.has(s.id)}
              onActionChange={onActionChange}
              highlight={s.id === highlightId}
              focused={focusedId === s.id}
            />
          ))}
        </div>
      )}
    </Card>
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
