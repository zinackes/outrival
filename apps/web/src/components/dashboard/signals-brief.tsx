"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowsClockwiseIcon, SparkleIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The AI executive brief of the current feed — "who moved, what to watch" — so
 * landing on Signals gives an answer before it gives a list.
 *
 * In the workspace it is a pinned row at the top of the list that opens in the
 * detail pane, where a paragraph has the width to be read. Best-effort: below
 * the server's threshold, or on any AI failure, there is no brief and no row.
 */
export function useSignalsBrief(productId?: string, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = ["signals", "brief", productId ?? null];
  const [refreshing, setRefreshing] = useState(false);

  const q = useQuery({
    queryKey,
    queryFn: () => api.getSignalsBrief(productId),
    enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await api.getSignalsBrief(productId, true);
      queryClient.setQueryData(queryKey, res);
    } catch {
      // Keep the current brief on a failed refresh.
    } finally {
      setRefreshing(false);
    }
  }

  return {
    brief: q.data?.brief ?? null,
    count: q.data?.count ?? 0,
    refresh,
    refreshing,
  };
}

/** The pinned list row. Selecting it opens the brief in the detail pane. */
export function SignalsBriefRow({
  count,
  selected,
  onSelect,
  onFocus,
  tabStop = false,
}: {
  count: number;
  selected: boolean;
  onSelect: () => void;
  onFocus?: () => void;
  tabStop?: boolean;
}) {
  return (
    <button
      type="button"
      id="row-brief"
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      onFocus={onFocus}
      onClick={onSelect}
      className={cn(
        "group grid w-full grid-cols-[auto_1fr] items-start gap-x-2.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/50 focus-visible:bg-accent/50",
      )}
    >
      {/* Sits in the signal rows' avatar slot (row px-3 + the 10px severity gauge
          + its 6px gap), so this row and the feed under it share one text column.
          The gauge slot stays empty: the brief has no severity of its own. */}
      <span className="mt-0.5 ml-4 flex w-[18px] shrink-0 justify-center">
        <SparkleIcon size={16} className="text-link" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-dense font-semibold text-foreground">
          Brief of the week
        </span>
        <span className="mt-1 block truncate text-meta text-muted-foreground">
          What moved, in one read
          {count > 0 && (
            <>
              {" · "}
              <span className="tabular-nums">{count}</span> signal
              {count === 1 ? "" : "s"}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/** The brief itself, in the detail column. */
export function SignalsBriefPanel({
  brief,
  count,
  refresh,
  refreshing,
  onBack,
}: {
  brief: string;
  count: number;
  refresh: () => void;
  refreshing: boolean;
  onBack?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur-md lg:px-6">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Back to signals"
            onClick={onBack}
          >
            <ArrowLeftIcon size={16} />
          </Button>
        )}
        <SparkleIcon size={16} className="shrink-0 text-link" aria-hidden />
        <span className="text-dense font-semibold">Brief of the week</span>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={refresh}
          disabled={refreshing}
        >
          <ArrowsClockwiseIcon size={16} className={cn(refreshing && "animate-spin")} />
          <span className="hidden xl:inline">Regenerate</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] px-5 py-6 lg:px-8">
          <p className="text-lead leading-relaxed text-foreground/90">{brief}</p>
          <p className="mt-5 border-t border-border pt-4 text-dense text-muted-foreground">
            Written by Outrival from{" "}
            <span className="tabular-nums">{count}</span> signal
            {count === 1 ? "" : "s"} in your feed. Open any signal on the left for the
            evidence behind it.
          </p>
        </div>
      </div>
    </div>
  );
}
