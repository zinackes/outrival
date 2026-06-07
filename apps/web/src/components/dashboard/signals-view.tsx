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
import { ListRowsSkeleton } from "./skeletons";
import { ListError } from "@/components/outrival/list-error";

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

  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Signals read automatically by dwell (vs. an explicit click / "Mark all read").
  // Only these can be reverted to unread by clicking the card.
  const [autoReadIds, setAutoReadIds] = useState<Set<string>>(new Set());
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
    api
      .listSignals({ limit: 200, productId: productId ?? undefined, sort })
      .then((r) => setSignals(r.signals))
      .catch((e) => setErr(e));
  }, [productId, sort]);

  useEffect(() => {
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
    const unread = (signals ?? []).filter((s) => !s.isRead);
    await Promise.all(unread.map((s) => api.markSignalRead(s.id)));
    setSignals((prev) =>
      prev ? prev.map((s) => ({ ...s, isRead: true })) : prev,
    );
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
      <div className="space-y-[22px]">
        <PageHead title="Signals" sub="Classified by AI." />
        <ListError error={err} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-[22px]">
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
                      "w-[7px] h-[7px] rounded-full inline-block",
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
            placeholder="Search…"
            value={query}
            onChange={(e) => setParam({ q: e.target.value || null })}
            className="h-8 pl-8 text-dense w-48"
          />
        </div>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap -mt-2">
          {Array.from(sev).map((s) => (
            <FilterChip key={`s-${s}`} onRemove={() => toggleInSet("severity", s)}>
              <span
                className={cn(
                  "w-[7px] h-[7px] rounded-full inline-block",
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
            {filtered.map((s) => (
              <motion.div key={s.id} id={`signal-${s.id}`} {...feedItemMotion}>
                <SignalCard
                  signal={s}
                  onMarkRead={markRead}
                  onAutoRead={autoRead}
                  onMarkUnread={markUnread}
                  wasAutoRead={autoReadIds.has(s.id)}
                  onActionChange={onActionChange}
                  highlight={s.id === highlightId}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
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
