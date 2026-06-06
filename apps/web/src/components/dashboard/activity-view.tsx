"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { api, type ActivitySource, type ActivityEvent } from "@/lib/api";
import { sourceLabel } from "@/lib/source-labels";
import { Button } from "@/components/ui/button";
import { PageHead } from "./page-head";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 25;

const EVENT_META: Record<ActivityEvent["status"], { label: string; color: string }> = {
  success: { label: "Change detected", color: "var(--positive)" },
  no_change: { label: "No change", color: "var(--muted-foreground)" },
  failed: { label: "Couldn't reach", color: "var(--critical)" },
};

function rel(iso: string | null): string {
  if (!iso) return "never";
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

function duration(ms: number): string {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
      aria-hidden
    />
  );
}

// User-facing activity: every scrape Outrival ran for the org — including the
// no-change runs and failures the Signals feed never surfaces, and what each
// "change detected" run actually found. Filterable by competitor, source, status.
export function ActivityView() {
  const [sources, setSources] = useState<ActivitySource[] | null>(null);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [competitor, setCompetitor] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");

  // Filter options come from the full set of monitored sources, not the paginated feed.
  useEffect(() => {
    let cancelled = false;
    api
      .activityHealth()
      .then((r) => !cancelled && setSources(r.sources))
      .catch(() => !cancelled && setSources([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const competitorOptions = useMemo(() => {
    if (!sources) return [];
    const m = new Map<string, string>();
    for (const s of sources) m.set(s.competitorId, s.competitorName);
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sources]);

  const sourceOptions = useMemo(() => {
    if (!sources) return [];
    return [...new Set(sources.map((s) => s.sourceType))].sort();
  }, [sources]);

  const filterParams = useMemo(
    () => ({
      competitorId: competitor !== "all" ? competitor : undefined,
      sourceType: source !== "all" ? source : undefined,
      status: status !== "all" ? (status as ActivityEvent["status"]) : undefined,
    }),
    [competitor, source, status],
  );

  const isFiltered = competitor !== "all" || source !== "all" || status !== "all";

  // Refetch the feed (server-side) whenever a filter changes.
  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    api
      .activityTimeline({ limit: PAGE_SIZE, ...filterParams })
      .then((r) => {
        if (cancelled) return;
        setEvents(r.events);
        setHasMore(r.events.length === PAGE_SIZE);
      })
      .catch(() => !cancelled && setEvents([]));
    return () => {
      cancelled = true;
    };
  }, [filterParams]);

  async function loadMore() {
    if (!events) return;
    setLoadingMore(true);
    try {
      const r = await api.activityTimeline({
        limit: PAGE_SIZE,
        offset: events.length,
        ...filterParams,
      });
      setEvents((prev) => (prev ? [...prev, ...r.events] : r.events));
      setHasMore(r.events.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        flush
        icon={<Activity size={18} className="text-muted-foreground" aria-hidden />}
        title="Activity"
        sub="What Outrival has been doing for you — every source we check, kept fresh in the background."
      />

      {sources && sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No monitored sources yet. Add a competitor to start tracking.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={competitor} onValueChange={setCompetitor}>
              <SelectTrigger size="sm" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All competitors</SelectItem>
                {competitorOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={source} onValueChange={setSource}>
              <SelectTrigger size="sm" className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sourceOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {sourceLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger size="sm" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="success">Change detected</SelectItem>
                <SelectItem value="no_change">No change</SelectItem>
                <SelectItem value="failed">Couldn&apos;t reach</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {events === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isFiltered
                ? "No activity matches these filters."
                : "No activity yet. Checks appear here as they run."}
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs text-muted-foreground">Competitor</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Source</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                      <TableHead className="text-xs text-muted-foreground">What changed</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">
                        Duration
                      </TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e, i) => {
                      const meta = EVENT_META[e.status];
                      return (
                        <TableRow key={`${e.competitorId}-${e.recordedAt}-${i}`}>
                          <TableCell>
                            <Link
                              href={`/dashboard/competitors/${e.competitorId}`}
                              className="font-medium hover:underline"
                            >
                              {e.competitorName}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {sourceLabel(e.sourceType)}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5">
                              <Dot color={meta.color} />
                              <span className="text-muted-foreground">{meta.label}</span>
                            </span>
                          </TableCell>
                          <TableCell
                            className="max-w-[420px] truncate text-muted-foreground"
                            title={e.changeSummary ?? undefined}
                          >
                            {e.changeSummary ?? "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                            {duration(e.durationMs)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                            {rel(e.recordedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {hasMore && (
                <div>
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
