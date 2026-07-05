"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Persist the collapsed state so hiding the brief sticks across reloads (session
// state alone re-expanded it on every navigation). One flag for the whole workspace.
const COLLAPSE_KEY = "outrival.signalsBrief.collapsed";

// AI executive brief of the current feed (the org's last week of signals). Best-effort:
// renders nothing while it loads, below the server's threshold, on any AI failure, or
// once dismissed for the session. The server caches ~30 min per org, so mounting this on
// the page is cheap — it turns the feed into an answer ("who moved, what to watch") the
// moment the user lands, instead of a list to read top to bottom.
export function SignalsBrief({
  productId,
  enabled = true,
}: {
  productId?: string;
  enabled?: boolean;
}) {
  // Collapsed = hidden to a slim, re-openable bar. Hydrated from localStorage after
  // mount (guarded so SSR and first client render agree, no hydration mismatch).
  const [collapsed, setCollapsed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["signals", "brief", productId ?? null];

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // localStorage blocked (private mode) — stay expanded.
    }
  }, []);

  function setCollapsedPersisted(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Best-effort — the in-session state still applies.
    }
  }

  const q = useQuery({
    queryKey,
    queryFn: () => api.getSignalsBrief(productId),
    // Keep fetching even when collapsed so re-opening is instant (and the collapsed
    // bar only renders when there's actually a brief to show).
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

  const brief = q.data?.brief;
  // Quiet by default: no skeleton flash — the brief just appears once ready, and stays
  // absent when there's nothing worth summarizing.
  if (!brief) return null;

  // Hidden → a slim bar that keeps the brief one click away instead of gone.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsedPersisted(false)}
        aria-label="Show AI brief"
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Sparkles size={14} className="shrink-0" aria-hidden />
        <span className="flex-1 truncate">AI brief</span>
        <ChevronDown size={14} className="shrink-0" aria-hidden />
      </button>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
            <Sparkles size={16} />
          </span>
        </TooltipTrigger>
        <TooltipContent>AI brief, generated from your signals</TooltipContent>
      </Tooltip>
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground/90">
        {brief}
      </p>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh brief"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Hide AI brief"
              onClick={() => setCollapsedPersisted(true)}
            >
              <ChevronUp size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Hide</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
