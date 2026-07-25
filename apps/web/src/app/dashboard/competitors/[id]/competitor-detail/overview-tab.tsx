"use client";

import { Fragment, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { classifyLogoName, type AnalysisStatus } from "@outrival/shared";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { myProductQuery } from "@/lib/queries";
import {
  ChevronRight,
  LayoutGrid,
  Star,
  Loader2,
  Play,
  Languages,
} from "lucide-react";
import {
  api,
  type CompetitorSignal,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CompetitorTechStack } from "@/components/outrival/competitor-tech-stack";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { formatTierPrice, logoLabel, isRenderableLogoSrc } from "./helpers";
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
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1.5 border-border p-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&:not(:nth-child(2n+1))]:border-l sm:border-l sm:first:border-l-0"
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <ChevronRight size={11} className="opacity-60" aria-hidden />
      </span>
      <span className="block">{children}</span>
      {foot && <span className="flex min-h-4 items-center gap-1.5 text-xs">{foot}</span>}
    </button>
  );
}

/** A number that carries the reading, in the data voice. */
function Big({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums">
      {children}
    </span>
  );
}

/** An absence. Never a bare "Not captured", which reads as a scrape failure. */
function Absent({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>;
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
    <div className="flex h-14 items-center justify-center bg-card px-3">
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

export function OverviewTab({
  competitorId,
  competitorName,
  overview,
  signals,
  monitors,
  scrapingIds,
  analysis,
  pricingStatus,
  pricingNote,
  onRun,
  onOpenTab,
  techStack,
}: {
  competitorId: string;
  overview: CompetitorOverview;
  /** Already loaded by the page; the 30-day count costs no extra query. */
  signals: CompetitorSignal[];
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
  const { homepage, numericClaims, pricingNow, reviews, hiring, capturedAt, movement } = overview;

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
  const hasFacts =
    !!homepage &&
    !!(
      homepage.headline ||
      homepage.subheadline ||
      homepage.valueProps.length > 0 ||
      homepage.customerLogos.length > 0 ||
      homepage.testimonials.length > 0
    );
  const hasAnything =
    hasFacts ||
    numericClaims.length > 0 ||
    pricingNow.length > 0 ||
    reviews.length > 0 ||
    hiring.openRoles > 0;

  if (!hasAnything) {
    const homepageMonitor = monitors.find((m) => m.sourceType === "homepage");
    const running = homepageMonitor ? scrapingIds.has(homepageMonitor.id) : false;
    // The first analysis is still running (queued → scraping → summarizing). The
    // top-of-page stepper carries the live stage; here we just avoid a misleading
    // "Nothing captured yet" + manual-scrape button while it's already working.
    if (analysis?.pending || running) {
      return (
        <EmptyState
          icon={LayoutGrid}
          title="Analyzing this competitor…"
          description="We're scanning the homepage and generating the first insights. This tab fills in automatically once it's done, no need to refresh."
        />
      );
    }
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Nothing captured yet"
        description="Once the homepage is scraped, this is where you'll see what this competitor says about itself (positioning, value props, customers and pricing) at a glance."
        actions={
          homepageMonitor && (
            <Button size="sm" disabled={running} onClick={() => onRun(homepageMonitor.id)}>
              {running ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Scraping…
                </>
              ) : (
                <>
                  <Play size={12} /> Scrape homepage now
                </>
              )}
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
                <span className="font-mono tabular-nums text-muted-foreground">
                  {topReview.review_count} reviews
                </span>
              )
            ) : undefined
          }
        >
          {topReview ? (
            <span className="inline-flex items-baseline gap-1">
              <Big>{topReview.score.toFixed(1)}</Big>
              <Star className="size-3.5 translate-y-px fill-current text-muted-foreground" />
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
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Languages size={12} />
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
              <Languages size={12} />
              {showOriginal ? "Show English" : "Show original"}
            </Button>
          )}
        </div>
      )}

      {homepage && (dHeadline || dSubheadline) && (
        <TabSection
          title="How they position"
          action={
            capturedAt && (
              <span className="shrink-0 text-xs text-muted-foreground">
                Homepage, captured{" "}
                {formatDistanceToNow(new Date(capturedAt), { addSuffix: true })}
              </span>
            )
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

      {homepage && (customerLogos.length > 0 || dTestimonials.length > 0) && (
        <TabSection
          title="Customers and proof"
          action={
            <span className="shrink-0 text-xs text-muted-foreground">
              from the homepage capture
            </span>
          }
        >
          <div
            className={cn(
              "grid gap-5",
              customerLogos.length > 0 && dTestimonials.length > 0
                ? "md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
                : "grid-cols-1",
            )}
          >
            {customerLogos.length > 0 && (
              <TooltipProvider delayDuration={150}>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-px overflow-hidden rounded-md border border-border bg-border">
                  {customerLogos.map((l, i) => (
                    <LogoChip key={i} logo={l} />
                  ))}
                </div>
              </TooltipProvider>
            )}
            {dTestimonials.length > 0 && (
              <ul className="flex flex-col gap-3">
                {dTestimonials.map((t, i) => (
                  // The quotation marks are the quotation mark: no rail.
                  <li key={i} className="flex flex-col gap-1.5">
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

      <TechStackCard techStack={techStack} />

      <HeadToHead competitorName={competitorName} overview={overview} />
    </div>
  );
}

// Tech stack lost its tab: it is reference material, not a lens you flip to every
// visit. The headline tells you the commercially interesting part (who they pay for
// payments, CRM, analytics) and the full catalogue opens in a sheet on demand.
function TechStackCard({ techStack }: { techStack: TechStackData }) {
  const [open, setOpen] = useState(false);
  const entries = techStack.entries;
  if (entries.length === 0 && !techStack.platformProfile) return null;

  // Grouped by what each tool DOES. Four chips and a "+8 more" drawer told you the
  // count and nothing else; a competitor's stack is read by category ("who do they
  // pay for payments, for support") and that grouping is already on every entry.
  const byCategory = new Map<string, typeof entries>();
  for (const t of [...entries].sort(
    (a, b) => IMPORTANCE_RANK.indexOf(a.importance) - IMPORTANCE_RANK.indexOf(b.importance),
  )) {
    const bucket = byCategory.get(t.category);
    if (bucket) bucket.push(t);
    else byCategory.set(t.category, [t]);
  }
  // Categories holding a commercially telling tool first.
  const groups = [...byCategory.entries()].sort(
    (a, b) =>
      IMPORTANCE_RANK.indexOf(a[1][0]!.importance) - IMPORTANCE_RANK.indexOf(b[1][0]!.importance),
  );

  return (
    <>
      <TabCard>
      <TabSection
        title="Tech stack"
        action={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 text-xs text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {entries.length > 0 ? `${entries.length} detected, see evidence` : "Platform detected"}
          </button>
        }
      >
        {groups.length > 0 && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
            {groups.map(([category, techs]) => (
              <Fragment key={category}>
                <dt className="text-xs capitalize text-muted-foreground">
                  {category.replace(/[_-]/g, " ")}
                </dt>
                <dd className="m-0 flex flex-wrap gap-1.5">
                  {techs.map((t) => (
                    <span
                      key={t.techId}
                      className={cn(
                        "rounded-sm border px-2 py-0.5 text-dense",
                        // A payments or CRM tell says more about how they sell than
                        // the CDN in front of the marketing site: weight, not a
                        // second coloured container.
                        t.importance === "high"
                          ? "border-border-strong text-foreground"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {t.name}
                    </span>
                  ))}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </TabSection>
      </TabCard>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Tech stack</SheetTitle>
            <SheetDescription>
              Third-party technology detected on this competitor&apos;s site, scanned monthly.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <CompetitorTechStack techStack={techStack} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

const IMPORTANCE_RANK = ["high", "medium", "low"];

/** Cheapest tier carrying a real figure. Quote-based tiers have none. */
function entryPriceOf(tiers: Array<{ price: number | null; currency: string; billing_period: string; plan_name: string }>) {
  return tiers.filter((t) => t.price != null && t.price > 0).sort((a, b) => a.price! - b.price!)[0];
}

/**
 * The competitor against your own product.
 *
 * The page compared them to nothing, which for a competitive intelligence tool is
 * the omission that matters most. Only measures we hold on BOTH sides are listed:
 * a self-competitor never gets a reviews monitor (patch-12), so there is no "our
 * rating" to line up against theirs and no such row is invented. A missing side
 * says so rather than borrowing the other one's number.
 */
function HeadToHead({
  competitorName,
  overview,
}: {
  competitorName: string;
  overview: CompetitorOverview;
}) {
  const productScope = useProductScope() ?? undefined;
  const myProductQ = useQuery({ ...myProductQuery(productScope), retry: false });
  const mine = myProductQ.data ?? null;

  // Without our own product captured there is nothing to compare against, and a
  // one-sided table is worse than no table.
  if (!mine) return null;

  const ourEntry = entryPriceOf(mine.pricing.tiers);
  const theirEntry = entryPriceOf(overview.pricingNow);
  const rows: Array<{ label: string; ours: string | null; theirs: string | null }> = [
    {
      label: "Entry price",
      ours: ourEntry ? formatTierPrice(ourEntry) : null,
      theirs: theirEntry ? formatTierPrice(theirEntry) : null,
    },
    {
      label: "Open roles",
      ours: mine.jobs.total > 0 ? String(mine.jobs.total) : null,
      theirs: overview.hiring.openRoles > 0 ? String(overview.hiring.openRoles) : null,
    },
  ];
  // A row where neither side has a figure teaches nothing.
  const usable = rows.filter((r) => r.ours !== null || r.theirs !== null);
  if (usable.length === 0) return null;

  return (
    <TabCard>
    <TabSection title="Against your product" action={
      <span className="shrink-0 truncate text-xs text-muted-foreground">{mine.name}</span>
    }>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="pb-1.5 text-left font-normal">Measure</th>
              <th className="pb-1.5 text-right font-normal">
                <span className="block truncate">{mine.name}</span>
              </th>
              <th className="pb-1.5 text-right font-normal">
                <span className="block truncate">{competitorName}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {usable.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <td className="py-2 text-muted-foreground">{r.label}</td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {r.ours ?? <span className="font-sans text-dense text-muted-foreground">not tracked</span>}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-foreground">
                  {r.theirs ?? <span className="font-sans text-dense text-muted-foreground">not tracked</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TabSection>
    </TabCard>
  );
}
