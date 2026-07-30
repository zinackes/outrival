"use client";

import {
  ArrowsDownUpIcon,
  CheckIcon,
  DownloadSimpleIcon,
  KeyboardIcon,
  DotsThreeIcon,
  RowsIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "@/components/icons";
import type { SavedViewFilters, Signal } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { SavedViewsMenu } from "./saved-views-menu";
import { CatText } from "./cat-pill";
import { CompAvatar } from "./comp-avatar";

export type Sev = Signal["severity"];
export type QuickView =
  | "all"
  | "alerts"
  | "unread"
  | "week"
  | "critical"
  | "actions";

// patch-29 — "Alerts" surfaces the urgent feed (critical + high) as a first-class
// tab, replacing the standalone /dashboard/alerts page in the navigation.
// The intel→action board still lives per-signal (Track); it's no longer a feed tab.
export const QUICK_VIEWS: { value: QuickView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "alerts", label: "Alerts" },
  { value: "unread", label: "Unread" },
  { value: "week", label: "Week" },
  { value: "critical", label: "Critical" },
];

export const SEVERITIES: Sev[] = ["critical", "high", "medium", "low"];

export const SEV_DOT: Record<Sev, string> = {
  critical: "bg-critical",
  high: "bg-high",
  medium: "bg-medium",
  low: "bg-muted-foreground/45",
};

// Master-list grouping (client-only — pure presentation, never touches feedParams
// so it costs no refetch). Persisted in ?group= so a refresh keeps the view.
export const GROUP_MODES = ["none", "competitor", "day"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];
export const GROUP_LABEL: Record<GroupMode, string> = {
  none: "No grouping",
  competitor: "By competitor",
  day: "By day",
};

export type FilterKey = "severity" | "category" | "competitor";

/**
 * The list column's fixed head: identity, scope, and the tools that narrow the
 * feed. Every control writes through the single `setParam` mutator the view owns,
 * so this stays presentational — it holds no feed state of its own.
 */
export function SignalsListHeader({
  loading,
  total,
  unreadCount,
  quickView,
  quickCounts,
  sort,
  group,
  sev,
  cat,
  comp,
  allCategories,
  allCompetitors,
  searchInput,
  onSearchInput,
  setParam,
  onToggleFilter,
  onClearFilters,
  currentFilters,
  onApplyView,
  onExportCsv,
  onMarkAllRead,
  onShowShortcuts,
}: {
  loading: boolean;
  total: number;
  unreadCount: number;
  quickView: QuickView;
  quickCounts: Record<QuickView, number>;
  sort: "threat" | "recent";
  group: GroupMode;
  sev: Set<Sev>;
  cat: Set<string>;
  comp: Set<string>;
  allCategories: string[];
  allCompetitors: { id: string; name: string; url?: string | null }[];
  searchInput: string;
  onSearchInput: (value: string) => void;
  setParam: (updates: Record<string, string | null>) => void;
  onToggleFilter: (key: FilterKey, value: string) => void;
  onClearFilters: () => void;
  currentFilters: SavedViewFilters;
  onApplyView: (filters: SavedViewFilters) => void;
  onExportCsv: () => void;
  onMarkAllRead: () => void;
  onShowShortcuts: () => void;
}) {
  const activeFilterCount = sev.size + cat.size + comp.size;

  // No bottom border on the wrapper: the tab underline at the foot of this block
  // is the header's rule — one line doing both jobs.
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 px-4 pt-3.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="text-lg font-semibold tracking-tight">Signals</h1>
          {/* Scope, on the title's own line. The old second line also announced
              "classified by AI" — how a signal was produced isn't something the
              reader acts on here, and it cost a line of chrome above the feed. */}
          <span className="truncate text-meta text-muted-foreground">
            {loading ? (
              "Loading…"
            ) : (
              <>
                <span className="tabular-nums">{total}</span> signal
                {total === 1 ? "" : "s"}
                {unreadCount > 0 && (
                  <>
                    {" · "}
                    <span className="tabular-nums">{unreadCount}</span> unread
                  </>
                )}
              </>
            )}
          </span>
        </div>
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Feed actions">
              <DotsThreeIcon size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onSelect={onMarkAllRead}
              disabled={loading || unreadCount === 0}
            >
              <CheckIcon size={16} /> Mark all read
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExportCsv} disabled={loading || total === 0}>
              <DownloadSimpleIcon size={16} /> Export CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onShowShortcuts}>
              <KeyboardIcon size={16} /> KeyboardIcon shortcuts
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-1.5 px-4 py-2.5">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon
            size={16}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="signals-search"
            aria-label="Search signals"
            placeholder="Search…"
            value={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
            className="h-8 w-full pl-8 text-sm"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={activeFilterCount > 0 ? "secondary" : "outline"}
              size="sm"
              className="h-8 shrink-0"
            >
              <SlidersHorizontalIcon size={16} />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-meta tabular-nums text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[480px] w-64 overflow-y-auto" align="end">
            <DropdownMenuLabel>Severity</DropdownMenuLabel>
            {SEVERITIES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={sev.has(s)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => onToggleFilter("severity", s)}
              >
                <span className="flex items-center gap-2 capitalize">
                  <span className={cn("inline-block size-2 rounded-full", SEV_DOT[s])} />
                  {s}
                </span>
              </DropdownMenuCheckboxItem>
            ))}

            {allCategories.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Category</DropdownMenuLabel>
                {/* The category wears its wayfinding hue as INK, the same way it
                    reads on every feed row — no swatch: a dot beside a word that is
                    already the colour says the same thing twice. */}
                {allCategories.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c}
                    checked={cat.has(c)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => onToggleFilter("category", c)}
                  >
                    <CatText category={c} />
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
                    onCheckedChange={() => onToggleFilter("competitor", c.id)}
                    className="gap-2"
                  >
                    <CompAvatar name={c.name} url={c.url} size={16} />
                    <span className="min-w-0 truncate">{c.name}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}

            {activeFilterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onClearFilters}
                  className="text-xs text-muted-foreground"
                >
                  Reset filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <SavedViewsMenu compact current={currentFilters} onApply={onApplyView} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              aria-label={`Order and grouping: ${
                sort === "recent" ? "most recent" : "most relevant"
              }, ${GROUP_LABEL[group].toLowerCase()}`}
              title="Order and grouping"
            >
              <ArrowsDownUpIcon size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Order by</DropdownMenuLabel>
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
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <RowsIcon size={16} /> Group by
            </DropdownMenuLabel>
            {GROUP_MODES.map((m) => (
              <DropdownMenuCheckboxItem
                key={m}
                checked={group === m}
                onCheckedChange={() => setParam({ group: m === "none" ? null : m })}
              >
                {GROUP_LABEL[m]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5">
          {Array.from(sev).map((s) => (
            <FilterChip key={`s-${s}`} onRemove={() => onToggleFilter("severity", s)}>
              <span className={cn("inline-block size-2 rounded-full", SEV_DOT[s])} />
              <span className="capitalize">{s}</span>
            </FilterChip>
          ))}
          {/* The chips mirror the menu's encoding — a category that is coloured in the
              list and grey once picked would read as a broken state, not a choice. */}
          {Array.from(cat).map((c) => (
            <FilterChip key={`c-${c}`} onRemove={() => onToggleFilter("category", c)}>
              <CatText category={c} />
            </FilterChip>
          ))}
          {Array.from(comp).map((c) => {
            const match = allCompetitors.find((x) => x.id === c);
            return (
              <FilterChip
                key={`comp-${c}`}
                onRemove={() => onToggleFilter("competitor", c)}
              >
                {match && <CompAvatar name={match.name} url={match.url} size={14} />}
                {match?.name ?? c}
              </FilterChip>
            );
          })}
          <button
            onClick={onClearFilters}
            className="px-1 text-dense text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      {/* The tab underline doubles as the header's bottom rule — one line, two jobs. */}
      <Tabs
        className="min-w-0 gap-0"
        value={quickView}
        onValueChange={(v) => setParam({ view: v === "all" ? null : v })}
      >
        <TabsList variant="line" className="justify-start px-2.5">
          {QUICK_VIEWS.map((v) => (
            <TabsTrigger key={v.value} value={v.value} className="px-2.5">
              {v.label}
              {/* A zero is not worth a figure: "Unread 0" advertised an empty view
                  on every render. The tab stays reachable, just unlabelled. */}
              {quickCounts[v.value] > 0 && (
                <span className="text-meta tabular-nums text-muted-foreground">
                  {quickCounts[v.value]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
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
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-xs">
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onRemove}
            className="ml-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Remove filter"
          >
            <XIcon size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Remove filter</TooltipContent>
      </Tooltip>
    </span>
  );
}
