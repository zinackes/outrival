"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AiVisibilityTeaser } from "./ai-visibility-teaser";
import type { Icon as PhosphorIcon } from "@/components/icons";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  CheckIcon,
  CaretDownIcon,
  ClockIcon,
  ArrowSquareOutIcon,
  GiftIcon,
  LightbulbIcon,
  ScanIcon,
  StarIcon,
  TagIcon,
  WarningIcon,
} from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import type { LandscapeData, LandscapeInsight, LandscapePricingRow } from "@/lib/api";
import { landscapeQuery } from "@/lib/queries";
import { formatDate } from "@/lib/format-date";
import { competitorNameColor } from "@/lib/competitor-color";
import { Button } from "@/components/ui/button";
import { SectionHead } from "./section-head";
import { EmptyState } from "./empty-state";
import { CompAvatar } from "./comp-avatar";

// Day-0 competitive landscape (docs/post-onboarding-activation.md, Levers 1/3/4).
// Shown on the Overview while the org has competitors but no signal yet: instead
// of a bare wait state, deliver the "state of the world" value the first scrape
// already captured — pricing, hiring, reviews, recent news — plus honest
// transparency about what the monitoring is doing and when it checks next.

const SOURCE_LABELS: Record<string, string> = {
  homepage: "Homepage",
  pricing: "Pricing",
  blog: "Blog",
  changelog: "Changelog",
  jobs: "Jobs",
  g2_reviews: "G2 reviews",
  capterra_reviews: "Capterra reviews",
  appstore_reviews: "App Store reviews",
  shopify_reviews: "Shopify App Store reviews",
  playstore_reviews: "Play Store reviews",
  trustpilot_reviews: "Trustpilot reviews",
  trustradius_reviews: "TrustRadius reviews",
  gartner_reviews: "Gartner reviews",
  github_repo: "GitHub repo",
  status: "Status page",
  linkedin: "LinkedIn",
  twitter: "Twitter",
};

const REVIEW_SOURCE_LABELS: Record<string, string> = {
  g2: "G2",
  capterra: "Capterra",
  appstore: "App Store",
  playstore: "Play Store",
  trustpilot: "Trustpilot",
  trustradius: "TrustRadius",
  gartner: "Gartner",
};

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

function fmtPrice(row: LandscapePricingRow): string {
  if (row.price == null) return "—";
  const rounded = Number.isInteger(row.price) ? String(row.price) : row.price.toFixed(2);
  const sym = row.currency ? CURRENCY_SYMBOLS[row.currency.toUpperCase()] : "$";
  const base = sym ? `${sym}${rounded}` : `${rounded} ${row.currency}`;
  const period =
    row.billingPeriod === "monthly" ? "/mo" : row.billingPeriod === "yearly" ? "/yr" : "";
  return `${base}${period}`;
}

// Compresses a company's captured plans to one line: the entry price and an
// honest range, so the day-0 baseline reads at a glance instead of dumping every
// plan. `primary` is null when nothing priceable was captured yet (→ pending).
function summarizePricing(rows: LandscapePricingRow[]): {
  primary: string | null;
  secondary: string;
} {
  const priced = [...rows]
    .filter((r) => r.price != null)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  if (priced.length === 0) {
    return {
      primary: null,
      secondary:
        rows.length > 0
          ? `${rows.length} plan${rows.length > 1 ? "s" : ""} · custom pricing`
          : "pricing scan pending",
    };
  }
  const entry = priced[0]!;
  const top = priced[priced.length - 1]!;
  const hasFree = entry.price === 0;
  let secondary: string;
  if (hasFree && top.price != null && top.price > 0) {
    secondary = `free tier · up to ${fmtPrice(top)}`;
  } else if (hasFree) {
    secondary = "free tier";
  } else if (top.price !== entry.price) {
    secondary = `up to ${fmtPrice(top)}`;
  } else {
    secondary = `${rows.length} plan${rows.length > 1 ? "s" : ""}`;
  }
  return { primary: `from ${fmtPrice(entry)}`, secondary };
}

// One compact price line in the compressed pricing module: mono entry price on
// top, an honest range/state label below (or a "pending" clock when unpriced).
function PriceCell({
  summary,
}: {
  summary: { primary: string | null; secondary: string };
}) {
  return (
    <span className="ml-auto text-right">
      {summary.primary ? (
        <>
          <span className="block text-dense font-semibold tabular-nums">
            {summary.primary}
          </span>
          <span className="block text-meta text-muted-foreground">
            {summary.secondary}
          </span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
          <ClockIcon size={14} aria-hidden /> {summary.secondary}
        </span>
      )}
    </span>
  );
}

function WaitEmptyState({ competitorCount }: { competitorCount: number }) {
  return (
    <EmptyState
      icon={ScanIcon}
      title={`Outrival is watching ${competitorCount} competitor${competitorCount > 1 ? "s" : ""}`}
      description="Scans run continuously. Your first signals (pricing, hiring, product and content moves) land here the moment something changes."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/competitors">
            Review competitors <ArrowRightIcon size={16} />
          </Link>
        </Button>
      }
    />
  );
}

// Day-0 "Did you know?" quick wins (Lever 3) — the aha the API already computes
// in computeLandscapeInsights but the page never surfaced. Deterministic, no AI:
// the sharpest pricing/hiring/review gaps between the user and each competitor.
const INSIGHT_ICON: Record<LandscapeInsight["kind"], PhosphorIcon> = {
  pricing_gap: TagIcon,
  trial: GiftIcon,
  hiring: BriefcaseIcon,
  reviews: StarIcon,
};

function InsightCards({
  insights,
  nameById,
}: {
  insights: LandscapeInsight[];
  nameById: Map<string, LandscapeData["competitors"][number]>;
}) {
  if (insights.length === 0) return null;
  return (
    <section>
      <SectionHead
        title="What we already found"
        sub="the sharpest gaps between you and your competitors"
        icon={<LightbulbIcon size={16} />}
        divider={false}
      />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {insights.map((ins) => {
          const Icon = INSIGHT_ICON[ins.kind];
          const comp = ins.competitorId ? nameById.get(ins.competitorId) : null;
          const body = (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-accent/40 text-primary">
                <Icon size={16} aria-hidden />
              </span>
              <span className="text-sm leading-snug">{ins.text}</span>
            </>
          );
          return comp ? (
            <Link
              key={ins.kind}
              href={`/dashboard/competitors/${comp.id}`}
              className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3.5 transition-colors hover:bg-accent/50"
            >
              {body}
            </Link>
          ) : (
            <div
              key={ins.kind}
              className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3.5"
            >
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Transparent waiting (Lever 4), demoted to a collapsible strip: the healthy
// source lights are reassurance, not intelligence, so they stay folded. Only a
// source we can't reach (markedUnscrapable) surfaces inline, always — that's the
// one coverage fact worth seeing at a glance.
function SourcesCoverage({
  competitors,
  sourcesByComp,
  nextCheckAt,
}: {
  competitors: LandscapeData["competitors"];
  sourcesByComp: Map<string, LandscapeData["sources"]>;
  nextCheckAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const total = [...sourcesByComp.values()].reduce((n, s) => n + s.length, 0);
  const failed = competitors.flatMap((c) =>
    (sourcesByComp.get(c.id) ?? [])
      .filter((s) => s.status === "unavailable")
      .map((s) => ({ competitor: c, sourceType: s.sourceType })),
  );
  if (total === 0) return null;

  return (
    <section className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <CaretDownIcon
          size={16}
          aria-hidden
          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
        <span className="text-dense font-medium">
          Watching <span className="tabular-nums">{total}</span> source
          {total > 1 ? "s" : ""} across{" "}
          <span className="tabular-nums">{competitors.length}</span>{" "}
          competitor{competitors.length > 1 ? "s" : ""}
        </span>
        {nextCheckAt && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            Next scan{" "}
            <span className="text-muted-foreground">
              {formatDistanceToNow(new Date(nextCheckAt), { addSuffix: true })}
            </span>
          </span>
        )}
      </button>

      {failed.length > 0 && (
        <div className="border-t border-border">
          {failed.map(({ competitor, sourceType }) => (
            <div
              key={`${competitor.id}-${sourceType}`}
              className="flex items-center gap-2 border-b border-border px-4 py-2 text-dense last:border-b-0"
            >
              <WarningIcon
                size={16}
                className="shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span
                className="font-medium"
                style={competitorNameColor(competitor.color)}
              >
                {competitor.name}
              </span>
              <span className="text-muted-foreground">
                · {SOURCE_LABELS[sourceType] ?? sourceType.replace(/_/g, " ")}:
                couldn&apos;t reach it
              </span>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="border-t border-border">
          {competitors.map((c) => {
            const srcs = sourcesByComp.get(c.id) ?? [];
            if (srcs.length === 0) return null;
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <Link
                  href={`/dashboard/competitors/${c.id}`}
                  className="flex w-40 shrink-0 items-center gap-2 truncate text-dense font-medium underline-offset-2 hover:underline"
                  style={competitorNameColor(c.color)}
                >
                  <CompAvatar name={c.name} url={c.url} />
                  {c.name}
                </Link>
                <div className="flex flex-wrap items-center gap-1.5">
                  {srcs.map((s) => (
                    <span
                      key={s.sourceType}
                      className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground"
                    >
                      {s.status === "captured" ? (
                        <CheckIcon size={14} className="text-primary" aria-hidden />
                      ) : s.status === "pending" ? (
                        <ClockIcon size={14} aria-hidden />
                      ) : (
                        <WarningIcon size={14} aria-hidden />
                      )}
                      {SOURCE_LABELS[s.sourceType] ?? s.sourceType.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            A signal appears when something actually changes on one of these
            sources. We can&apos;t predict when a competitor moves, only that
            we&apos;ll catch it.
          </p>
        </div>
      )}
    </section>
  );
}

export function LandscapeSection({
  productId,
  competitorCount,
}: {
  productId?: string;
  competitorCount: number;
}) {
  // First scrapes complete within minutes of onboarding — poll so pricing,
  // hiring and the source lights fill in live while the user watches.
  const q = useQuery({ ...landscapeQuery(productId), refetchInterval: 30_000 });
  const data = q.data ?? null;

  if (q.isError) return <WaitEmptyState competitorCount={competitorCount} />;
  if (!data) {
    return (
      <div className="rounded-md border border-border px-4 py-10 text-sm text-muted-foreground">
        Assembling your competitive landscape…
      </div>
    );
  }

  const self = data.self;
  const nameById = new Map(data.competitors.map((c) => [c.id, c]));
  const pricingByComp = new Map<string, LandscapePricingRow[]>();
  for (const row of data.pricing) {
    const list = pricingByComp.get(row.competitorId) ?? [];
    list.push(row);
    pricingByComp.set(row.competitorId, list);
  }
  const hasPricing = data.pricing.length > 0 || data.selfPricing.length > 0;
  const sourcesByComp = new Map<string, LandscapeData["sources"]>();
  for (const s of data.sources) {
    const list = sourcesByComp.get(s.competitorId) ?? [];
    list.push(s);
    sourcesByComp.set(s.competitorId, list);
  }
  const hasAnyContent =
    data.insights.length > 0 ||
    hasPricing ||
    data.hiring.length > 0 ||
    data.reviews.length > 0 ||
    data.recentActivity.length > 0;

  const hasBaseline =
    hasPricing || data.hiring.length > 0 || data.reviews.length > 0;

  return (
    <>
      {/* Quick-win "Did you know?" cards (Lever 3) — the aha, first. */}
      <InsightCards insights={data.insights} nameById={nameById} />

      {/* AI Visibility teaser (Lever 7): the day-0 "wow" — do you show up in AI answer
          engines vs your competitors? Self-hides until its worker result lands. */}
      <AiVisibilityTeaser />

      {/* Where you stand today — the compact baseline the first scan captured:
          pricing compressed to one line per company, hiring + reviews beside it. */}
      {hasBaseline && (
        <section>
          <SectionHead
            title="Where you stand today"
            sub="pricing, hiring and reviews across your competitors"
            divider={false}
          />

          {hasPricing && (
            <div className="mt-3 overflow-hidden rounded-md border border-border bg-card">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <h3 className="text-sm font-semibold tracking-tight">Pricing</h3>
                <Link
                  href="/dashboard/compare"
                  className="inline-flex items-center gap-1 text-xs text-link underline-offset-2 hover:underline"
                >
                  Compare pricing <ArrowRightIcon size={14} />
                </Link>
              </div>
              <div>
                {self && (
                  <div className="flex items-center gap-3 border-b border-border bg-accent/30 px-4 py-2.5 last:border-b-0">
                    <CompAvatar name={self.name} url={self.url} />
                    <span className="flex items-center gap-2 text-dense font-medium">
                      {self.name}
                      <span className="rounded-full border border-border px-1.5 py-px text-meta text-muted-foreground">
                        You
                      </span>
                    </span>
                    <PriceCell summary={summarizePricing(data.selfPricing)} />
                  </div>
                )}
                {data.competitors.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                  >
                    <CompAvatar name={c.name} url={c.url} />
                    <Link
                      href={`/dashboard/competitors/${c.id}`}
                      className="text-dense font-medium underline-offset-2 hover:underline"
                      style={competitorNameColor(c.color)}
                    >
                      {c.name}
                    </Link>
                    <PriceCell
                      summary={summarizePricing(pricingByComp.get(c.id) ?? [])}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(data.hiring.length > 0 || data.reviews.length > 0) && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.hiring.length > 0 && (
                <div className="rounded-md border border-border bg-card">
                  <h3 className="px-4 pt-3.5 text-sm font-semibold tracking-tight">
                    Hiring right now
                  </h3>
                  <ul className="mt-1 pb-2">
                    {data.hiring.slice(0, 5).map((h) => {
                      const comp = nameById.get(h.competitorId);
                      if (!comp) return null;
                      return (
                        <li
                          key={h.competitorId}
                          className="flex items-baseline justify-between gap-3 px-4 py-2 text-dense"
                        >
                          <span
                            className="font-medium truncate"
                            style={competitorNameColor(comp.color)}
                          >
                            {comp.name}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            <span className="tabular-nums text-foreground">
                              {h.total}
                            </span>{" "}
                            open role{h.total > 1 ? "s" : ""}
                            {h.departments[0]
                              ? ` · mostly ${h.departments[0].department}`
                              : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {data.reviews.length > 0 && (
                <div className="rounded-md border border-border bg-card">
                  <h3 className="px-4 pt-3.5 text-sm font-semibold tracking-tight">
                    Review scores
                  </h3>
                  <ul className="mt-1 pb-2">
                    {data.reviews.slice(0, 5).map((r) => {
                      const comp = nameById.get(r.competitorId);
                      if (!comp) return null;
                      return (
                        <li
                          key={`${r.competitorId}-${r.source}`}
                          className="flex items-baseline justify-between gap-3 px-4 py-2 text-dense"
                        >
                          <span
                            className="font-medium truncate"
                            style={competitorNameColor(comp.color)}
                          >
                            {comp.name}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {REVIEW_SOURCE_LABELS[r.source] ?? r.source}{" "}
                            <span className="tabular-nums text-foreground">
                              {r.score}/5
                            </span>{" "}
                            ({r.reviewCount})
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Recent activity — dated events the first news scrape already carries. */}
      {data.recentActivity.length > 0 && (
        <section>
          <SectionHead
            title="Recent activity"
            sub="from news coverage of your competitors"
            divider={false}
          />
          <div className="mt-3 rounded-md border border-border">
            {data.recentActivity.slice(0, 6).map((item) => {
              const comp = nameById.get(item.competitorId);
              return (
                <div
                  key={`${item.competitorId}-${item.title}`}
                  className="flex items-baseline gap-3 px-4 py-2.5 border-b border-border last:border-b-0"
                >
                  <span className="w-14 shrink-0 text-meta text-muted-foreground tabular-nums">
                    {item.publishedAt
                      ? formatDate(new Date(item.publishedAt), { month: "short", day: "numeric" })
                      : "—"}
                  </span>
                  <span
                    className="shrink-0 text-dense font-medium"
                    style={competitorNameColor(comp?.color ?? null)}
                  >
                    {item.competitorName}
                  </span>
                  {item.link ? (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group min-w-0 text-dense truncate hover:underline underline-offset-2"
                    >
                      {item.title}
                      <ArrowSquareOutIcon
                        size={16}
                        className="ml-1 inline shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </a>
                  ) : (
                    <span className="min-w-0 text-dense truncate">{item.title}</span>
                  )}
                  {item.source && (
                    <span className="ml-auto shrink-0 text-meta text-muted-foreground max-sm:hidden">
                      {item.source}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Transparent waiting (Lever 4) — demoted to a collapsible coverage strip;
          only unreachable sources surface inline, the healthy lights stay folded. */}
      <SourcesCoverage
        competitors={data.competitors}
        sourcesByComp={sourcesByComp}
        nextCheckAt={data.nextCheckAt}
      />

      {!hasAnyContent && data.sources.length === 0 && (
        <WaitEmptyState competitorCount={competitorCount} />
      )}
    </>
  );
}
