"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  Radar,
} from "lucide-react";
import { startOfWeek, endOfWeek, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api, type Signal, type ActionStatus, type SavedViewFilters } from "@/lib/api";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
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
import { PageHead } from "./page-head";
import { SignalCard } from "./signal-card";
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
  // Sample / demo mode shared with the Overview (Step 0). When on, the feed reads
  // the fixed fictional dataset and the detail renders read-only — no API writes.
  const [sample, setSample] = useSampleMode();

  const [signals, setSignals] = useState<Signal[] | null>(initialSignals);
  const [err, setErr] = useState<unknown>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Tracks whether the desktop default-selection has run, so deselecting (Esc)
  // doesn't keep snapping back to the first row.
  const focusedRef = useRef<string | null>(null);

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
    if (sample) {
      setSignals(getSampleData().signals);
      return;
    }
    api
      .listSignals({ limit: 200, productId: productId ?? undefined, sort })
      .then((r) => setSignals(r.signals))
      .catch((e) => setErr(e));
  }, [productId, sort, sample]);

  // Server-seeded first paint covers the initial product/sort. Consume the seed
  // once (unless in sample mode), then let load() refetch when product/sort/sample
  // change.
  const seededRef = useRef(initialSignals !== null);
  useEffect(() => {
    if (seededRef.current && !sample) {
      seededRef.current = false;
      return;
    }
    load();
  }, [load, sample]);

  async function markRead(id: string) {
    setSignals((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, isRead: true } : s)) : prev,
    );
    if (sample) return;
    await api.markSignalRead(id);
  }

  async function markUnread(id: string) {
    setSignals((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, isRead: false } : s)) : prev,
    );
    if (sample) return;
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
            if (sample) return;
            Promise.all(
              unreadIds.map((id) => api.markSignalRead(id, false)),
            ).catch(() => toast.error("Couldn't undo. Some signals stay read."));
          },
        },
      },
    );
    if (sample) return;
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

  // Master-detail nav: one id per feed item — a batch is a single selectable row
  // whose members render together in the detail pane. Selection (j/k or click)
  // drives the right pane; no inline expansion to traverse.
  const navIds = useMemo(
    () =>
      feedItems.map((it) =>
        it.kind === "single" ? it.signal.id : `batch:${it.batchId}`,
      ),
    [feedItems],
  );

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
    }
    return false;
  }

  const { focusedId, setFocusedId } = useListKeyboardNav({
    ids: navIds,
    elementId,
    onKey,
  });
  const selectedId = focusedId;

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

  // Bootstrap selection: consume ?focus= once (deep-link from Overview's "Recent
  // signals" / "Critical pending"), else default to the first row on desktop so
  // the detail pane is never empty. Mobile starts unselected (list-first).
  useEffect(() => {
    if (focusedId || !navIds.length) return;
    const wanted = focusId && navIds.includes(focusId) ? focusId : null;
    if (wanted) {
      selectRow(wanted);
      setParam({ focus: null });
      return;
    }
    if (focusedRef.current === "init") return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches
    ) {
      focusedRef.current = "init";
      selectRow(navIds[0]!);
    }
  }, [focusedId, navIds, focusId, selectRow, setParam]);

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
      <SampleBanner />
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
            aria-label="Search signals"
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
        <div className="lg:grid lg:grid-cols-[minmax(320px,380px)_minmax(0,760px)] lg:items-start lg:gap-6">
          {/* Master list — compact, scannable rows; the detail lives on the right. */}
          <div
            role="listbox"
            aria-label="Signals"
            className="divide-y divide-border overflow-hidden rounded-lg border border-border lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto"
          >
            {feedItems.map((item) =>
              item.kind === "single" ? (
                <SignalRow
                  key={item.signal.id}
                  signal={item.signal}
                  selected={selectedId === item.signal.id}
                  onSelect={() => selectRow(item.signal.id)}
                />
              ) : (
                <BatchRow
                  key={item.batchId}
                  batchId={item.batchId}
                  signals={item.signals}
                  summary={item.summary}
                  selected={selectedId === `batch:${item.batchId}`}
                  onSelect={() => selectRow(`batch:${item.batchId}`)}
                />
              ),
            )}
          </div>

          {/* Detail pane — sticky right column on desktop; a full-screen sheet on
              mobile when a row is selected. Rendered once (no duplicate ids). */}
          <div
            className={cn(
              "lg:sticky lg:top-4",
              selectedItem
                ? "fixed inset-0 z-50 overflow-y-auto bg-background p-4 lg:static lg:inset-auto lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0"
                : "hidden lg:block",
            )}
          >
            {selectedItem ? (
              <>
                <button
                  type="button"
                  onClick={() => setFocusedId(null)}
                  className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
                >
                  <ArrowLeft size={14} /> Back to signals
                </button>
                {selectedItem.kind === "single" ? (
                  <div className="space-y-3">
                    <SignalCard
                      signal={selectedItem.signal}
                      interactive={!sample}
                      onMarkRead={!sample ? markRead : undefined}
                      onMarkUnread={!sample ? markUnread : undefined}
                      onActionChange={onActionChange}
                    />
                    {/* The evidence dossier (before/after, visual diff, change
                        breakdown) — what makes the right pane worth its width.
                        Best-effort; renders nothing without structured evidence.
                        Skipped in sample mode (no backend to fetch from). */}
                    {!sample && (
                      <SignalEvidence
                        key={selectedItem.signal.id}
                        signalId={selectedItem.signal.id}
                      />
                    )}
                    <MoreFromCompetitor
                      signal={selectedItem.signal}
                      all={signals ?? []}
                      onSelect={selectRow}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
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
      )}

      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
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
  if (related.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card p-5">
      <div className="mb-3 text-dense font-medium text-muted-foreground">
        More from {signal.competitorName}
      </div>
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
              <time className="shrink-0 font-mono text-meta text-muted-foreground tabular-nums">
                {formatDistanceToNow(new Date(s.createdAt), { addSuffix: false })}
              </time>
            </button>
          </li>
        ))}
      </ul>
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
