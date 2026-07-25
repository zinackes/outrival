"use client";

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ExternalLink, FileText, Loader2, Play, Swords } from "lucide-react";
import type { ChangeRow, CompetitorSignal } from "@/lib/api";
import type { SourceType } from "@outrival/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { sourceShortLabel } from "@/lib/source-labels";
import { cn } from "@/lib/utils";
import { ChangeCard } from "./changes";
import { PositioningDrift } from "./positioning-drift";
import { Empty, type MonitorSourceProps } from "./shared";
import {
  PRODUCT_SOURCES,
  filterByLens,
  lensCounts,
  type ProductLens,
} from "./product-lenses";

const LENS_LABELS: Array<{ lens: ProductLens; label: string }> = [
  { lens: "narrative", label: "Narrative" },
  { lens: "product", label: "Shipped" },
  { lens: "social", label: "Talked about" },
];

/**
 * Hacker News carries its engagement structurally on the change (points and
 * comments in rawDiff, session 5b). Older captures predate that and simply show
 * no figure; the numbers are never parsed back out of the prose line.
 */
function engagementOf(change: ChangeRow): string | null {
  if (typeof change.engagementPoints !== "number") return null;
  const parts = [`${change.engagementPoints} points`];
  if (typeof change.engagementComments === "number") {
    parts.push(`${change.engagementComments} comments`);
  }
  return parts.join(", ");
}

/**
 * Positioning: the story and how it drifted.
 *
 * This tab used to be a second chronology. It rendered the same ChangeCard list
 * as Activity, filtered by three lens chips, so a headline rewrite, a release and
 * a Hacker News thread all looked like the same diff card with a "Show raw diff"
 * toggle, and nothing in either tab's label told you which one held what.
 *
 * The lenses were the right idea rendered wrong. Each now gets the treatment its
 * evidence deserves, which is also what finally separates this tab from Activity:
 * Activity is the chronology ranked by materiality, this is the narrative, what
 * they shipped, and where they are talked about.
 */
export function ProductTab({
  competitorId,
  changes,
  signals,
  monitors,
  scrapingIds,
  onRun,
  onRefresh,
  competitorUrl,
}: {
  competitorId: string;
  changes: ChangeRow[];
  signals: CompetitorSignal[];
  onRefresh?: () => void;
  competitorUrl: string;
} & MonitorSourceProps) {
  const [lens, setLens] = useState<ProductLens | null>(null);
  const counts = lensCounts(changes);
  const tabMonitors = monitors.filter((m) =>
    (PRODUCT_SOURCES as readonly string[]).includes(m.sourceType),
  );

  // A change that became a signal shows the strategic insight instead of the
  // plain classification summary.
  const insightByChangeId = new Map<string, string>();
  for (const s of signals) {
    if (s.changeId) insightByChangeId.set(s.changeId, s.insight);
  }

  if (counts.all === 0) {
    if (tabMonitors.length === 0) {
      return (
        <Empty
          text="No positioning sources configured."
          hint="This covers the homepage, blog, changelog, news, status page and community mentions. None of them is enabled for this competitor."
        />
      );
    }
    const preferred =
      tabMonitors.find((m) => m.sourceType === "homepage") ??
      tabMonitors.find((m) => m.sourceType === "blog") ??
      tabMonitors[0]!;
    const running = scrapingIds.has(preferred.id);
    return (
      <EmptyState
        icon={FileText}
        title="No changes yet"
        description={
          preferred.lastRunAt
            ? `The ${preferred.sourceType} monitor was scraped ${formatDistanceToNow(new Date(preferred.lastRunAt), { addSuffix: true })}, with no change since.`
            : `The ${preferred.sourceType} monitor has never been scraped. Run it now.`
        }
        actions={
          <Button
            size="sm"
            variant={running ? "secondary" : "default"}
            onClick={() => onRun(preferred.id)}
            disabled={running}
          >
            {running ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Scraping…
              </>
            ) : (
              <>
                <Play size={12} /> Scrape {preferred.sourceType}
              </>
            )}
          </Button>
        }
      />
    );
  }

  // The chips hide the other sections rather than filtering one list: each lens
  // has its own rendering now, so "show me only what they shipped" is a section
  // choice, not a predicate over a uniform feed.
  const show = (l: ProductLens) => lens === null || lens === l;
  const narrative = show("narrative") ? filterByLens(changes, "narrative") : [];
  const shipped = show("product") ? filterByLens(changes, "product") : [];
  const social = show("social") ? filterByLens(changes, "social") : [];

  // A competitor publishing a /vs/ or /alternatives/ page is the highest-stakes
  // positioning event there is: they get to choose the criteria. The sitemap
  // branch already anchors it on its own source and escalates severity when the
  // slug names your org, but on this tab it used to render as one more diff card.
  const comparisons = narrative.filter((c) => c.sourceType === "comparison_page");
  const narrativeRest = narrative.filter((c) => c.sourceType !== "comparison_page");

  return (
    <TabCard>
      <div className="flex flex-wrap items-center gap-1.5 px-5 py-3">
        <LensChip label="All" count={counts.all} active={lens === null} onClick={() => setLens(null)} />
        {LENS_LABELS.map(({ lens: l, label }) => (
          <LensChip
            key={l}
            label={label}
            count={counts[l]}
            active={lens === l}
            onClick={() => setLens(lens === l ? null : l)}
          />
        ))}
      </div>

      {show("narrative") && <PositioningDrift competitorId={competitorId} />}

      {comparisons.map((c) => (
        <TabSection key={c.id}>
          <div className="flex flex-col gap-2 rounded-lg border border-critical/30 bg-critical/[0.06] px-4 py-3.5">
            <h4 className="flex items-center gap-2 text-content font-semibold tracking-tight">
              <Swords size={14} className="shrink-0 text-critical" aria-hidden />
              They published a comparison page
            </h4>
            <p className="max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
              {insightByChangeId.get(c.id) ??
                c.summary ??
                "A new comparison page appeared in their sitemap."}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Detected {formatDistanceToNow(new Date(c.detectedAt), { addSuffix: true })}
              </span>
              {(c.monitorUrl ?? competitorUrl) && (
                <a
                  href={c.monitorUrl ?? competitorUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-link hover:underline"
                >
                  Read their page <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>
        </TabSection>
      ))}

      {narrativeRest.length > 0 && (
        <TabSection title="How they describe themselves">
          <ul className="flex flex-col divide-y divide-border">
            {narrativeRest.map((c) => (
              <li key={c.id} className="py-3.5 first:pt-0 last:pb-0">
                <ChangeCard
                  change={c}
                  onRefresh={onRefresh}
                  fallbackUrl={competitorUrl}
                  insight={insightByChangeId.get(c.id)}
                />
              </li>
            ))}
          </ul>
        </TabSection>
      )}

      {/* Releases and incidents are a log, not a feed of diff cards: a date
          column and a line each, because "they shipped X" and "they were down
          41 minutes" answer the same question and want the same shape. */}
      {shipped.length > 0 && (
        <TabSection title="What they shipped">
          <ul className="flex flex-col">
            {shipped.map((c) => (
              <LogRow
                key={c.id}
                change={c}
                insight={insightByChangeId.get(c.id)}
                fallbackUrl={competitorUrl}
              />
            ))}
          </ul>
        </TabSection>
      )}

      {/* External evidence: it did not come off their own site, so the source is
          the point and the link is the payload. */}
      {social.length > 0 && (
        <TabSection title="Where they are talked about">
          <ul className="flex flex-col">
            {social.map((c) => (
              <LogRow
                key={c.id}
                change={c}
                insight={insightByChangeId.get(c.id)}
                fallbackUrl={competitorUrl}
                linkLabel="Open"
                engagement={engagementOf(c)}
              />
            ))}
          </ul>
        </TabSection>
      )}
    </TabCard>
  );
}

function LensChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // The full pill marks an interactive filter, keeping it distinct from the
        // static badges on the rows below.
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-border-strong bg-surface-3 font-medium text-foreground"
          : "border-border text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {label}
      <span className="font-mono text-meta tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

/** A dated line: when, what, where it came from. */
function LogRow({
  change: c,
  insight,
  fallbackUrl,
  linkLabel = "View",
  engagement,
}: {
  change: ChangeRow;
  insight?: string;
  fallbackUrl: string;
  linkLabel?: string;
  /** "312 points, 84 comments" when the source carries it. */
  engagement?: string | null;
}) {
  const url = c.monitorUrl ?? fallbackUrl;
  const text = insight ?? c.summary;
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-t border-border py-2.5 first:border-t-0 max-sm:grid-cols-[minmax(0,1fr)_auto]">
      <span className="font-mono text-xs tabular-nums text-muted-foreground max-sm:col-span-2">
        {format(new Date(c.detectedAt), "d MMM")}
      </span>
      <span className="min-w-0 text-sm leading-snug">
        {text ?? (
          <span className="text-muted-foreground italic">
            Change detected, not yet classified.
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        {engagement && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {engagement}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {sourceShortLabel(c.sourceType as SourceType)}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-link hover:underline"
          >
            {linkLabel} <ExternalLink size={11} />
          </a>
        )}
      </span>
    </li>
  );
}
