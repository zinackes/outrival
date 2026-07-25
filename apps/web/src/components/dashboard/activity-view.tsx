"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Activity } from "lucide-react";
import type { ActivityDay, ActivitySource, ActivityStatusFilter } from "@/lib/api";
import {
  ACTIVITY_FINDING_STATUSES,
  activityFeedQuery,
  activityHealthQuery,
  activitySummaryQuery,
} from "@/lib/queries";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { sourceLabel } from "@/lib/source-labels";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHead } from "./page-head";
import { useSetAskContext } from "./ask-context";
import { Attention } from "./activity/attention";
import { ActivityLog } from "./activity/log";
import { WatchStrip } from "./activity/watch-strip";

// Activity answers two questions with one page: is Outrival still watching
// everything, and what did it find. The roster answers the first (a source that
// stopped answering is named, not left to be inferred from an absence), the log
// answers the second, and the strip carries the work between them.

type Segment = "all" | "changes" | "problems" | "quiet";

const SEGMENTS: { id: Segment; label: string; statuses: ActivityStatusFilter[] }[] = [
  { id: "all", label: "All", statuses: [] },
  { id: "changes", label: "Changes", statuses: ["change"] },
  { id: "problems", label: "Problems", statuses: ["failed"] },
  { id: "quiet", label: "Quiet", statuses: ["no_change"] },
];

// Deep links from the competitor page carry the old status values; map the ones
// that name an outcome onto the segment that shows it.
function segmentFromUrl(raw: string | null): Segment {
  if (raw === "change" || raw === "first_capture") return "changes";
  if (raw === "failed") return "problems";
  if (raw === "no_change") return "quiet";
  return "all";
}

export function ActivityView() {
  useSetAskContext({ kind: "view", label: "Activity timeline" });

  // The competitor page links here pre-filtered (?competitorId=…). Seed once on
  // mount; the user is free to change it afterwards (we never push back to the URL).
  const searchParams = useSearchParams();
  const [competitor, setCompetitor] = useState(searchParams.get("competitorId") ?? "all");
  const [source, setSource] = useState(searchParams.get("source") ?? "all");
  const [segment, setSegment] = useState<Segment>(segmentFromUrl(searchParams.get("status")));

  const productId = useProductScope() ?? undefined;

  const healthQ = useQuery(activityHealthQuery(productId));
  const sources = healthQ.data?.sources ?? null;
  const upcoming = healthQ.data?.upcoming ?? [];

  // Day boundaries are the viewer's, so the tallies match the rows underneath.
  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []);
  const summaryQ = useQuery(activitySummaryQuery(productId, tzOffset));

  const filtered = competitor !== "all" || source !== "all";
  // Unfiltered "All" is the only view whose day tallies describe the rows shown:
  // it leads with findings and folds the quiet runs per day. Every other view is
  // an explicit selection, so it lists exactly what was asked for.
  //
  // It also needs the tallies to EXIST. Without them there is no fold to open, so
  // asking the feed for findings only would hide the quiet runs with no way back;
  // when the summary is unavailable the log falls back to listing every run.
  const haveTallies = (summaryQ.data?.days.length ?? 0) > 0;
  const foldable = segment === "all" && !filtered && haveTallies;

  const feedParams = useMemo(() => {
    const seg = SEGMENTS.find((s) => s.id === segment)!;
    return {
      competitorId: competitor !== "all" ? competitor : undefined,
      sourceType: source !== "all" ? source : undefined,
      statuses: foldable ? ACTIVITY_FINDING_STATUSES : seg.statuses,
    };
  }, [competitor, source, segment, foldable]);

  const feedQ = useInfiniteQuery(activityFeedQuery(feedParams, productId));
  const events = useMemo(
    () => feedQ.data?.pages.flatMap((p) => p.events) ?? null,
    [feedQ.data],
  );

  const competitorOptions = useMemo(() => {
    if (!sources) return [];
    const m = new Map<string, string>();
    for (const s of sources) m.set(s.competitorId, s.competitorName);
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sources]);

  const sourceOptions = useMemo(
    () => (sources ? [...new Set(sources.map((s) => s.sourceType))].sort() : []),
    [sources],
  );

  const onFilter = (setter: (v: string) => void) => (v: string) => setter(v);

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        flush
        icon={<Activity size={18} className="text-muted-foreground" aria-hidden />}
        title="Activity"
        sub="Every check Outrival ran for you, and what each one found."
      />

      {sources && sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No monitored sources yet. Add a competitor and Outrival starts checking within the hour.
        </p>
      ) : (
        <>
          <Reading sources={sources} days={summaryQ.data?.days ?? null} />

          <WatchStrip
            buckets={summaryQ.data?.buckets ?? []}
            upcoming={upcoming}
            loading={summaryQ.isPending}
            failed={summaryQ.isError}
            onRetry={() => void summaryQ.refetch()}
          />

          {sources && <Attention sources={sources} onChanged={() => void healthQ.refetch()} />}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-0.5" role="group" aria-label="Filter the log">
              {SEGMENTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={segment === s.id}
                  onClick={() => setSegment(s.id)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-dense font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    segment === s.id
                      ? "border-border bg-surface-2 text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {competitorOptions.length > 1 && (
                <Select value={competitor} onValueChange={onFilter(setCompetitor)}>
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
              )}
              {sourceOptions.length > 1 && (
                <Select value={source} onValueChange={onFilter(setSource)}>
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
              )}
            </div>
          </div>

          {feedQ.isError ? (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load activity.{" "}
              <button
                type="button"
                onClick={() => void feedQ.refetch()}
                className="text-link underline underline-offset-2"
              >
                Retry
              </button>
            </p>
          ) : events === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : events.length === 0 &&
            // The unfiltered view still has something to say with no findings at
            // all: the day tallies carry the quiet work. Anything else is empty.
            (!foldable || (summaryQ.data?.days ?? []).length === 0) ? (
            <p className="text-sm text-muted-foreground">
              {segment === "problems"
                ? "No failed checks here. Every source answered."
                : filtered || segment !== "all"
                  ? "No activity matches these filters."
                  : "No activity yet. The first checks run within the hour."}
            </p>
          ) : (
            <div className={cn("transition-opacity", feedQ.isFetching && !feedQ.isFetchingNextPage && "opacity-60")}>
              <ActivityLog
                events={events}
                days={summaryQ.data?.days ?? []}
                foldable={foldable}
                filters={{ competitorId: feedParams.competitorId, sourceType: feedParams.sourceType }}
                productId={productId}
                hasMore={feedQ.hasNextPage}
                loadingMore={feedQ.isFetchingNextPage}
                onLoadMore={() => void feedQ.fetchNextPage()}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The page opens on a sentence computed from what is on screen: the work of the
// week, and whether anything has stopped answering. The roster arrives with the
// first paint and the counts a moment later, so the sentence starts complete and
// only gets richer rather than shifting the page.
function Reading({
  sources,
  days,
}: {
  sources: ActivitySource[] | null;
  days: ActivityDay[] | null;
}) {
  const week = useMemo(() => {
    if (!days) return null;
    const recent = days.slice(0, 7);
    return {
      checks: recent.reduce((n, d) => n + d.checks, 0),
      changes: recent.reduce((n, d) => n + d.changes, 0),
    };
  }, [days]);

  if (!sources) return null;

  const dark = sources.filter((s) => s.status !== "ok");
  const named = dark
    .slice(0, 2)
    .map((s) => `${s.competitorName} ${sourceLabel(s.sourceType).toLowerCase()}`);
  const rest = dark.length - named.length;

  return (
    <p className="max-w-[78ch] text-content leading-relaxed text-pretty">
      {week && week.checks > 0 ? (
        <>
          Outrival ran <Num n={week.checks} /> check{week.checks === 1 ? "" : "s"} across{" "}
          <Num n={sources.length} /> source{sources.length === 1 ? "" : "s"} this week and caught{" "}
          <Num n={week.changes} /> change{week.changes === 1 ? "" : "s"}.
        </>
      ) : (
        <>
          Outrival is watching <Num n={sources.length} /> source
          {sources.length === 1 ? "" : "s"}.
        </>
      )}{" "}
      {dark.length === 0 ? (
        <span className="text-muted-foreground">Every source is answering.</span>
      ) : (
        <>
          <span className="font-semibold text-critical">
            {dark.length === 1 ? "One source has" : `${dark.length} sources have`} stopped answering
          </span>
          , so {named.join(" and ")}
          {rest > 0 && ` and ${rest} other${rest === 1 ? "" : "s"}`}{" "}
          {dark.length === 1 ? "is" : "are"} not being watched right now.
        </>
      )}
    </p>
  );
}

function Num({ n }: { n: number }) {
  return <span className="font-semibold tabular-nums">{n.toLocaleString()}</span>;
}
