"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  MessageSquare,
  ArrowBigUp,
  MessageCircle,
  ExternalLink,
  Lock,
  Plus,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  PLAN_LABELS,
  planIncludesSource,
  minPlanForSource,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import {
  Empty,
  TabLoading,
  MonitorEmptyState,
  SourceSummary,
  type MonitorSourceProps,
} from "./shared";

// First-run state when no Reddit monitor exists yet. Unlike the review sources there
// is no URL to paste — the brand is derived from the competitor's own domain — so
// this is a single enable action (or an upgrade prompt when the plan doesn't cover it).
function RedditEnableState({
  plan,
  onEnable,
  onLockedSource,
}: {
  plan: Plan;
  onEnable?: (source: SourceType, url?: string) => Promise<void>;
  onLockedSource?: (source: SourceType) => void;
}) {
  const [busy, setBusy] = useState(false);
  const locked = !planIncludesSource(plan, "reddit");

  return (
    <Card className="px-6 py-10 border-dashed flex flex-col items-center gap-4 text-center">
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-semibold text-foreground">Track Reddit mentions</p>
        <p className="text-sm text-muted-foreground max-w-md">
          We&apos;ll search Reddit for recent discussions of this competitor — no URL
          needed — and summarize the sentiment and recurring complaints. The first
          scrape runs right away.
        </p>
      </div>
      <Button
        size="sm"
        disabled={!onEnable || busy}
        onClick={async () => {
          if (locked) return onLockedSource?.("reddit");
          if (!onEnable) return;
          setBusy(true);
          try {
            await onEnable("reddit");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Enabling…
          </>
        ) : locked ? (
          <>
            <Lock size={12} /> Upgrade to enable
          </>
        ) : (
          <>
            <Plus size={12} /> Enable Reddit mentions
          </>
        )}
      </Button>
      {locked && (
        <p className="text-xs text-muted-foreground">
          Reddit mentions are included in the {PLAN_LABELS[minPlanForSource("reddit")]} plan.
        </p>
      )}
    </Card>
  );
}

export function MentionsTab({
  competitorId,
  monitors,
  scrapingIds,
  onRun,
  onEnable,
  plan,
  onLockedSource,
}: {
  competitorId: string;
  plan: Plan;
  onLockedSource?: (source: SourceType) => void;
} & MonitorSourceProps) {
  const mentionsQuery = useQuery({
    queryKey: ["competitor", competitorId, "mentions"],
    queryFn: () => api.getCompetitorMentions(competitorId),
    placeholderData: keepPreviousData,
  });

  const redditMonitor = monitors.find((m) => m.sourceType === "reddit");

  // No monitor yet → single enable action (no URL to collect).
  if (!redditMonitor) {
    return <RedditEnableState plan={plan} onEnable={onEnable} onLockedSource={onLockedSource} />;
  }

  if (mentionsQuery.isError)
    return <Empty text="Couldn't load Reddit mentions right now — try again in a moment." />;
  const data = mentionsQuery.data;
  if (!data) return <TabLoading />;

  const hasData =
    data.posts.length > 0 ||
    data.praises.length > 0 ||
    data.complaints.length > 0 ||
    !!data.summary;

  return (
    <div className="flex flex-col gap-4">
      <TabCard>
        <TabSection>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
              <span className="text-dense font-medium text-foreground">Reddit mentions</span>
            </div>
            {data.lastScrapedAt && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(data.lastScrapedAt), { addSuffix: true })}
              </span>
            )}
          </div>
        </TabSection>

        <SourceSummary summary={data.summary} updatedAt={data.summaryUpdatedAt} />

        {hasData && (
          <>
            {(data.praises.length > 0 || data.complaints.length > 0) && (
              <TabSection title="What people say" icon={MessageCircle}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
                  <SentimentColumn title="Positive" items={data.praises} accent="positive" />
                  <SentimentColumn title="Critical" items={data.complaints} accent="critical" />
                </div>
              </TabSection>
            )}

            {data.posts.length > 0 && (
              <TabSection title="Recent mentions" icon={MessageSquare}>
                <ul className="flex flex-col divide-y divide-border">
                  {data.posts.map((p) => (
                    <MentionRow key={p.id} post={p} />
                  ))}
                </ul>
              </TabSection>
            )}
          </>
        )}
      </TabCard>

      {!hasData && (
        <MonitorEmptyState
          source="reddit"
          label="Reddit mentions"
          monitors={monitors}
          scrapingIds={scrapingIds}
          onRun={onRun}
          onEnable={onEnable}
        />
      )}
    </div>
  );
}

function MentionRow({
  post,
}: {
  post: {
    title: string;
    subreddit: string;
    score: number;
    numComments: number;
    permalink: string;
    body: string;
  };
}) {
  const href = post.permalink.startsWith("http")
    ? post.permalink
    : `https://www.reddit.com${post.permalink}`;
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start gap-3 py-3"
      >
        <span className="flex w-10 shrink-0 flex-col items-center gap-0.5 pt-0.5 text-muted-foreground">
          <ArrowBigUp size={15} />
          <span className="font-mono text-xs tabular-nums slashed-zero">{post.score}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1.5 text-content font-medium text-foreground">
            <span className="min-w-0 group-hover:underline">{post.title}</span>
            <ExternalLink
              size={12}
              className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            />
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">r/{post.subreddit}</span>
            <span className="flex items-center gap-1">
              <MessageCircle size={11} />
              <span className="font-mono tabular-nums slashed-zero">{post.numComments}</span>
            </span>
          </span>
          {post.body && (
            <span className="mt-1 block text-sm text-muted-foreground line-clamp-2">
              {post.body}
            </span>
          )}
        </span>
      </a>
    </li>
  );
}

function SentimentColumn({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent: "positive" | "critical";
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3
        className={cn(
          "flex items-center gap-2 text-sm font-semibold tracking-tight",
          accent === "positive" ? "text-positive" : "text-critical",
        )}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            accent === "positive" ? "bg-positive" : "bg-critical",
          )}
        />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-dense text-muted-foreground">—</p>
      ) : (
        <ul className="flex flex-col gap-2 text-content">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground/40 shrink-0">·</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
