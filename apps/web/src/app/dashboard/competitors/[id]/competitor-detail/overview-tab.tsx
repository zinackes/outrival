"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
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
import { api, type CompetitorOverview, type Monitor } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  const src = logo.src?.trim() || "";
  // Name to label/alt the logo: the brand name when captured, else derived from
  // the image filename so a path-only logo still reads as something.
  const name = logo.name?.trim() || (src ? logoLabel(src) : "");
  const showImage = !!src && isRenderableLogoSrc(src) && !failed;
  if (!showImage && !name) return null;

  // Logos are scraped artwork only — we don't know each customer's real URL, so
  // the chip is non-interactive (no tooltip, no link) to avoid surfacing wrong info.
  return showImage ? (
    // Fixed white plate: customer logos are dark artwork made for light site
    // backgrounds and would vanish on the (dark) dashboard surface otherwise.
    <span className="inline-flex h-7 items-center rounded-md border border-border bg-white px-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external logo URL, next/image can't whitelist competitor domains */}
      <img
        src={src}
        alt={name || "Customer logo"}
        width={96}
        height={16}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-4 max-w-[96px] object-contain"
      />
    </span>
  ) : (
    <Badge variant="outline" className="text-xs font-normal">
      {name}
    </Badge>
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
  onRun,
  onOpenTab,
}: {
  competitorId: string;
  overview: CompetitorOverview;
  monitors: Monitor[];
  scrapingIds: Set<string>;
  onRun: (id: string) => void;
  onOpenTab: (tab: TabKey) => void;
}) {
  const { homepage, numericClaims, pricingNow, reviews, hiring, capturedAt } = overview;

  // The fact sheet is scraped verbatim, so a foreign competitor's copy shows in its
  // own language. Offer a one-click English translation (Azure MT, on demand) and
  // let the user flip back to the original.
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
    return (
      <Card className="px-6 py-10 text-center border-dashed flex flex-col items-center gap-3">
        <p className="text-sm font-semibold text-foreground">Nothing captured yet</p>
        <p className="text-sm text-muted-foreground max-w-md">
          Once the homepage is scraped, this is where you&apos;ll see what this
          competitor says about itself — positioning, value props, customers and
          pricing — at a glance.
        </p>
        {homepageMonitor && (
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
        )}
      </Card>
    );
  }

  return (
    <TabCard>
      {isForeign && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase">
            {language}
          </Badge>
          {!translated ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5"
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
              className="h-7 gap-1.5"
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

      {homepage && (homepage.customerLogos.length > 0 || dTestimonials.length > 0) && (
        <TabSection title="Customers & proof" icon={Users}>
          {homepage.customerLogos.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {homepage.customerLogos.map((l, i) => (
                <LogoChip key={i} logo={l} />
              ))}
            </div>
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

      {capturedAt && (
        <p className="text-xs font-mono text-muted-foreground">
          homepage facts captured {formatDistanceToNow(new Date(capturedAt), { addSuffix: true })}
        </p>
      )}
      </TabSection>
    </TabCard>
  );
}
