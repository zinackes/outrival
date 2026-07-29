"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowSquareOutIcon,
  FileTextIcon,
  SpinnerIcon,
  ClockIcon,
  PlayIcon,
} from "@/components/icons";
import { api, type ChangeRow, type CompetitorSignal, type PositioningVersion } from "@/lib/api";
import type { SourceType } from "@outrival/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { SeverityScale } from "@/components/outrival/severity-scale";
import { CatBadge } from "@/components/outrival/data-marks";
import { sourceShortLabel } from "@/lib/source-labels";
import { cn } from "@/lib/utils";
import { PositioningDrift } from "./positioning-drift";
import { MobileAppsFact, type MobileApps } from "./mobile-apps";
import { Empty, scrapeActivity, type MonitorSourceProps } from "./shared";
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
 * comments in rawDiff). Older captures predate that and show no figure; the
 * numbers are never parsed back out of the prose line.
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
 * This tab used to be a second chronology, rendering the same diff cards as
 * Activity behind three filter chips, so a headline rewrite, a release and a
 * Hacker News thread all looked alike. Each lens now gets the treatment its
 * evidence deserves, which is what separates this tab from Activity: Activity is
 * the chronology ranked by materiality, this is the narrative, what they shipped,
 * and where they are talked about.
 */
export function ProductTab({
  competitorId,
  competitorName,
  changes,
  signals,
  monitors,
  scrapingIds,
  onRun,
  competitorUrl,
  mobileApps,
}: {
  competitorId: string;
  competitorName: string;
  changes: ChangeRow[];
  signals: CompetitorSignal[];
  competitorUrl: string;
  // Which platforms they ship on. A standing fact about their positioning, so it
  // sits with the narrative rather than in the chronology below it.
  mobileApps: MobileApps | null;
} & MonitorSourceProps) {
  const [lens, setLens] = useState<ProductLens | null>(null);

  // The tab owns the history: its verdict is derived from the same two versions
  // the drift block renders, and the two must never disagree about whether the
  // copy moved. Lazy, so only this tab pays for it.
  const historyQuery = useQuery({
    queryKey: ["competitor", competitorId, "positioningHistory"],
    queryFn: () => api.getCompetitorPositioningHistory(competitorId).then((r) => r.versions),
    placeholderData: keepPreviousData,
  });
  const versions = historyQuery.isError ? [] : (historyQuery.data ?? null);

  const counts = lensCounts(changes);
  const tabMonitors = monitors.filter((m) =>
    (PRODUCT_SOURCES as readonly string[]).includes(m.sourceType),
  );

  // A change that became a signal shows the strategic insight instead of the
  // plain classification summary, and lends it its severity.
  const signalByChangeId = new Map<string, CompetitorSignal>();
  for (const s of signals) {
    if (s.changeId) signalByChangeId.set(s.changeId, s);
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
    const activity = scrapeActivity(preferred, scrapingIds.has(preferred.id));
    return (
      <EmptyState
        icon={FileTextIcon}
        title="No changes yet"
        description={
          activity === "queued"
            ? `The ${preferred.sourceType} monitor is waiting in the scan queue. It runs as soon as a scanner is free.`
            : preferred.lastRunAt
              ? `The ${preferred.sourceType} monitor was scraped ${formatDistanceToNow(new Date(preferred.lastRunAt), { addSuffix: true })}, with no change since.`
              : `The ${preferred.sourceType} monitor has never been scraped. Run it now.`
        }
        actions={
          <Button
            size="sm"
            variant={activity ? "secondary" : "default"}
            onClick={() => onRun(preferred.id)}
            disabled={activity !== null}
          >
            {activity === "scraping" ? (
              <>
                <SpinnerIcon size={16} className="animate-spin" /> Scraping…
              </>
            ) : activity === "queued" ? (
              <>
                <ClockIcon size={16} /> Queued
              </>
            ) : (
              <>
                <PlayIcon size={16} /> Scrape {preferred.sourceType}
              </>
            )}
          </Button>
        }
      />
    );
  }

  // The chips hide sections rather than filter one list: each lens has its own
  // rendering, so "show me only what they shipped" is a section choice.
  const show = (l: ProductLens) => lens === null || lens === l;
  const narrative = filterByLens(changes, "narrative");
  const shipped = filterByLens(changes, "product");
  const social = filterByLens(changes, "social");

  // A competitor publishing a /vs/ or /alternatives/ page is the highest-stakes
  // positioning event there is: they get to choose the criteria. The sitemap
  // branch anchors it on its own source and escalates severity when the slug
  // names your org, yet here it used to render as one more diff card.
  const comparisons = narrative.filter((c) => c.sourceType === "comparison_page");
  const narrativeRest = narrative.filter((c) => c.sourceType !== "comparison_page");

  const verdict = buildVerdict({
    competitorName,
    versions,
    comparisons,
    shipped,
    social,
    changes,
  });

  return (
    <TabCard>
      {verdict && (
        <TabSection>
          <h3 className="text-xl font-semibold leading-snug tracking-tight text-balance">
            {verdict.headline}
          </h3>
          {verdict.basis && (
            <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
              {verdict.basis}
            </p>
          )}
        </TabSection>
      )}

      {mobileApps && (
        <TabSection title="Mobile apps">
          <MobileAppsFact apps={mobileApps} name={competitorName} />
        </TabSection>
      )}

      <div className="flex flex-wrap items-center gap-1.5 px-5 py-3">
        <LensChip
          label="All"
          count={counts.all}
          active={lens === null}
          onClick={() => setLens(null)}
        />
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

      {show("narrative") && (
        <PositioningDrift versions={versions} loading={!versions} />
      )}

      {show("narrative") &&
        comparisons.map((c) => {
          const signal = signalByChangeId.get(c.id);
          return (
            <TabSection key={c.id}>
              <div className="flex flex-col gap-2.5 rounded-lg border border-critical/30 bg-critical/[0.06] px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  {signal && <SeverityScale severity={signal.severity} size="compact" />}
                  <h4 className="text-content font-semibold tracking-tight">
                    They published a comparison page
                  </h4>
                </div>
                <p className="max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
                  {signal?.insight ??
                    c.summary ??
                    `${competitorName} added a comparison page to their sitemap. Whoever writes the comparison chooses the criteria.`}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                  {c.monitorUrl && (
                    <span className="truncate font-mono">
                      {c.monitorUrl.replace(/^https?:\/\//, "")}
                    </span>
                  )}
                  <span>
                    detected {formatDistanceToNow(new Date(c.detectedAt), { addSuffix: true })}
                  </span>
                  <a
                    href={c.monitorUrl ?? competitorUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-link hover:underline"
                  >
                    Read their page <ArrowSquareOutIcon size={16} />
                  </a>
                </div>
              </div>
            </TabSection>
          );
        })}

      {/* Blog posts and watched pages: a dated log, not a stack of diff cards
          with raw-diff toggles. The homepage rewrite above is the featured
          narrative event; these are the rest of what they published. */}
      {show("narrative") && narrativeRest.length > 0 && (
        <TabSection title="What else they published">
          <LogList
            rows={narrativeRest}
            signalByChangeId={signalByChangeId}
            fallbackUrl={competitorUrl}
          />
        </TabSection>
      )}

      {/* Releases and incidents answer the same question and want the same shape:
          "they shipped X" and "they were down 41 minutes" are both a dated line. */}
      {show("product") && shipped.length > 0 && (
        <TabSection
          title="What they shipped"
          action={
            <span className="shrink-0 text-xs text-muted-foreground">
              changelog, news and status
            </span>
          }
        >
          <LogList
            rows={shipped}
            signalByChangeId={signalByChangeId}
            fallbackUrl={competitorUrl}
          />
        </TabSection>
      )}

      {/* External evidence: it did not come off their own site, so the source is
          the point and the engagement is the payload. */}
      {show("social") && social.length > 0 && (
        <TabSection
          title="Where they are talked about"
          action={
            <span className="shrink-0 text-xs text-muted-foreground">
              community mentions we can see
            </span>
          }
        >
          <LogList
            rows={social}
            signalByChangeId={signalByChangeId}
            fallbackUrl={competitorUrl}
            linkLabel="Open"
          />
        </TabSection>
      )}

      {/* What this tab is reading, so an absent section reads as "that source is
          off", not as "nothing happened". */}
      {tabMonitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-3 text-xs text-muted-foreground">
          <span>Reading</span>
          <span className="text-foreground">
            {tabMonitors
              .map((m) => sourceShortLabel(m.sourceType).toLowerCase())
              .join(", ")}
          </span>
        </div>
      )}
    </TabCard>
  );
}

function LogList({
  rows,
  signalByChangeId,
  fallbackUrl,
  linkLabel = "View",
}: {
  rows: ChangeRow[];
  signalByChangeId: Map<string, CompetitorSignal>;
  fallbackUrl: string;
  linkLabel?: string;
}) {
  return (
    <ul className="flex flex-col">
      {rows.map((c) => {
        const signal = signalByChangeId.get(c.id);
        const text = signal?.insight ?? c.summary;
        const url = c.monitorUrl ?? fallbackUrl;
        const engagement = engagementOf(c);
        return (
          <li
            key={c.id}
            className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 border-t border-border py-2.5 first:border-t-0 sm:grid-cols-[3.75rem_minmax(0,1fr)_auto]"
          >
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {format(new Date(c.detectedAt), "d MMM")}
            </span>
            <span className="min-w-0 text-sm leading-snug">
              {text ?? (
                <span className="italic text-muted-foreground">
                  Change detected, not yet classified.
                </span>
              )}
            </span>
            <span className="col-start-2 flex flex-wrap items-center gap-2.5 sm:col-start-3 sm:justify-end">
              {engagement && (
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {engagement}
                </span>
              )}
              {signal ? (
                <CatBadge category={signal.category} />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {sourceShortLabel(c.sourceType as SourceType)}
                </span>
              )}
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-xs text-link hover:underline"
                >
                  {linkLabel} <ArrowSquareOutIcon size={16} />
                </a>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The tab's answer, computed from the captured changes. Ordered by how much a
 * reader should care: a competitor writing a comparison page about you outranks
 * a rewritten headline, which outranks a week of releases.
 */
function buildVerdict({
  competitorName,
  versions,
  comparisons,
  shipped,
  social,
  changes,
}: {
  competitorName: string;
  versions: PositioningVersion[] | null;
  comparisons: ChangeRow[];
  shipped: ChangeRow[];
  social: ChangeRow[];
  changes: ChangeRow[];
}): { headline: string; basis?: string } | null {
  if (comparisons.length > 0) {
    return {
      headline: `${competitorName} is comparing itself to you in public.`,
      basis:
        "A comparison page went up on their own domain. Whoever writes the comparison chooses the criteria, so this one is theirs until you answer it.",
    };
  }

  const [now, before] = versions ?? [];
  if (now && before && now.headline && now.headline !== before.headline) {
    return {
      headline: "They rewrote how they describe themselves.",
      basis: `The homepage headline changed ${formatDistanceToNow(new Date(now.capturedAt), { addSuffix: true })}. The before and after are below.`,
    };
  }

  if (shipped.length > 0) {
    const oldest = shipped[shipped.length - 1];
    const window = oldest
      ? ` since ${formatDistanceToNow(new Date(oldest.detectedAt))} ago`
      : "";
    return {
      headline: `They shipped ${shipped.length} ${shipped.length === 1 ? "update" : "updates"}${window}.`,
      basis:
        social.length > 0
          ? `Their story held steady while they built. ${social.length} community ${social.length === 1 ? "mention" : "mentions"} in the same period.`
          : "Their story held steady while they built.",
    };
  }

  if (changes.length > 0) {
    return {
      headline: "Their public story has not moved.",
      basis: `${changes.length} ${changes.length === 1 ? "change" : "changes"} captured, none of them a repositioning.`,
    };
  }
  return null;
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
