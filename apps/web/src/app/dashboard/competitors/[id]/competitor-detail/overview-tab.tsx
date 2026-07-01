"use client";

import { useEffect, useState } from "react";
import { classifyLogoName, type AnalysisStatus } from "@outrival/shared";
import { toast } from "sonner";
import {
  Activity,
  ChevronRight,
  FileText,
  Users,
  LayoutGrid,
  DollarSign,
  Briefcase,
  Star,
  Loader2,
  Play,
  Languages,
} from "lucide-react";
import { api, type CompetitorOverview, type Monitor, type PricingStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Eyebrow } from "@/components/outrival/eyebrow";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { formatTierPrice, logoLabel, isRenderableLogoSrc } from "./helpers";
import type { TabKey } from "./types";

function OverviewStat({
  icon: Icon,
  label,
  onClick,
  children,
}: {
  icon: typeof Activity;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <Icon size={11} /> {label} <ChevronRight size={11} />
      </button>
      <div>{children}</div>
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

  const showImage = !!src && isRenderableLogoSrc(src) && !failed && !blocky;
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

export function OverviewTab({
  competitorId,
  overview,
  monitors,
  scrapingIds,
  analysis,
  pricingStatus,
  pricingNote,
  onRun,
  onOpenTab,
}: {
  competitorId: string;
  overview: CompetitorOverview;
  monitors: Monitor[];
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
}) {
  const { homepage, numericClaims, pricingNow, reviews, hiring } = overview;

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
          description="We're scanning the homepage and generating the first insights. This tab fills in automatically once it's done — no need to refresh."
        />
      );
    }
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Nothing captured yet"
        description="Once the homepage is scraped, this is where you'll see what this competitor says about itself — positioning, value props, customers and pricing — at a glance."
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
        <TabSection>
          {dHeadline && (
            <p className="text-lead font-semibold leading-snug tracking-tight text-balance">
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

      {homepage && dValueProps.length > 0 && (
        <TabSection title="What they highlight" icon={FileText}>
          <ul className="flex flex-col gap-2">
            {dValueProps.map((v, i) => (
              <li key={i} className="text-content leading-relaxed flex gap-2.5">
                <span className="text-primary shrink-0 mt-px">•</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </TabSection>
      )}

      {homepage && (customerLogos.length > 0 || dTestimonials.length > 0) && (
        <TabSection title="Customers & proof" icon={Users}>
          {customerLogos.length > 0 && (
            <TooltipProvider delayDuration={150}>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(124px,1fr))] gap-px overflow-hidden rounded-lg border border-border bg-card">
                {customerLogos.map((l, i) => (
                  <LogoChip key={i} logo={l} />
                ))}
              </div>
            </TooltipProvider>
          )}
          {dTestimonials.length > 0 && (
            <ul className="flex flex-col gap-3 mt-1">
              {dTestimonials.map((t, i) => (
                <li key={i} className="border-l border-border pl-3.5">
                  <p className="text-content italic leading-relaxed">“{t.quote}”</p>
                  {t.author && (
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                      — {t.author}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabSection>
      )}

      {numericClaims.length > 0 && (
        <TabSection title="Claims" icon={Activity}>
          <div className="flex flex-wrap gap-1.5">
            {numericClaims.map((cl, i) => (
              <Badge key={i} variant="secondary" className="text-xs font-normal">
                {cl.raw_text}
              </Badge>
            ))}
          </div>
        </TabSection>
      )}

      <TabSection title="At a glance" icon={LayoutGrid}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
        <OverviewStat icon={DollarSign} label="Pricing now" onClick={() => onOpenTab("pricing")}>
          {pricingNow.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {pricingNow.slice(0, 4).map((p, i) => (
                <li
                  key={i}
                  className="text-dense flex items-baseline justify-between gap-2"
                >
                  <span className="truncate">{p.plan_name}</span>
                  <span className="font-mono tabular-nums shrink-0">{formatTierPrice(p)}</span>
                </li>
              ))}
            </ul>
          ) : pricingModelNote ? (
            <span className="text-dense text-muted-foreground">{pricingModelNote}</span>
          ) : (
            <span className="text-dense text-muted-foreground">Not captured</span>
          )}
        </OverviewStat>

        <OverviewStat icon={Briefcase} label="Open roles" onClick={() => onOpenTab("hiring")}>
          {hiring.openRoles > 0 ? (
            <span className="text-title-lg font-bold font-mono tabular-nums leading-none">
              {hiring.openRoles}
            </span>
          ) : (
            <span className="text-dense text-muted-foreground">None tracked</span>
          )}
        </OverviewStat>

        <OverviewStat icon={Star} label="Reviews" onClick={() => onOpenTab("reviews")}>
          {reviews.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {reviews.slice(0, 2).map((r, i) => (
                <div
                  key={i}
                  className="text-dense flex items-baseline justify-between gap-2"
                >
                  <Eyebrow size="micro">{r.source}</Eyebrow>
                  <span className="inline-flex items-center gap-0.5 font-mono tabular-nums">
                    {r.score.toFixed(1)}
                    <Star className="size-3 fill-current" />
                    <span className="text-muted-foreground">({r.review_count})</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-dense text-muted-foreground">Not captured</span>
          )}
        </OverviewStat>
      </div>

      </TabSection>
    </TabCard>
  );
}
