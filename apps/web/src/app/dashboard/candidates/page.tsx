"use client";

import { useEffect, useState } from "react";
import {
  X,
  Plus,
  RefreshCw,
  Loader2,
  ExternalLink,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ApiError, api, type CompetitorCandidate } from "@/lib/api";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DetectionConfigSheet } from "@/components/outrival/detection-config-sheet";
import { PageHead } from "@/components/dashboard/page-head";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { GridCardsSkeleton } from "@/components/dashboard/skeletons";

type SortMode = "overlap" | "recent";

export default function CandidatesPage() {
  const [items, setItems] = useState<CompetitorCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>("overlap");
  const [minOverlap, setMinOverlap] = useState(0);

  async function load() {
    try {
      const { candidates } = await api.listCandidates("new");
      setItems(candidates);
    } catch (e) {
      setError(String(e));
    }
  }

  async function runDetection() {
    setRefreshing(true);
    try {
      const { detected } = await api.detectCandidates();
      await load();
      if (detected > 0) {
        toast.success(
          `${detected} new competitor${detected > 1 ? "s" : ""} detected`,
        );
      } else {
        toast.info("No new competitors found");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const retryInSec = Number(e.data.retryInSec) || 0;
        const mins = Math.max(1, Math.ceil(retryInSec / 60));
        toast.error(`Try again in ~${mins} min`, {
          description: "Detection is rate-limited to avoid excess API costs.",
        });
      } else if (e instanceof ApiError && e.data.error === "missing_profile") {
        toast.error("Complete onboarding first", {
          description: "Your product profile is required to detect competitors.",
        });
      } else {
        toast.error("Detection failed", { description: String(e) });
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(id: string) {
    setActingId(id);
    try {
      await api.addCandidate(id);
      setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
      } else {
        setError(String(e));
      }
    } finally {
      setActingId(null);
    }
  }

  async function dismiss(id: string) {
    setActingId(id);
    try {
      await api.dismissCandidate(id);
      setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setActingId(null);
    }
  }

  if (error)
    return <p className="text-sm text-muted-foreground">Error: {error}</p>;

  const view = (items ?? [])
    .filter((c) => (c.overlapScore ?? 0) >= minOverlap)
    .sort((a, b) =>
      sort === "overlap"
        ? (b.overlapScore ?? -1) - (a.overlapScore ?? -1)
        : new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime(),
    );

  return (
    <div className="space-y-[22px]">
      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      <PageHead
        title="Detections"
        sub={
          items && items.length > 0
            ? `${items.length} new competitor${items.length > 1 ? "s" : ""} identified by Exa.ai.`
            : "Automatic detection of similar competitors by AI."
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfigOpen(true)}
            >
              <SlidersHorizontal size={13} />
              Configure
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runDetection}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              {refreshing ? "Detecting…" : "Refresh"}
            </Button>
          </>
        }
      />

      <DetectionConfigSheet open={configOpen} onOpenChange={setConfigOpen} />

      {items === null && (
        <GridCardsSkeleton cards={6} minWidth={320} cardHeight={220} />
      )}

      {items && items.length === 0 && (
        <Card className="px-6 py-12 text-center text-muted-foreground border-dashed">
          <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
            No new competitors to review
          </div>
          <div className="text-[13px] max-w-[380px] mx-auto">
            Detection runs every Sunday evening. The next candidates will
            appear here as soon as they cross the configured overlap threshold.
          </div>
        </Card>
      )}

      {items && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={sort}
            onValueChange={(v) => v && setSort(v as SortMode)}
          >
            <ToggleGroupItem value="overlap">Overlap</ToggleGroupItem>
            <ToggleGroupItem value="recent">Recent</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(minOverlap)}
            onValueChange={(v) => v !== "" && setMinOverlap(Number(v))}
          >
            <ToggleGroupItem value="0">All</ToggleGroupItem>
            <ToggleGroupItem value="70">≥ 70</ToggleGroupItem>
            <ToggleGroupItem value="85">≥ 85</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {items && items.length > 0 && view.length === 0 && (
        <Card className="px-6 py-10 text-center text-sm text-muted-foreground border-dashed">
          No candidate above this overlap threshold.
        </Card>
      )}

      {view.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
          {view.map((c) => {
            const name = c.title ?? c.url.replace(/^https?:\/\//, "");
            const overlap =
              c.overlapScore != null ? Math.round(c.overlapScore) : null;
            return (
              <Card key={c.id}>
                <div className="p-[18px] flex flex-col flex-1">
                  <div className="flex items-center gap-2.5 mb-3.5">
                    <CompAvatar name={name} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[15px]">{name}</div>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 min-w-0 text-muted-foreground/80 hover:text-primary transition-colors text-[11px] font-mono"
                      >
                        <span className="truncate">{c.url}</span>
                        <ExternalLink size={10} className="shrink-0" />
                      </a>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.source === "onboarding" && (
                        <StatusPill status="neutral">from setup</StatusPill>
                      )}
                      <StatusPill status="warn">new</StatusPill>
                    </div>
                  </div>

                  {overlap != null && (
                    <div className="mb-3.5">
                      <div className="flex justify-between text-[11px] text-muted-foreground mb-1.5">
                        <span>Estimated overlap</span>
                        <span className="tabular-nums font-mono">
                          {overlap}/100
                        </span>
                      </div>
                      <div className="h-2 bg-background rounded border border-border overflow-hidden">
                        <span
                          className="block h-full bg-primary rounded"
                          style={{ width: `${overlap}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {c.reason && (
                    <p className="text-[13px] leading-snug m-0 mb-3.5 text-muted-foreground">
                      <span className="text-primary font-mono text-[10px] tracking-widest uppercase mr-1.5">
                        reason
                      </span>
                      {c.reason}
                    </p>
                  )}

                  <div className="flex justify-between items-center text-[11px] text-muted-foreground/80 mb-3.5 font-mono mt-auto">
                    <span>via Exa.ai</span>
                    <span>
                      detected {formatDistanceToNow(new Date(c.firstSeenAt), { addSuffix: true })}
                    </span>
                  </div>

                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={actingId === c.id}
                      onClick={() => add(c.id)}
                    >
                      {actingId === c.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Plus size={11} />
                      )}
                      Track
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actingId === c.id}
                          onClick={() => dismiss(c.id)}
                          aria-label="Dismiss"
                        >
                          <X size={11} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Dismiss</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
