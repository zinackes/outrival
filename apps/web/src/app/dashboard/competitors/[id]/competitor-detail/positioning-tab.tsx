"use client";

import { useState } from "react";
import { useInfiniteQuery, useQuery, keepPreviousData } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowSquareOutIcon,
  ClockIcon,
  FileTextIcon,
  PlayIcon,
  SpinnerIcon,
} from "@/components/icons";
import {
  api,
  type AudienceProfile,
  type AudienceSegment,
  type ChangeRow,
  type CompetitorClaim,
  type CompetitorOverview,
  type CompetitorSignal,
  type MarketMap,
  type MessagingVersion,
  type NamedTarget,
  type PositioningSummary,
  type VisibilitySubjectStats,
  type VisibilityWindowFact,
} from "@/lib/api";
import { PRICING_MODEL_LABELS, type SourceType } from "@outrival/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TabAbsence, TabCard, TabSection } from "@/components/outrival/tab-shell";
import { SeverityScale } from "@/components/outrival/severity-scale";
import { CatBadge } from "@/components/outrival/data-marks";
import { sourceShortLabel } from "@/lib/source-labels";
import { cn } from "@/lib/utils";
import { MobileAppsFact, type MobileApps } from "./mobile-apps";
import { Empty, scrapeActivity, type MonitorSourceProps } from "./shared";
import { PRODUCT_SOURCES, filterByLens } from "./product-lenses";

/** Past this a rewrite stops being news and the badge comes off. */
const REPOSITIONED_WINDOW_DAYS = 30;
/** Claims shown before the section becomes an inventory. */
const CLAIMS_SHOWN = 8;
/** Comparison targets listed before the rest collapse into a count. */
const TARGETS_SHOWN = 6;

/**
 * Positioning — how a competitor tells its story, and what backs it up
 * (Positioning Intelligence v2 P4).
 *
 * This tab used to be a second chronology behind three filter chips, and the card
 * that opened the phase named it as the least-read tab in the product. The data it
 * needed had been captured for months and never assembled: the hero copy of every
 * homepage snapshot, the numeric claims parsed off each one, the rivals named in
 * their own `/vs/` slugs, the persona pages in their sitemap.
 *
 * So the tab is five readings of one question — what do they say, what do they
 * claim, who do they fight, who do they sell to, what do the machines say — over a
 * head strip that carries the identity line. Everything on it is captured or
 * derived; this phase adds ZERO AI calls.
 *
 * A section with nothing to show is ABSENT, never an empty panel: the tab has to
 * stay readable for a competitor added an hour ago, and a column of "no data" is
 * how a page teaches a reader to stop opening it.
 */
export function PositioningTab({
  competitorId,
  competitorName,
  competitorUrl,
  category,
  changes,
  signals,
  monitors,
  scrapingIds,
  onRun,
  mobileApps,
  overview,
}: {
  competitorId: string;
  competitorName: string;
  competitorUrl: string;
  /** The market they are filed under — the first half of the identity line. */
  category: string | null;
  changes: ChangeRow[];
  signals: CompetitorSignal[];
  // Which platforms they ship on — a standing fact about their positioning.
  mobileApps: MobileApps | null;
  // Already loaded for the page: the homepage fact sheet carries the customer
  // logos and testimonials this tab counts, so the proof section costs no request.
  overview: CompetitorOverview;
} & MonitorSourceProps) {
  // Five lazy reads, one per section. Separate queries rather than a composite
  // endpoint: they have different costs and different failure modes, and a slow
  // market map must not hold the narrative behind it.
  const summaryQuery = useQuery({
    queryKey: ["competitor", competitorId, "positioning"],
    queryFn: () => api.getCompetitorPositioning(competitorId),
    placeholderData: keepPreviousData,
  });
  const claimsQuery = useQuery({
    queryKey: ["competitor", competitorId, "claims"],
    queryFn: () => api.getCompetitorClaims(competitorId).then((r) => r.claims),
    placeholderData: keepPreviousData,
  });
  const mapQuery = useQuery({
    queryKey: ["competitor", competitorId, "marketMap"],
    queryFn: () => api.getCompetitorMarketMap(competitorId),
    placeholderData: keepPreviousData,
  });
  const icpQuery = useQuery({
    queryKey: ["competitor", competitorId, "audienceProfile"],
    queryFn: () => api.getCompetitorAudienceProfile(competitorId),
    placeholderData: keepPreviousData,
  });

  const summary = summaryQuery.isError ? null : (summaryQuery.data ?? null);
  const claims = claimsQuery.isError ? [] : (claimsQuery.data ?? null);
  const map = mapQuery.isError ? null : (mapQuery.data ?? null);
  const icp = icpQuery.isError ? null : (icpQuery.data ?? null);

  const tabMonitors = monitors.filter((m) =>
    (PRODUCT_SOURCES as readonly string[]).includes(m.sourceType),
  );

  // A change that became a signal shows the strategic insight instead of the
  // plain classification summary, and lends it its severity.
  const signalByChangeId = new Map<string, CompetitorSignal>();
  for (const s of signals) {
    if (s.changeId) signalByChangeId.set(s.changeId, s);
  }

  // The chronological readings this tab has always carried and that live nowhere
  // else: what they shipped (changelog / news / status) and where they are talked
  // about (community). The narrative third of the old feed is what the five
  // sections above replace, not these.
  // "What they shipped" may only name things they shipped. Two kinds of row could
  // not (OUT-181): a SUPPRESSED change, whose `summary` is the suppression itself —
  // the semantic gate writes its own one-line verdict there, which is how "Only the
  // date of the changelog entry changed" ended up reading as a release — and a row
  // carrying no text at all, whose "Change detected, not yet classified" announces
  // a shipment we cannot name. Both stay on the Activity tab, which is where the
  // audit trail belongs; the other two lenses keep them, because "they published
  // something we haven't read yet" is itself the reading there.
  const shipped = filterByLens(changes, "product").filter(
    (c) => !c.suppressionReason && (Boolean(c.summary) || signalByChangeId.has(c.id)),
  );
  const social = filterByLens(changes, "social");
  const narrative = filterByLens(changes, "narrative");
  // A competitor publishing a comparison page naming YOU is the one front the
  // market map deliberately excludes (`named_competitors` never files the reader
  // as a rival), so it is rendered from the change that detected it.
  const comparisons = narrative.filter((c) => c.sourceType === "comparison_page");
  const published = narrative.filter((c) => c.sourceType !== "comparison_page");

  const timelineLoading = summaryQuery.isPending;
  const hasAnything =
    (summary?.versionsTotal ?? 0) > 0 ||
    (claims?.length ?? 0) > 0 ||
    (map?.targetsTotal ?? 0) > 0 ||
    (map?.mentionsTotal ?? 0) > 0 ||
    (map?.namedBy.length ?? 0) > 0 ||
    // Counts `proven` too: the ICP section renders on it alone (a vertical their case
    // studies name and they publish no page for), so leaving it out of the tab's own
    // "is there anything here" test hid that section behind the empty state.
    (icp
      ? icp.personas.length +
        icp.useCases.length +
        icp.industries.declared.length +
        icp.industries.proven.length
      : 0) > 0 ||
    changes.length > 0;

  // Nothing captured at all — a competitor added minutes ago, or one whose
  // homepage has never been read. One invitation to act beats five empty panels.
  if (!timelineLoading && !hasAnything) {
    if (tabMonitors.length === 0) {
      return (
        <Empty
          text="No positioning sources configured."
          hint="This reads their homepage, their sitemap and their case studies. None of them is enabled for this competitor."
        />
      );
    }
    const preferred =
      tabMonitors.find((m) => m.sourceType === "homepage") ?? tabMonitors[0]!;
    const activity = scrapeActivity(preferred, scrapingIds.has(preferred.id));
    return (
      <EmptyState
        icon={FileTextIcon}
        title="Nothing captured yet"
        description={
          activity === "queued"
            ? `The ${preferred.sourceType} monitor is waiting in the scan queue. It runs as soon as a scanner is free.`
            : preferred.lastRunAt
              ? `The ${preferred.sourceType} monitor was scraped ${formatDistanceToNow(new Date(preferred.lastRunAt), { addSuffix: true })}. Their story, their claims and their ICP appear as captures accumulate.`
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

  const logos = overview.homepage?.customerLogos.length ?? 0;
  const testimonials = overview.homepage?.testimonials.length ?? 0;

  return (
    <TabCard>
      <HeadStrip
        summary={summary}
        loading={summaryQuery.isPending}
        category={category}
        sourcesRead={tabMonitors.length}
      />

      <NarrativeSection
        competitorId={competitorId}
        versionsTotal={summary?.versionsTotal ?? null}
        lastRepositionedAt={summary?.lastRepositionedAt ?? null}
      />

      {(claims === null || claims.length > 0 || logos > 0 || testimonials > 0) && (
        <ProofSection
          claims={claims}
          logos={logos}
          testimonials={testimonials}
          capturedAt={overview.capturedAt}
        />
      )}

      {(comparisons.length > 0 ||
        map === null ||
        map.targetsTotal > 0 ||
        map.mentionsTotal > 0 ||
        map.namedBy.length > 0) && (
        <MarketMapSection
          map={map}
          loading={mapQuery.isPending}
          comparisons={comparisons}
          signalByChangeId={signalByChangeId}
          competitorName={competitorName}
          competitorUrl={competitorUrl}
        />
      )}

      {(icp === null ||
        icp.personas.length > 0 ||
        icp.useCases.length > 0 ||
        icp.industries.declared.length > 0 ||
        icp.industries.proven.length > 0) && (
        <IcpSection icp={icp} loading={icpQuery.isPending} failed={icpQuery.isError} />
      )}

      <ShareOfModelSection summary={summary} loading={summaryQuery.isPending} />

      {mobileApps && (
        <TabSection title="Mobile apps">
          <MobileAppsFact apps={mobileApps} name={competitorName} />
        </TabSection>
      )}

      {/* Releases and incidents answer the same question and want the same shape:
          "they shipped X" and "they were down 41 minutes" are both a dated line. */}
      {shipped.length > 0 && (
        <TabSection
          title="What they shipped"
          action={<span className="shrink-0 text-xs text-muted-foreground">changelog, news and status</span>}
        >
          <LogList rows={shipped} signalByChangeId={signalByChangeId} fallbackUrl={competitorUrl} />
        </TabSection>
      )}

      {published.length > 0 && (
        <TabSection title="What else they published">
          <LogList rows={published} signalByChangeId={signalByChangeId} fallbackUrl={competitorUrl} />
        </TabSection>
      )}

      {/* External evidence: it did not come off their own site, so the source is
          the point and the engagement is the payload. */}
      {social.length > 0 && (
        <TabSection
          title="Where they are talked about"
          action={<span className="shrink-0 text-xs text-muted-foreground">community mentions we can see</span>}
        >
          <LogList
            rows={social}
            signalByChangeId={signalByChangeId}
            fallbackUrl={competitorUrl}
            linkLabel="Open"
          />
        </TabSection>
      )}
    </TabCard>
  );
}

// ── Head strip — the identity line ──────────────────────────────────────────

/**
 * Category, how they charge, and when they last rewrote their story.
 *
 * Not a section: it is one line of badges, and a section heading over a single
 * badge is chrome. It replaces the old computed "verdict" headline, which said in
 * a sentence what these three facts say without being written.
 */
function HeadStrip({
  summary,
  loading,
  category,
  sourcesRead,
}: {
  summary: PositioningSummary | null;
  loading: boolean;
  category: string | null;
  sourcesRead: number;
}) {
  const repositioned = summary?.lastRepositionedAt
    ? new Date(summary.lastRepositionedAt)
    : null;
  const recent =
    repositioned !== null &&
    Date.now() - repositioned.getTime() < REPOSITIONED_WINDOW_DAYS * 86_400_000;

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3.5">
      {category && (
        <Badge variant="outline" className="text-meta font-normal">
          {category}
        </Badge>
      )}
      {loading ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        summary?.pricingModel && (
          <Badge variant="outline" className="text-meta font-normal">
            {PRICING_MODEL_LABELS[summary.pricingModel]}
          </Badge>
        )
      )}
      {sourcesRead > 0 && (
        <span className="text-xs text-muted-foreground">
          {sourcesRead} {sourcesRead === 1 ? "source" : "sources"} read
        </span>
      )}
      <span className="flex-1" />
      {repositioned && (
        <span className={cn("text-xs", recent ? "text-foreground" : "text-muted-foreground")}>
          Repositioned {formatDistanceToNow(repositioned, { addSuffix: true })}
        </span>
      )}
    </div>
  );
}

// ── 1. Narrative ────────────────────────────────────────────────────────────

/**
 * Every distinct wording of their hero, newest first, on a dated spine.
 *
 * The order carries the information — this is a chronology of repositionings, so
 * the spine is structural rather than decorative. Between two consecutive versions
 * the tab shows what MOVED: the value props added and dropped, and the primary CTA
 * when it changed ("Start free trial" → "Book a demo" is a go-to-market decision
 * that never touches the headline).
 *
 * Paged on the cursor the endpoint returns, not an offset: rows are only appended
 * at the top, so an offset page would shift under a reader mid-scroll.
 */
function NarrativeSection({
  competitorId,
  versionsTotal,
  lastRepositionedAt,
}: {
  competitorId: string;
  versionsTotal: number | null;
  lastRepositionedAt: string | null;
}) {
  const timeline = useInfiniteQuery({
    queryKey: ["competitor", competitorId, "messagingTimeline"],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api.getCompetitorMessagingTimeline(competitorId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor,
    placeholderData: keepPreviousData,
  });

  const versions: MessagingVersion[] =
    timeline.data?.pages.flatMap((p) => p.versions) ?? [];

  if (timeline.isPending) {
    return (
      <TabSection title="How they describe themselves">
        <Skeleton className="h-24 w-full" />
      </TabSection>
    );
  }
  if (versions.length === 0) return null;

  const recent =
    lastRepositionedAt !== null &&
    Date.now() - new Date(lastRepositionedAt).getTime() < REPOSITIONED_WINDOW_DAYS * 86_400_000;

  return (
    <TabSection
      title="How they describe themselves"
      action={
        versionsTotal && versionsTotal > 1 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {versionsTotal} {versionsTotal === 1 ? "version" : "versions"} captured
          </span>
        ) : undefined
      }
    >
      <ol className="relative m-0 flex list-none flex-col gap-6 p-0 pl-[22px] before:absolute before:bottom-2 before:left-1 before:top-2 before:w-px before:bg-border">
        {versions.map((v, i) => {
          const previous = versions[i + 1];
          const current = i === 0;
          const added = previous
            ? v.valueProps.filter((p) => !previous.valueProps.includes(p))
            : [];
          const dropped = previous
            ? previous.valueProps.filter((p) => !v.valueProps.includes(p))
            : [];
          const ctaMoved =
            previous != null && v.primaryCta !== null && v.primaryCta !== previous.primaryCta;

          return (
            <li key={v.capturedAt} className="relative flex flex-col gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "absolute -left-[22px] top-[5px] size-[9px] rounded-full border",
                  current ? "border-accent bg-accent" : "border-border-strong bg-surface",
                )}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">{format(new Date(v.capturedAt), "d MMM yyyy")}</span>
                {current && recent && (
                  <Badge className="text-meta font-medium">
                    Changed {formatDistanceToNow(new Date(v.capturedAt))} ago
                  </Badge>
                )}
                {!current && previous && (
                  <span>
                    held for {formatDistanceToNow(new Date(previous.capturedAt))}
                  </span>
                )}
              </div>
              {v.h1 ? (
                <p
                  className={cn(
                    "m-0 leading-snug tracking-tight text-balance",
                    current
                      ? "text-lead font-semibold text-foreground"
                      : "text-content font-medium text-muted-foreground",
                  )}
                >
                  {v.h1}
                </p>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">No headline captured.</p>
              )}
              {v.subheadline && (
                <p className="m-0 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
                  {v.subheadline}
                </p>
              )}
              {v.primaryCta && (
                <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Primary CTA</span>
                  <span className="font-medium text-foreground">{v.primaryCta}</span>
                  {ctaMoved && previous?.primaryCta && (
                    <span>was &ldquo;{previous.primaryCta}&rdquo;</span>
                  )}
                </p>
              )}
              {(added.length > 0 || dropped.length > 0) && (
                <dl className="m-0 grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 pt-0.5">
                  {added.length > 0 && (
                    <>
                      <dt className="text-xs text-muted-foreground">Added</dt>
                      <dd className="m-0 flex flex-wrap gap-1.5">
                        {added.map((p) => (
                          <span
                            key={p}
                            className="rounded-sm border border-positive/30 bg-positive/[0.08] px-1.5 py-0.5 text-meta text-positive"
                          >
                            {p}
                          </span>
                        ))}
                      </dd>
                    </>
                  )}
                  {dropped.length > 0 && (
                    <>
                      <dt className="text-xs text-muted-foreground">Dropped</dt>
                      <dd className="m-0 flex flex-wrap gap-1.5">
                        {dropped.map((p) => (
                          // Struck through: what they STOPPED claiming is as telling
                          // as what they started, and plain text loses which is which.
                          <span
                            key={p}
                            className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta text-muted-foreground line-through decoration-border-strong"
                          >
                            {p}
                          </span>
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
              )}
            </li>
          );
        })}
      </ol>

      {timeline.hasNextPage && (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={timeline.isFetchingNextPage}
            onClick={() => void timeline.fetchNextPage()}
          >
            {timeline.isFetchingNextPage ? (
              <>
                <SpinnerIcon size={16} className="animate-spin" /> Loading…
              </>
            ) : (
              "Load earlier versions"
            )}
          </Button>
        </div>
      )}
    </TabSection>
  );
}

// ── 2. Proof ────────────────────────────────────────────────────────────────

/**
 * The numbers they put on their own homepage, and how each has moved.
 *
 * `rawText` is quoted verbatim: the value of "they now claim 15,000 teams" is that
 * a reader can check it against the page, and a number restated in our own words
 * cannot be. The parsed value is what makes the series comparable — it is what
 * produces the arrow, never what is shown as the claim.
 */
function ProofSection({
  claims,
  logos,
  testimonials,
  capturedAt,
}: {
  claims: CompetitorClaim[] | null;
  logos: number;
  testimonials: number;
  capturedAt: string | null;
}) {
  if (claims === null) {
    return (
      <TabSection title="What they claim">
        <Skeleton className="h-20 w-full" />
      </TabSection>
    );
  }

  // The section's whole subject is the numbers they state, and they state none. A
  // heading over a bare "12 customer logos" promised a claim and delivered a count,
  // which is the empty-block-with-content-styling this page had four of (OUT-183).
  // The proof we do hold is not lost, it just stops being a section.
  if (claims.length === 0) {
    const proof: string[] = [];
    if (logos > 0) proof.push(`${logos} customer ${logos === 1 ? "logo" : "logos"}`);
    if (testimonials > 0)
      proof.push(`${testimonials} ${testimonials === 1 ? "testimonial" : "testimonials"}`);
    return (
      <TabAbsence title="What they claim">
        No number stated on their homepage
        {proof.length > 0 && `. Their proof is social: ${proof.join(" and ")}`}
        {capturedAt && `, captured ${format(new Date(capturedAt), "d MMM yyyy")}`}.
      </TabAbsence>
    );
  }

  return (
    <TabSection
      title="What they claim"
      action={
        <span className="shrink-0 text-xs text-muted-foreground">read off their homepage</span>
      }
    >
      {claims.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {claims.slice(0, CLAIMS_SHOWN).map((claim) => {
            const first = claim.series[0];
            const moved = first && first.value !== claim.value ? first : null;
            return (
              <li
                key={`${claim.pattern}|${claim.unit ?? ""}|${claim.context}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 border-t border-border py-2.5 first:border-t-0 first:pt-0"
              >
                <span className="text-content font-semibold tracking-tight tabular-nums">
                  {claim.rawText}
                </span>
                <span
                  className={cn(
                    "text-right text-xs tabular-nums whitespace-nowrap",
                    moved && moved.value < claim.value
                      ? "text-positive"
                      : "text-muted-foreground",
                  )}
                >
                  {moved
                    ? `${moved.value < claim.value ? "↑" : "↓"} from ${formatClaimValue(moved.value)} · ${format(new Date(moved.observedAt), "d MMM yyyy")}`
                    : `unchanged since ${format(new Date(claim.series[0]?.observedAt ?? claim.observedAt), "d MMM yyyy")}`}
                </span>
                <span className="col-span-2 text-dense text-muted-foreground">
                  {claim.context}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {(logos > 0 || testimonials > 0) && (
        <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
          {logos > 0 && (
            <span>
              <span className="font-semibold tabular-nums">{logos}</span> customer{" "}
              {logos === 1 ? "logo" : "logos"}
            </span>
          )}
          {logos > 0 && testimonials > 0 && (
            <span aria-hidden className="text-border-strong">
              ·
            </span>
          )}
          {testimonials > 0 && (
            <span>
              <span className="font-semibold tabular-nums">{testimonials}</span>{" "}
              {testimonials === 1 ? "testimonial" : "testimonials"}
            </span>
          )}
          {capturedAt && (
            <span className="text-xs text-muted-foreground">
              on the homepage, captured {format(new Date(capturedAt), "d MMM yyyy")}
            </span>
          )}
        </p>
      )}
    </TabSection>
  );
}

/** A claim's earlier value, in the same shape the raw text prints it. */
function formatClaimValue(value: number): string {
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 10_000) return `${trim(value / 1_000)}K`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
const trim = (n: number) => String(Math.round(n * 10) / 10);

// ── 3. Market map ───────────────────────────────────────────────────────────

/**
 * Who they line up against, in two directions.
 *
 * "They compare against" reads their own rows. "Named by" is the intra-workspace
 * cross reference — deliberately scoped to competitors THIS workspace tracks, and
 * it can legitimately include the reader's own product when their site names them.
 * Hiding that row would be a lie of omission on the one page about who fights whom.
 *
 * "Also named in their content" is a THIRD list and it exists because it used to be
 * folded into the first. A company named in a blog post rendered exactly like a
 * company they built a `/vs/` page against, so a container registry read as lining
 * up against the airline in its own launch post. The evidence differs, so the claim
 * has to: a page is a front, a post is a mention, and only the first is stated.
 *
 * A comparison page naming the READER is not in `named_competitors` by design (the
 * reader is never filed as a rival of the company attacking them), so it is
 * rendered above the map from the change that detected it.
 */
function MarketMapSection({
  map,
  loading,
  comparisons,
  signalByChangeId,
  competitorName,
  competitorUrl,
}: {
  map: MarketMap | null;
  loading: boolean;
  comparisons: ChangeRow[];
  signalByChangeId: Map<string, CompetitorSignal>;
  competitorName: string;
  competitorUrl: string;
}) {
  const [showAllTargets, setShowAllTargets] = useState(false);
  const [showAllMentions, setShowAllMentions] = useState(false);
  const targets = map?.targets ?? [];
  const mentions = map?.mentions ?? [];

  return (
    <TabSection
      title="Who they line up against"
      action={
        <span className="shrink-0 text-xs text-muted-foreground">
          their own pages and posts
        </span>
      }
    >
      {comparisons.map((c) => {
        const signal = signalByChangeId.get(c.id);
        return (
          <div
            key={c.id}
            className="flex flex-col gap-2.5 rounded-lg border border-critical/30 bg-critical/[0.06] px-4 py-3.5"
          >
            <div className="flex flex-wrap items-center gap-3">
              {signal && <SeverityScale severity={signal.severity} size="compact" />}
              <h4 className="text-content font-semibold tracking-tight">
                They published a comparison page
              </h4>
            </div>
            <p className="m-0 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
              {signal?.insight ??
                c.summary ??
                `${competitorName} added a comparison page to their sitemap. Whoever writes the comparison chooses the criteria.`}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span>
                detected {formatDistanceToNow(new Date(c.detectedAt), { addSuffix: true })}
              </span>
              <a
                href={c.monitorUrl ?? competitorUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-link hover:underline"
              >
                Read their page <ArrowSquareOutIcon size={14} />
              </a>
            </div>
          </div>
        );
      })}

      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="flex flex-col gap-5 sm:gap-7">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-7">
          {targets.length > 0 && (
            <div className="flex flex-col gap-2.5 sm:only:col-span-2">
              <div className="flex flex-col gap-0.5">
                <h4 className="m-0 text-sm font-semibold tracking-tight">They compare against</h4>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {map?.targetsTotal ?? targets.length}{" "}
                  {(map?.targetsTotal ?? targets.length) === 1 ? "rival" : "rivals"} they publish a
                  comparison page against
                </span>
              </div>
              <TargetList
                targets={targets}
                showAll={showAllTargets}
                onShowAll={() => setShowAllTargets(true)}
              />
            </div>
          )}

          {(map?.namedBy.length ?? 0) > 0 && (
            <div className="flex flex-col gap-2.5 sm:only:col-span-2">
              <div className="flex flex-col gap-0.5">
                <h4 className="m-0 text-sm font-semibold tracking-tight">Named by</h4>
                <span className="text-xs text-muted-foreground">
                  competitors you track that name them in public
                </span>
              </div>
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-x-6 p-0">
                {(map?.namedBy ?? []).map((n) => (
                  <li
                    key={n.competitorId}
                    className="flex flex-col gap-0.5 border-t border-border py-2"
                  >
                    <span className="text-sm font-medium">{n.competitorName}</span>
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>matched on {n.matchedOn}</span>
                      <span aria-hidden className="text-border-strong">
                        ·
                      </span>
                      <span className="tabular-nums">
                        {n.evidenceUrls.length || 1}{" "}
                        {(n.evidenceUrls.length || 1) === 1 ? "page" : "pages"}
                      </span>
                      {n.evidenceUrls[0] && (
                        <>
                          <span aria-hidden className="text-border-strong">
                            ·
                          </span>
                          <a
                            href={n.evidenceUrls[0]}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-link hover:underline"
                          >
                            <span className="font-mono">
                              {n.evidenceUrls[0].replace(/^https?:\/\/(www\.)?/, "")}
                            </span>
                            <ArrowSquareOutIcon size={12} />
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {mentions.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-0.5">
              <h4 className="m-0 text-sm font-semibold tracking-tight">
                Also named in their content
              </h4>
              <span className="text-xs text-muted-foreground tabular-nums">
                {map?.mentionsTotal ?? mentions.length}{" "}
                {(map?.mentionsTotal ?? mentions.length) === 1 ? "company" : "companies"} a post or
                a doc page names, with no comparison page behind them. A mention is not a rivalry.
              </span>
            </div>
            <TargetList
              targets={mentions}
              showAll={showAllMentions}
              onShowAll={() => setShowAllMentions(true)}
            />
          </div>
        )}
        </div>
      )}
    </TabSection>
  );
}

/**
 * One column of named companies, capped until asked.
 *
 * Shared by the two halves of the map so a front and a mention are rendered by the
 * same code and can only ever differ in the heading that frames them — the split
 * lives in the data, not in two lists that drifted apart.
 */
function TargetList({
  targets,
  showAll,
  onShowAll,
}: {
  targets: NamedTarget[];
  showAll: boolean;
  onShowAll: () => void;
}) {
  const shown = showAll ? targets : targets.slice(0, TARGETS_SHOWN);
  return (
    <>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-x-6 p-0">
        {shown.map((t) => (
          <li key={t.name} className="flex flex-col gap-0.5 border-t border-border py-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t.name}</span>
              {t.announced && <Badge className="text-meta font-medium">New</Badge>}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{t.sources.map(sourceLabel).join(", ")}</span>
              {t.firstSeenAt && (
                <>
                  <span aria-hidden className="text-border-strong">
                    ·
                  </span>
                  <span className="tabular-nums">
                    first seen {format(new Date(t.firstSeenAt), "d MMM yyyy")}
                  </span>
                </>
              )}
              {t.evidenceUrls[0] && (
                <>
                  <span aria-hidden className="text-border-strong">
                    ·
                  </span>
                  <a
                    href={t.evidenceUrls[0]}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-link hover:underline"
                  >
                    <span className="font-mono">
                      {t.evidenceUrls[0].replace(/^https?:\/\/(www\.)?/, "")}
                    </span>
                    <ArrowSquareOutIcon size={12} />
                  </a>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {targets.length > TARGETS_SHOWN && !showAll && (
        <button
          type="button"
          onClick={onShowAll}
          className="self-start rounded-sm text-xs text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show all {targets.length}
        </button>
      )}
    </>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  vs_page: "vs page",
  alternatives_page: "alternatives page",
  blog: "blog",
  docs: "docs",
};
const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;

// ── 4. ICP ──────────────────────────────────────────────────────────────────

/**
 * Who they say they sell to, against who their own stories prove they sell to.
 *
 * The industry block is a matrix rather than two chip lists because the gap IS the
 * reading: a vertical with a page and no stories is a market they are aiming at,
 * one with stories and no page is a market they landed without claiming it. Two
 * lists side by side hide both.
 */
function IcpSection({
  icp,
  loading,
  failed,
}: {
  icp: AudienceProfile | null;
  loading: boolean;
  failed: boolean;
}) {
  if (loading) {
    return (
      <TabSection title="Who they sell to">
        <Skeleton className="h-20 w-full" />
      </TabSection>
    );
  }
  // A failed read is NOT a slow one. The parent collapses an errored query to a
  // null profile, so a skeleton on `!icp` kept spinning forever on a 500 and the
  // section read as permanently loading — say what happened instead.
  if (failed) {
    return (
      <TabSection title="Who they sell to">
        <Empty text="Couldn't load this data right now. Try again in a moment." />
      </TabSection>
    );
  }
  if (!icp) return null;

  const provenBySlug = new Map(icp.industries.proven.map((p) => [p.slug, p]));
  const declaredSlugs = new Set(icp.industries.declared.map((d) => d.slug));
  const rows = [
    ...icp.industries.declared.map((d) => ({
      slug: d.slug,
      label: d.displayName,
      evidenceUrl: d.evidenceUrl,
      isNew: d.isNew,
      declared: true,
      proven: provenBySlug.get(d.slug)?.count ?? 0,
    })),
    ...icp.industries.proven
      .filter((p) => !declaredSlugs.has(p.slug))
      .map((p) => ({
        slug: p.slug,
        label: p.label,
        evidenceUrl: null,
        isNew: false,
        declared: false,
        proven: p.count,
      })),
  ].sort((a, b) => b.proven - a.proven || a.label.localeCompare(b.label));

  return (
    <TabSection
      title="Who they sell to"
      action={
        icp.newCount > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {icp.newCount} opened in the last {icp.windowDays} days
          </span>
        ) : undefined
      }
    >
      {icp.personas.length > 0 && (
        <SegmentGroup label="Personas they publish a page for" segments={icp.personas} />
      )}
      {icp.useCases.length > 0 && <SegmentGroup label="Jobs they name" segments={icp.useCases} />}

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">
            Industries — what they claim against what their stories prove
          </span>
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem]">
            <span className="pb-1.5 text-xs text-muted-foreground">Industry</span>
            <span className="pb-1.5 text-right text-xs text-muted-foreground">Page</span>
            <span className="pb-1.5 text-right text-xs text-muted-foreground">Stories</span>
            {rows.map((r) => (
              <div key={r.slug} className="contents">
                <span className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
                  {r.evidenceUrl ? (
                    <a
                      href={r.evidenceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:underline"
                    >
                      {r.label}
                    </a>
                  ) : (
                    r.label
                  )}
                  {r.isNew && <Badge className="text-meta font-medium">New</Badge>}
                </span>
                <span
                  className={cn(
                    "border-t border-border py-2 text-right text-sm",
                    r.declared ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {r.declared ? "Yes" : "—"}
                </span>
                <span
                  className={cn(
                    "border-t border-border py-2 text-right text-sm tabular-nums",
                    r.proven > 0 ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {r.proven > 0 ? r.proven : "—"}
                </span>
              </div>
            ))}
          </div>
          <p className="m-0 text-dense text-muted-foreground">
            {icp.industries.declared.length} declared, {icp.industries.proven.length} proven,{" "}
            {icp.industries.both.length} in both.
          </p>
        </div>
      )}
    </TabSection>
  );
}

function SegmentGroup({ label, segments }: { label: string; segments: AudienceSegment[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {segments.map((s) => (
          <span
            key={s.slug}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-dense"
          >
            {s.evidenceUrl ? (
              <a
                href={s.evidenceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
              >
                {s.displayName}
              </a>
            ) : (
              s.displayName
            )}
            {s.isNew && <Badge className="text-meta font-medium">New</Badge>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 5. Share of Model ───────────────────────────────────────────────────────

const ENGINE_LABELS: Record<string, string> = {
  gemini: "Gemini",
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  claude: "Claude",
  google_aio: "Google AI Overviews",
};

const ratePct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * What the AI engines say about them (P5).
 *
 * Three states, and the section renders all three. The two thin ones state what IS
 * being collected rather than "coming soon", because the runs are real and already
 * accruing: a reader told nothing assumes the capability is absent, and a reader
 * told "6 prompts, last run yesterday" knows the view is waiting on data, not on
 * engineering. The section hides entirely only when this workspace runs no
 * visibility prompts at all — there is then nothing honest to say.
 *
 * Nothing here is generated. Every figure is an average over captured answers, and
 * the verbatim lines are substrings of the answers themselves.
 */
function ShareOfModelSection({
  summary,
  loading,
}: {
  summary: PositioningSummary | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <TabSection title="Share of Model">
        <Skeleton className="h-16 w-full" />
      </TabSection>
    );
  }
  const som = summary?.shareOfModel;
  if (!som || som.prompts === 0) return null;

  if (som.status !== "ready") {
    // Collecting, not empty — the runs are real and already accruing, so this still
    // says what is being gathered. But it is an absence, and rendering it as a
    // section with a bordered panel inside made a page of waiting figures read as a
    // page of thin results (OUT-183). One inset line, same words.
    return (
      <TabAbsence title="Share of Model">
        {som.status === "insufficient_data" ? (
          <>
            <span className="tabular-nums">{som.nRuns}</span> of{" "}
            <span className="tabular-nums">{som.minRuns}</span> runs so far in the last{" "}
            <span className="tabular-nums">{som.windowDays}</span> days. An engine answers the
            same question differently each time, so a rate is only worth showing once enough runs
            have averaged that out.
          </>
        ) : (
          <>
            We ask <span className="tabular-nums">{som.prompts}</span> buyer-intent{" "}
            {som.prompts === 1 ? "question" : "questions"} to the AI engines and record who gets
            named.{" "}
            {som.answers > 0 ? (
              <>
                <span className="tabular-nums">{som.answers}</span>{" "}
                {som.answers === 1 ? "answer" : "answers"} held about them
                {som.lastRunAt && `, last run ${format(new Date(som.lastRunAt), "d MMM yyyy")}`}.
              </>
            ) : (
              "No answer has come back about them yet."
            )}
          </>
        )}
      </TabAbsence>
    );
  }

  const { competitor, self, series, promptOutcomes, extracts, narrative } = som;
  const m = competitor.metrics;
  const points = series.filter((s): s is typeof s & { mentionRate: number } => s.mentionRate != null);

  return (
    <TabSection title="Share of Model">
      <div className="flex flex-col gap-5">
        <p className="m-0 max-w-[70ch] text-sm text-muted-foreground">
          Named in <span className="tabular-nums text-foreground">{m.mentions}</span> of{" "}
          <span className="tabular-nums text-foreground">{m.answers}</span> AI answers over the last{" "}
          <span className="tabular-nums text-foreground">{som.windowDays}</span> days
          {m.engines.length > 0 &&
            ` (${m.engines.map((e) => ENGINE_LABELS[e] ?? e).join(", ")})`}
          , across <span className="tabular-nums text-foreground">{m.nRuns}</span> runs.
        </p>

        {/* Their window against yours. Four figures, each with what it was computed
            over — a rate whose denominator is off-screen reads as a certainty. */}
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <StatBlock
            label={`${competitor.name} — #${som.position} of ${som.tracked} tracked`}
            stats={m}
            trend={competitor.trend}
          />
          {self && (
            <StatBlock label={`${self.name} (you)`} stats={self.metrics} trend={self.trend} />
          )}
        </div>

        {points.length >= 2 && <MentionRateSparkline series={series} windowDays={som.windowDays} />}

        {/* The narrative gap. Two columns, no verdict between them: what they say,
            beside what the engines return. The reader draws the line. */}
        {(narrative.h1 || narrative.claim) && (
          <div className="grid gap-4 rounded-md border border-border bg-surface-2 p-4 sm:grid-cols-2">
            <div>
              <p className="m-0 text-xs text-muted-foreground">What they say</p>
              {narrative.h1 && <p className="m-0 mt-1 text-sm text-foreground">{narrative.h1}</p>}
              {narrative.claim && (
                <p className="m-0 mt-1 text-sm text-muted-foreground">
                  {narrative.claim.rawText}
                </p>
              )}
            </div>
            <div>
              <p className="m-0 text-xs text-muted-foreground">What the AI engines show</p>
              <p className="m-0 mt-1 text-sm text-foreground">
                Mentioned in <span className="tabular-nums">{m.mentions}</span> of{" "}
                <span className="tabular-nums">{m.answers}</span> answers this month
                {m.avgRank != null && (
                  <>
                    , on average at position{" "}
                    <span className="tabular-nums">{m.avgRank.toFixed(1)}</span>
                  </>
                )}
                .
              </p>
              {extracts.length > 0 && (
                <p className="m-0 mt-1 text-sm text-muted-foreground">
                  &ldquo;{extracts[0]!.text}&rdquo;
                </p>
              )}
            </div>
          </div>
        )}

        {extracts.length > 0 && (
          <div>
            <p className="m-0 text-xs text-muted-foreground">
              How AI engines describe them — quoted from the answers, unedited
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {extracts.map((e) => (
                <li key={`${e.engine}-${e.recordedAt}-${e.text}`} className="text-sm">
                  <span className="text-foreground">&ldquo;{e.text}&rdquo;</span>{" "}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {ENGINE_LABELS[e.engine] ?? e.engine}, {format(new Date(e.recordedAt), "d MMM")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {promptOutcomes.length > 0 && (
          <div>
            <p className="m-0 text-xs text-muted-foreground">
              Last run, question by question
              {promptOutcomes[0] &&
                ` — ${format(new Date(promptOutcomes[0].recordedAt), "d MMM yyyy")}`}
            </p>
            <ul className="mt-2 flex flex-col">
              {promptOutcomes.map((o) => (
                <li
                  key={`${o.promptId}-${o.engine}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-t border-border py-2 first:border-t-0"
                >
                  <span className="min-w-0 text-sm leading-snug">
                    {o.prompt}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {ENGINE_LABELS[o.engine] ?? o.engine}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
                    {o.promptNamed ? (
                      // Naming a brand in the question guarantees it appears, so the
                      // answer is not evidence an engine surfaced them — and it is
                      // why a denominator can read 9 where 10 questions ran.
                      <span className="text-muted-foreground">Named in the question</span>
                    ) : o.mentioned ? (
                      <>
                        <Badge className="text-meta font-medium">Named</Badge>
                        {o.rank != null && (
                          <span className="text-muted-foreground tabular-nums">#{o.rank}</span>
                        )}
                        {o.cited && <span className="text-muted-foreground">cited</span>}
                        {o.sentiment != null && (
                          <span className="text-muted-foreground tabular-nums">
                            {Math.round(o.sentiment)}/100
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not named</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </TabSection>
  );
}

/** One subject's window. Every rate carries the count it was computed over. */
function StatBlock({
  label,
  stats,
  trend,
}: {
  label: string;
  stats: VisibilityWindowFact;
  trend: VisibilitySubjectStats["trend"];
}) {
  const movement =
    trend.mentionRate == null
      ? null
      : `${trend.mentionRate > 0 ? "+" : ""}${Math.round(trend.mentionRate * 100)} pts`;

  return (
    <div className="rounded-md border border-border p-4">
      <p className="m-0 text-xs text-muted-foreground">{label}</p>
      <p className="m-0 mt-1 flex items-baseline gap-2">
        <span className="text-xl font-medium tabular-nums">{ratePct(stats.mentionRate)}</span>
        {movement && (
          <span
            className={cn(
              "text-xs tabular-nums",
              trend.mentionRate! > 0 ? "text-positive" : "text-muted-foreground",
            )}
          >
            {movement}
          </span>
        )}
      </p>
      <p className="m-0 mt-1 text-xs text-muted-foreground tabular-nums">
        {stats.mentions} of {stats.answers} answers · {stats.nRuns} runs
        {stats.avgRank != null && ` · avg position ${stats.avgRank.toFixed(1)}`}
        {stats.citedRate != null && ` · cited ${ratePct(stats.citedRate)}`}
      </p>
    </div>
  );
}

/**
 * Mention rate across the last six windows.
 *
 * A window that never met the run minimum draws NO point: the endpoint sends null
 * for it, and joining across the gap would let a quota-starved fortnight read as a
 * collapse. The line is drawn between the windows that were actually measured.
 */
function MentionRateSparkline({
  series,
  windowDays,
}: {
  series: Array<{ windowStart: string; mentionRate: number | null; nRuns: number }>;
  windowDays: number;
}) {
  const W = 240;
  const H = 40;
  const step = series.length > 1 ? W / (series.length - 1) : W;
  const points = series
    .map((s, i) => ({ ...s, x: i * step }))
    .filter((s): s is typeof s & { mentionRate: number } => s.mentionRate != null)
    .map((s) => ({ ...s, y: H - s.mentionRate * H }));

  return (
    <div>
      <p className="m-0 text-xs text-muted-foreground">
        Mention rate, {series.length} windows of{" "}
        <span className="tabular-nums">{windowDays}</span> days
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-10 w-full max-w-[240px] overflow-visible text-link"
        role="img"
        aria-label={`Mention rate over the last ${series.length} windows: ${points
          .map((p) => ratePct(p.mentionRate))
          .join(", ")}`}
      >
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        />
        {points.map((p) => (
          <circle key={p.windowStart} cx={p.x} cy={p.y} r={2} className="fill-current" />
        ))}
      </svg>
    </div>
  );
}

// ── The chronological readings this tab keeps ───────────────────────────────

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
            <span className="text-xs tabular-nums text-muted-foreground">
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
                <span className="text-xs tabular-nums text-muted-foreground">{engagement}</span>
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
                  {linkLabel} <ArrowSquareOutIcon size={14} />
                </a>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
