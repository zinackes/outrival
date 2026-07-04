"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["signals", "brief", productId ?? null];

  const q = useQuery({
    queryKey,
    queryFn: () => api.getSignalsBrief(productId),
    enabled: enabled && !dismissed,
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
  if (dismissed || !brief) return null;

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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss brief"
          onClick={() => setDismissed(true)}
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
