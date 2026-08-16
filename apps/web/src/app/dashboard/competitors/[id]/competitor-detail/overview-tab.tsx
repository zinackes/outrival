"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { classifyLogoName, storySummary, type AnalysisStatus } from "@outrival/shared";
import { toast } from "@/lib/toast";
import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  GridFourIcon,
  StarIcon,
  SpinnerIcon,
  PlayIcon,
  TranslateIcon,
} from "@/components/icons";
import {
  api,
  type CompetitorSignal,
  type CompetitorStory,
  type CompetitorOverview,
  type Monitor,
  type PricingStatus,
  type TechStackData,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CompetitorTechStack } from "@/components/outrival/competitor-tech-stack";
import { MemoryTimeline } from "@/components/dashboard/digest-view";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { SeenBadge } from "@/components/dashboard/seen-badge";
import { HeadToHeadSections } from "./head-to-head-sections";
import { MobileAppsFact, type MobileApps } from "./mobile-apps";
import { formatTierPrice, logoLabel, isRenderableLogoSrc } from "./helpers";
import { scrapeActivity } from "./shared";
import type { TabKey } from "./types";

/**
 * One cell of the headline strip. The old "At a glance" spread three items across
 * the full page width, so a four-line price list floated alone in a dark field and
 * two of the three cells read "Not captured". These are dense, evenly divided, and
 * every one of them is a link into the tab that owns the number.
 */
function Metric({
  label,
  onClick,
  children,
  foot,
  seen,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  foot?: React.ReactNode;
  /**
   * Where this figure was read and when (OUT-194). The age sits on the label row
   * rather than in `foot`, which already carries the movement reading; the source
   * itself is in the badge's tooltip, since the cell has no width for both.
   */
  seen?: { source: string; at: string | null };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1.5 border-border p-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&:not(:nth-child(2n+1))]:border-l sm:border-l sm:first:border-l-0"
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <CaretRightIcon size={14} className="opacity-60" aria-hidden />
        {seen && <SeenBadge compact source={seen.source} at={seen.at} className="ml-auto" />}
      </span>
      <span className="block">{children}</span>
      {foot && <span className="flex min-h-4 items-center gap-1.5 text-xs">{foot}</span>}
    </button>
  );
}

/** A number that carries the reading, in the data voice. */
function Big({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
      {children}
    </span>
  );
}

/** An absence. Never a bare "Not captured", which reads as a scrape failure. */
function Absent({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>;
}

/**
 * One captured call to action: our label for its slot, then their words verbatim.
 * Linked only when the parser resolved an absolute URL — a relative href stored by
 * an older capture would resolve against OUR domain and send the reader to a page
 * of ours that looks like theirs.
 */
function CtaRow({ label, cta }: { label: string; cta: { text: string; href: string | null } }) {
  const href = cta.href && /^https?:\/\//i.test(cta.href) ? cta.href : null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <dt className="w-[6.5rem] shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-link hover:underline"
          >
            {cta.text} <ArrowSquareOutIcon size={14} />
          </a>
        ) : (
          cta.text
        )}
      </dd>
    </div>
  );
}

function LogoChip({ logo }: { logo: { name: string | null; src: string | null } }) {
  const [failed, setFailed] = useState(false);
  // An opaque/square source image silhouettes into a featureless block under the wall's
  // ink filter. Two signals flip `blocky`: a CORS pixel probe (opaque coverage, below)
  // and the loaded aspect ratio (onLoad). When blocky, the tile shows its name — or
  // drops entirely when there's none.
  const [blocky, setBlocky] = useState(false);
  const src = logo.src?.trim() || "";
  // Name to label/alt the logo. A stored brand name is already classifier-verified
  // (API refineLogo). The filename-derived fallback, however, is usually junk
  // ("image 17", "Picture1 1", an asset hash) — surface it as text ONLY when it
  // independently reads as a real brand, otherwise lean on the image (or drop).
  const derived = src ? logoLabel(src) : "";
  const name =
    logo.name?.trim() ||
    (derived && classifyLogoName(derived).kind === "brand" ? derived : "");

  // A logo with no transparent background fills the whole tile with solid black under
  // the silhouette filter — a featureless grey block. Probe the pixels via a CORS
  // load (most logo CDNs allow it); if the artwork is near-fully opaque, treat it as
  // blocky so it renders its name instead — and drops when there's no name. When CORS
  // is unavailable the probe stays silent and the aspect-ratio heuristic (onLoad) is
  // the fallback. React runs hooks unconditionally, so this sits above any early return.
  useEffect(() => {
    if (!src || !isRenderableLogoSrc(src) || /^data:/i.test(src)) return;
    let cancelled = false;
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      if (cancelled) return;
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(probe, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size); // throws if CORS-tainted
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]! > 32) opaque++;
        if (opaque / (size * size) > 0.92) setBlocky(true);
      } catch {
        /* cross-origin taint — fall back to the aspect-ratio heuristic */
      }
    };
    probe.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  // A JPEG can't carry transparency, so it always silhouettes into a solid filled
  // tile (a featureless grey block) under the ink filter — never a clean wordmark.
  // The CORS pixel probe (above) misses it when the CDN is tainted, and the
  // aspect-ratio heuristic (onLoad) only catches square art, not wide opaque
  // banners. Treat the format as blocky up front so it takes the name-or-drop path.
  const opaqueFormat = /\.jpe?g(\?|#|$)/i.test(src) || /^data:image\/jpe?g/i.test(src);
  const showImage = !!src && isRenderableLogoSrc(src) && !failed && !blocky && !opaqueFormat;
  if (!showImage && !name) return null;

  // Scraped customer logos arrive in every color, polarity and format. Slapping each
  // on a white plate makes light-on-light logos vanish and the grid read as mismatched
  // stickers. Instead normalise the whole set to a single ink-tone silhouette matched
  // to the theme — the standard "trusted by" wall treatment: coherent regardless of the
  // source artwork, polarity-correct in both light (dark ink) and dark (light ink) mode.
  const tile = (
    <div className="flex h-14 min-w-0 grow basis-[104px] items-center justify-center bg-card px-3">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external logo URL, next/image can't whitelist competitor domains
        <img
          src={src}
          alt={name || "Customer logo"}
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            const img = e.currentTarget;
            // Tracking pixels / lazy-load placeholders resolve to a near-empty image —
            // drop them so they don't render as blank tiles.
            if (img.naturalWidth < 8 || img.naturalHeight < 4) {
              setFailed(true);
              return;
            }
            // The wall is a coherent row of wide wordmark silhouettes. Square-ish artwork
            // (opaque brand square, favicon-style mark) collapses into a meaningless block
            // under the filter — treat it as blocky so it shows its name, or drops when
            // there's none. Wide wordmarks (the ones that read well) stay as images.
            if (img.naturalWidth / img.naturalHeight <= 1.4) setBlocky(true);
          }}
          className="max-h-7 max-w-full object-contain opacity-50 transition-opacity duration-150 [filter:brightness(0)] hover:opacity-80 dark:[filter:brightness(0)_invert(1)]"
        />
      ) : (
        <span className="truncate text-xs font-medium text-muted-foreground">{name}</span>
      )}
    </div>
  );

  // No name to surface → a tooltip would add nothing.
  if (!name) return tile;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

// State view ("fact sheet") — what this competitor says about itself right now:
// positioning, value props, customers, claims, all surfaced from the latest
// homepage capture, plus a compact pricing/hiring/reviews summary. AI summary,
// tech stack and KPIs already live above the tabs, so they're not repeated here.
// English translation of the foreign-language homepage facts, fetched on demand.
type TranslatedFacts = {
  headline: string | null;
  subheadline: string | null;
  valueProps: string[];
  testimonials: Array<{ quote: string; author: string | null }>;
};

// The translation is a per-competitor view preference: once a user translates (and
// whether they're viewing English or flipped back to the original), that choice should
// survive a refresh or navigation. We cache both the fetched translation and the
// toggle in localStorage, keyed by competitor, so we neither re-fetch nor reset.
const translationStorageKey = (id: string) => `outrival.overview-translation.${id}`;
type PersistedTranslation = { translated: TranslatedFacts; showOriginal: boolean };

// How much of the memory the overview shows before the reader asks for the rest.
// Twelve dated facts is a journal, and the overview is meant to be read above one:
// three says what moved lately, and the older ones are one click away (OUT-213).
const MEMORY_FACTS_SHOWN = 3;

export function OverviewTab({
  competitorId,
  competitorName,
  overview,
  signals,
  memory,
  monitors,
  scrapingIds,
  analysis,
  pricingStatus,
  pricingNote,
  onRun,
  onOpenTab,
  techStack,
  mobileApps,
}: {
  competitorId: string;
  overview: CompetitorOverview;
  // Detected without AI from the captures we already take; a fact, never a signal.
  mobileApps: MobileApps | null;
  /** Already loaded by the page; the 30-day count costs no extra query. */
  signals: CompetitorSignal[];
  /**
   * The whole watch, not the last 30 days: the dated facts we have on this
   * competitor, built by the same function the weekly brief narrates from
   * (OUT-172). Null before anything has changed.
   */
  memory: CompetitorStory | null;
  monitors: Monitor[];
  techStack: TechStackData;
  scrapingIds: Set<string>;
  // Where the first analysis is (queued → scraping → summarizing). Drives the
  // empty state so a freshly added competitor reads as "in progress" rather than
  // a static "nothing captured" with a redundant manual-scrape button.
  analysis: AnalysisStatus | null;
  // Pricing taxonomy of the competitor — drives a meaningful "Pricing now" empty
  // state (a known model without public numbers) instead of a flat "Not captured".
  pricingStatus: PricingStatus | null;
  pricingNote: string | null;
  onRun: (id: string) => void;
  onOpenTab: (tab: TabKey) => void;
  competitorName: string;
}) {
  const {
    homepage,
    numericClaims,
    pricingNow,
    pricingCapturedAt,
    reviews,
    hiring,
    capturedAt,
    movement,
  } = overview;

  // Entry price = the cheapest captured tier with a real number. Quote-based tiers
  // carry no figure, so they never win the "entry" slot.
  const entryTier = pricingNow
    .filter((p) => p.price != null && p.price > 0)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];

  // Signals are already in the page payload, so the 30-day count and its severity
  // split cost no extra query. This is the one cell that shows a rate rather than a
  // level, which is what a monitoring product is actually selling.
  const recent = signals.filter(
    (sig) => Date.now() - new Date(sig.createdAt).getTime() < 30 * 86_400_000,
  );
  const bands = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const sig of recent) bands[sig.severity] += 1;
  const worstBand =
    bands.critical > 0
      ? { n: bands.critical, label: "critical", cls: "bg-critical" }
      : bands.high > 0
        ? { n: bands.high, label: "high", cls: "bg-high" }
        : bands.medium > 0
          ? { n: bands.medium, label: "medium", cls: "bg-medium" }
          : null;

  const topReview = reviews[0];

  // When no price tier is captured but the page does state its pricing model — a
  // usage-based calculator or a sales-gated wall — surface that note rather than
  // "Not captured", which wrongly reads as a scrape failure. Only for statuses
  // that genuinely carry no public number; `public`/`unknown` stay "Not captured".
  const pricingModelNote =
    pricingNow.length === 0 &&
    !!pricingNote &&
    (pricingStatus === "dynamic" ||
      pricingStatus === "gated_demo" ||
      pricingStatus === "gated_signup")
      ? pricingNote
      : null;

  // The fact sheet is scraped verbatim, so a foreign competitor's copy shows in its
  // own language. `language` is detected from the actual copy server-side (not just
  // <html lang>), so a page with an English headline but a French description still
  // flags as foreign. Offer a one-click English translation (on demand) and let the
  // user flip back to the original.
  const language = homepage?.language ?? null;
  const isForeign = !!language && language !== "en";
  const [translated, setTranslated] = useState<TranslatedFacts | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [memoryExpanded, setMemoryExpanded] = useState(false);

  // Restore the persisted translation + toggle after mount (read post-mount to dodge
  // an SSR/hydration mismatch). Keyed by competitor, so switching competitors reloads
  // that competitor's own choice.
  useEffect(() => {
    if (!isForeign) return;
    try {
      const raw = window.localStorage.getItem(translationStorageKey(competitorId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedTranslation;
      if (parsed?.translated) {
        setTranslated(parsed.translated);
        setShowOriginal(!!parsed.showOriginal);
      }
    } catch {
      /* localStorage blocked or malformed — fall back to the un-translated view */
    }
  }, [competitorId, isForeign]);

  // Persist the current view (fetched translation + which side is showing) so a refresh
  // keeps exactly what the user left on screen.
  useEffect(() => {
    if (!translated) return;
    try {
      window.localStorage.setItem(
        translationStorageKey(competitorId),
        JSON.stringify({ translated, showOriginal } satisfies PersistedTranslation),
      );
    } catch {
      /* localStorage unavailable — the toggle just won't survive a refresh */
    }
  }, [competitorId, translated, showOriginal]);

  async function handleTranslate() {
    if (translating) return;
    setTranslating(true);
    try {
      const res = await api.translateCompetitorOverview(competitorId);
      setTranslated(res.translated);
      setShowOriginal(false);
    } catch {
      toast.error("Couldn't translate right now. Showing the original.");
    } finally {
      setTranslating(false);
    }
  }

  // What to render: translated copy unless the user flipped back to the original.
  const showTranslated = !!translated && !showOriginal;
  const dHeadline = showTranslated ? translated.headline : homepage?.headline ?? null;
  const dSubheadline = showTranslated ? translated.subheadline : homepage?.subheadline ?? null;
  const dValueProps = showTranslated ? translated.valueProps : homepage?.valueProps ?? [];
  const dTestimonials = showTranslated ? translated.testimonials : homepage?.testimonials ?? [];
  // Scraped logo sets routinely repeat the same brand (header, footer, "trusted by"
  // strip) — dedupe by image src / name so each customer shows once on the wall.
  const customerLogos = (() => {
    const seen = new Set<string>();
    const out: { name: string | null; src: string | null }[] = [];
    for (const l of homepage?.customerLogos ?? []) {
      const key = (l.src?.trim() || l.name?.trim() || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(l);
    }
    return out;
  })();
  // The verdict for "How they sell". Null when the main button asks for neither
  // motion ("Learn more", "Explore the platform"), in which case its label shows on
  // its own rather than under a claim the label does not support.
  const motionRead = (() => {
    const gtm = homepage?.gtm;
    if (!gtm?.motion) return null;
    const alt =
      gtm.alternate === "sales_led"
        ? " They keep a sales path next to it."
        : gtm.alternate === "self_serve"
          ? " They keep a self-serve path next to it."
          : "";
    return gtm.motion === "self_serve"
      ? {
          label: "Self-serve",
          basis: `The call to action on their homepage lets a visitor start on their own, without talking to anyone.${alt}`,
        }
      : {
          label: "Sales-led",
          basis: `The call to action on their homepage asks for a conversation before a visitor can use the product.${alt}`,
        };
  })();

  const hasFacts =
    !!homepage &&
    !!(
      homepage.headline ||
      homepage.subheadline ||
      homepage.valueProps.length > 0 ||
      homepage.customerLogos.length > 0 ||
      homepage.testimonials.length > 0 ||
      // The GTM read counts only when it produced a verdict, since that is the
      // condition its section renders under. Optional-chained because web and api
      // deploy separately: a new page can briefly read a payload without these two.
      !!motionRead ||
      (homepage.navItems?.length ?? 0) > 0
    );
  const hasAnything =
    hasFacts ||
    numericClaims.length > 0 ||
    pricingNow.length > 0 ||
    reviews.length > 0 ||
    hiring.openRoles > 0 ||
    // A competitor we have watched change has something to say even if the homepage
    // capture came back thin — that history is the point of the page.
    (memory?.facts.length ?? 0) > 0;

  // Facts the compact rail leaves out. The cap itself is the API's (12); this only
  // decides how many of them are on screen before the reader asks for the rest.
  const memoryHidden = Math.max(0, (memory?.facts.length ?? 0) - MEMORY_FACTS_SHOWN);

  if (!hasAnything) {
    const homepageMonitor = monitors.find((m) => m.sourceType === "homepage");
    const activity = homepageMonitor
      ? scrapeActivity(homepageMonitor, scrapingIds.has(homepageMonitor.id))
      : null;
    // The first analysis is still running (queued → scraping → summarizing). The
    // top-of-page stepper carries the live stage; here we just avoid a misleading
    // "Nothing captured yet" + manual-scrape button while it's already working.
    if (analysis?.pending || activity) {
      // The stepper above this panel already says which of those it is, so this
      // has to agree with it: "we're scanning the homepage" under a banner that
      // reads "waiting in the scan queue" is the contradiction that made the wait
      // look like a hang. Both read the same anchor monitor, so they cannot split.
      const waiting = analysis ? analysis.stage === "queued" : activity === "queued";
      return (
        <EmptyState
          icon={GridFourIcon}
          title={waiting ? "Waiting in the scan queue…" : "Analyzing this competitor…"}
          description={
            waiting
              ? "The first scan starts as soon as a scanner is free, then the insights are written. This tab fills in on its own, no need to refresh."
              : "We're scanning the homepage and generating the first insights. This tab fills in automatically once it's done, no need to refresh."
          }
        />
      );
    }
    return (
      <EmptyState
        icon={GridFourIcon}
        title="Nothing captured yet"
        description="Once the homepage is scraped, this is where you'll see what this competitor says about itself (positioning, value props, customers and pricing) at a glance."
        actions={
          homepageMonitor && (
            <Button size="sm" onClick={() => onRun(homepageMonitor.id)}>
              <PlayIcon size={16} /> Scrape homepage now
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The headline numbers, evenly divided and each one a way into its tab.
          Their own card: they answer "how are they doing", the sheet below
          answers "who are they", and merging the two lost that seam. */}
      <Card className="grid grid-cols-2 overflow-hidden rounded-lg sm:grid-cols-4">
        <Metric
          label="Entry price"
          onClick={() => onOpenTab("pricing")}
          seen={
            pricingCapturedAt
              ? { source: "their pricing page", at: pricingCapturedAt }
              : undefined
          }
          foot={
            entryTier ? (
              <span className="text-muted-foreground">
                {movement.entryPriceChangedAt
                  ? `changed ${formatDistanceToNow(new Date(movement.entryPriceChangedAt), { addSuffix: true })}`
                  : "unchanged since we started watching"}
              </span>
            ) : undefined
          }
        >
          {entryTier ? (
            <Big>{formatTierPrice(entryTier)}</Big>
          ) : pricingModelNote ? (
            <Absent>{pricingModelNote}</Absent>
          ) : (
            <Absent>No public price</Absent>
          )}
        </Metric>

        <Metric
          label="Open roles"
          onClick={() => onOpenTab("hiring")}
          seen={
            hiring.capturedAt ? { source: "their jobs board", at: hiring.capturedAt } : undefined
          }
          foot={
            movement.openRoles30d ? (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    movement.openRoles30d > 0 ? "bg-high" : "bg-positive",
                  )}
                />
                <span className="text-muted-foreground">
                  {movement.openRoles30d > 0 ? "+" : ""}
                  {movement.openRoles30d} in 30 days
                </span>
              </>
            ) : hiring.openRoles > 0 ? (
              <span className="text-muted-foreground">flat over 30 days</span>
            ) : undefined
          }
        >
          {hiring.openRoles > 0 ? <Big>{hiring.openRoles}</Big> : <Absent>None open</Absent>}
        </Metric>

        <Metric
          label={topReview ? `${topReview.source} rating` : "Reviews"}
          onClick={() => onOpenTab("reviews")}
          seen={topReview ? { source: topReview.source, at: topReview.recorded_at } : undefined}
          foot={
            topReview ? (
              movement.reviewScore90d && Math.abs(movement.reviewScore90d) >= 0.1 ? (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      movement.reviewScore90d < 0 ? "bg-critical" : "bg-positive",
                    )}
                  />
                  <span className="text-muted-foreground">
                    {movement.reviewScore90d > 0 ? "+" : ""}
                    {movement.reviewScore90d.toFixed(1)} in 90 days
                  </span>
                </>
              ) : (
                <span className="tabular-nums text-muted-foreground">
                  {topReview.review_count} reviews
                </span>
              )
            ) : (
              // An untracked cell that only says "not tracked" is a dead cell. The
              // tab it opens is where reviews get turned on, so name that (OUT-183).
              <span className="text-link">Add a review source</span>
            )
          }
        >
          {topReview ? (
            <span className="inline-flex items-baseline gap-1">
              <Big>{topReview.score.toFixed(1)}</Big>
              <StarIcon className="size-3.5 translate-y-px fill-current text-muted-foreground" />
            </span>
          ) : (
            <Absent>Not tracked yet</Absent>
          )}
        </Metric>

        <Metric
          label="Signals, 30 days"
          onClick={() => onOpenTab("activity")}
          foot={
            worstBand ? (
              <>
                <span aria-hidden className={cn("size-1.5 rounded-full", worstBand.cls)} />
                <span className="text-muted-foreground">
                  {worstBand.n} {worstBand.label}
                </span>
              </>
            ) : recent.length > 0 ? (
              <span className="text-muted-foreground">all low</span>
            ) : undefined
          }
        >
          {recent.length > 0 ? <Big>{recent.length}</Big> : <Absent>Nothing moved</Absent>}
        </Metric>
      </Card>

      {/* The same accumulated memory the weekly brief narrates, read deep on one
          competitor (OUT-172). It sits directly under the headline strip because
          that strip is where the atomised version of it used to end: "changed 3
          months ago" and "+3 in 30 days" are footnotes to a story nothing told.
          Above the fact sheet, which describes who they are today, not what moved. */}
      {memory && memory.facts.length > 0 && (
        <TabCard>
          <TabSection
            title="What you know now"
            action={
              <span className="shrink-0 text-xs text-muted-foreground">
                {storySummary(memory)}
              </span>
            }
          >
            <MemoryTimeline
              story={memory}
              className="mt-0"
              max={memoryExpanded ? undefined : MEMORY_FACTS_SHOWN}
            />
            {memoryHidden > 0 && (
              <button
                type="button"
                aria-expanded={memoryExpanded}
                onClick={() => setMemoryExpanded((open) => !open)}
                className="self-start rounded-sm text-xs text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {memoryExpanded
                  ? "Show fewer"
                  : `Show ${memoryHidden} earlier change${memoryHidden === 1 ? "" : "s"}`}
              </button>
            )}
            {memoryExpanded && memory.total > memory.facts.length && (
              <p className="m-0 text-xs text-muted-foreground">
                Showing the {memory.facts.length} most recent of {memory.total} changes.
              </p>
            )}
          </TabSection>
        </TabCard>
      )}

      <TabCard>
      {isForeign && (
        <div className="flex items-center gap-2 px-5 py-1.5">
          <Badge variant="outline" className="uppercase">
            {language}
          </Badge>
          {!translated ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-dense"
              onClick={handleTranslate}
              disabled={translating}
            >
              {translating ? (
                <SpinnerIcon size={16} className="animate-spin" />
              ) : (
                <TranslateIcon size={16} />
              )}
              Translate to English
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-dense"
              onClick={() => setShowOriginal((o) => !o)}
            >
              <TranslateIcon size={16} />
              {showOriginal ? "Show English" : "Show original"}
            </Button>
          )}
        </div>
      )}

      {homepage && (dHeadline || dSubheadline) && (
        <TabSection
          title="How they position"
          action={
            <span className="flex shrink-0 items-center gap-3">
              {capturedAt && (
                <span className="text-xs text-muted-foreground">
                  Homepage, captured{" "}
                  {formatDistanceToNow(new Date(capturedAt), { addSuffix: true })}
                </span>
              )}
              {/* This sheet holds the current capture only; the Positioning tab
                  keeps every version before it. Named from the section that owns
                  the words, so the deep read is one click instead of a tab tour
                  (OUT-184) — the same promise the headline metrics already make. */}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-dense"
                onClick={() => onOpenTab("product")}
              >
                See every version
                <CaretRightIcon size={14} aria-hidden />
              </Button>
            </span>
          }
        >
          {/* Attributed and set as quoted material. Rendered bare at 17px in the
              competitor's own casing, a scraped headline read as an Outrival
              section title rather than as something they wrote. */}
          {dHeadline && (
            <p className="text-xl font-semibold leading-snug tracking-tight text-balance">
              {dHeadline}
            </p>
          )}
          {dSubheadline && (
            <p className="text-content text-muted-foreground leading-relaxed max-w-2xl">
              {dSubheadline}
            </p>
          )}
        </TabSection>
      )}

      {/* The hero's calls to action. Their labels have sat in the stored homepage
          structure since patch-16 without ever being read, and they are the shortest
          honest read of a go-to-market motion there is: "Start free" and "Book a
          demo" are the same button in the same place, and they describe two
          different companies.

          Gated on the VERDICT, not on the CTA existing. The parser falls back to the
          first link in the hero when no candidate looks like a button, so a label
          naming no motion is as likely to be a nav item, and "Main button: Login" is
          worse than silence. Verdict first, then their words, so the reader can
          check us against the page. */}
      {motionRead && homepage?.gtm?.primary && (
        <TabSection
          title="How they sell"
          action={
            <span className="shrink-0 text-xs text-muted-foreground">
              read off their homepage
            </span>
          }
        >
          <p className="max-w-[70ch] text-sm leading-relaxed">
            <span className="font-medium">{motionRead.label}.</span>{" "}
            <span className="text-muted-foreground">{motionRead.basis}</span>
          </p>
          <dl className="flex flex-col gap-1">
            <CtaRow label="Their words" cta={homepage.gtm.primary} />
            {homepage.gtm.secondary && (
              <CtaRow label="Also offers" cta={homepage.gtm.secondary} />
            )}
          </dl>
        </TabSection>
      )}

      {/* Their own nav, with the labels every SaaS ships stripped out, so what is
          left is the vocabulary they chose for their own product. Empty for a nav
          that says nothing specific, which is why this renders nothing rather than
          echoing "Product, Pricing, Blog" back at the reader. */}
      {homepage && (homepage.navItems?.length ?? 0) > 0 && (
        <TabSection
          title="What their product covers"
          action={
            <span className="shrink-0 text-xs text-muted-foreground">
              their own navigation
            </span>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {homepage.navItems.map((item) => (
              <span
                key={item}
                className="rounded-sm border border-border px-2 py-0.5 text-dense text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </TabSection>
      )}

      {homepage && (dValueProps.length > 0 || numericClaims.length > 0) && (
        <TabSection title="What they highlight">
          {dValueProps.length > 0 && (
            <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {dValueProps.map((v, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-snug">
                  {/* A bullet is punctuation; it does not spend the accent. */}
                  <span
                    aria-hidden
                    className="mt-2 size-1 shrink-0 rounded-full bg-border-strong"
                  />
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          )}
          {numericClaims.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {numericClaims.map((cl, i) => (
                <span
                  key={i}
                  className="rounded-sm border border-border px-2 py-0.5 text-dense text-muted-foreground"
                >
                  {cl.raw_text}
                </span>
              ))}
            </div>
          )}
        </TabSection>
      )}

      {mobileApps && (
        <TabSection
          title="Mobile apps"
          action={
            <span className="shrink-0 text-xs text-muted-foreground">
              detected on their site
            </span>
          }
        >
          <MobileAppsFact apps={mobileApps} name={competitorName} />
        </TabSection>
      )}

      {homepage && (customerLogos.length > 0 || dTestimonials.length > 0) && (
        <TabSection
          title="Customers and proof"
          action={
            <span className="shrink-0 text-xs text-muted-foreground">
              from the homepage capture
            </span>
          }
        >
          {/* One balanced flow, not two rigid columns. The logo wall is short and the
              quotes are long, so a fixed two-column split stretched the wall to the
              quotes' height and painted the leftover as dead bands between logo rows.
              Balanced columns size themselves to the content: a quote drops under the
              wall only when there is spare height AND a quote to spare — nothing is
              stretched to fill, and nothing is moved just to fill. */}
          <div
            className={cn(
              customerLogos.length > 0 &&
                dTestimonials.length > 0 &&
                "md:columns-2 md:gap-5",
            )}
          >
            {customerLogos.length > 0 && (
              <TooltipProvider delayDuration={150}>
                {/* flex-wrap rather than grid: a partial last row grows to fill itself,
                    so the container's rule colour never shows through as empty cells. */}
                <div className="mb-5 flex break-inside-avoid flex-wrap gap-px overflow-hidden rounded-md border border-border bg-border last:mb-0">
                  {customerLogos.map((l, i) => (
                    <LogoChip key={i} logo={l} />
                  ))}
                </div>
              </TooltipProvider>
            )}
            {dTestimonials.length > 0 && (
              <ul>
                {dTestimonials.map((t, i) => (
                  // The quotation marks are the quotation mark: no rail.
                  <li
                    key={i}
                    className="mb-3 flex break-inside-avoid flex-col gap-1.5 last:mb-0"
                  >
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      &ldquo;{t.quote}&rdquo;
                    </p>
                    {t.author && (
                      <span className="text-xs text-muted-foreground">{t.author}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabSection>
      )}

      </TabCard>

      {/* Tech stack lost its tab: it is reference material, not a lens you flip to
          every visit. It reads in place here, with the platform rows and the evidence
          the sheet used to hold: a stack you have to open a panel to see is a stack
          nobody reads, and the summary that stood in for it repeated the same grouping
          with less in it. It renders nothing at all when neither axis detected
          anything — the "no card" decision lives in the component, next to the two
          reads that decide it. */}
      <CompetitorTechStack techStack={techStack} />

      {/* The duel, read as findings rather than as a two-row table of levels
          (OUT-194): which side each dimension favours, by how much, and the moves
          that follow. Self-hiding when we hold no column for your own product. */}
      <HeadToHeadSections competitorId={competitorId} />
    </div>
  );
}
