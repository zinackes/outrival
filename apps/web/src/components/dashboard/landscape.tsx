"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  Radar,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { LandscapeData, LandscapeInsight, LandscapePricingRow } from "@/lib/api";
import { landscapeQuery } from "@/lib/queries";
import { formatDate } from "@/lib/format-date";
import { track } from "@/lib/posthog/events";
import { ONBOARDING_EVENTS, trackOnboarding } from "@/lib/posthog/onboarding-events";
import { competitorNameColor } from "@/lib/competitor-color";
import { Button } from "@/components/ui/button";
import { SectionHead } from "./section-head";
import { EmptyState } from "./empty-state";
import { SeverityBadge } from "./severity-pill";
import { CatPill } from "./cat-pill";
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
  playstore_reviews: "Play Store reviews",
  trustpilot_reviews: "Trustpilot reviews",
  trustradius_reviews: "TrustRadius reviews",
  gartner_reviews: "Gartner reviews",
  reddit: "Reddit",
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

// Table header cell — same style as the Overview / Competitors tables.
const TH =
  "text-left px-3.5 py-2.5 text-xs text-muted-foreground font-medium border-b border-border whitespace-nowrap";

// The investment step (Hooked model): one tap of feedback on a quick-win card.
// PostHog-only in v1 — landscape insights aren't signals, so the signal-scoped
// quality_feedback loop doesn't apply here.
function InsightFeedback({ insight }: { insight: LandscapeInsight }) {
  const [given, setGiven] = useState(false);
  if (given) {
    return <span className="text-meta text-muted-foreground">Thanks — noted.</span>;
  }
  const send = (useful: boolean) => {
    track("landscape_insight_feedback", { kind: insight.kind, useful });
    setGiven(true);
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-meta text-muted-foreground">Useful?</span>
      <button
        type="button"
        aria-label="Mark insight as useful"
        onClick={() => send(true)}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <ThumbsUp size={13} />
      </button>
      <button
        type="button"
        aria-label="Mark insight as not useful"
        onClick={() => send(false)}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <ThumbsDown size={13} />
      </button>
    </div>
  );
}

function WaitEmptyState({ competitorCount }: { competitorCount: number }) {
  return (
    <EmptyState
      icon={Radar}
      title={`Outrival is watching ${competitorCount} competitor${competitorCount > 1 ? "s" : ""}`}
      description="Scans run continuously. Your first signals — pricing, hiring, product and content moves — land here the moment something changes."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/competitors">
            Review competitors <ArrowRight size={11} />
          </Link>
        </Button>
      }
    />
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

  // Aha milestone (Lever 3): the first time this browser sees at least one
  // quick-win insight. Once ever — repeat visits don't re-fire the funnel event.
  const trackedRef = useRef(false);
  useEffect(() => {
    if (trackedRef.current || !data || data.insights.length === 0) return;
    trackedRef.current = true;
    try {
      if (localStorage.getItem("onboardingFirstInsightViewed") === "1") return;
      localStorage.setItem("onboardingFirstInsightViewed", "1");
    } catch {
      /* still track below */
    }
    trackOnboarding(ONBOARDING_EVENTS.FIRST_INSIGHT_VIEWED, null, {
      insights: data.insights.length,
    });
  }, [data]);

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

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Your first signals land when something changes. Meanwhile, here&apos;s where you
        stand today — from the first scan of your competitors.
      </p>

      {/* Quick wins — the aha moment, deterministic "did you know" cards. */}
      {data.insights.length > 0 && (
        <section>
          <SectionHead
            title="What we already know"
            sub="from the first scan — before any change happened"
            divider={false}
          />
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.insights.map((insight) => (
              <div
                key={insight.kind}
                className="flex flex-col justify-between gap-3 rounded-md border border-border bg-card p-4"
              >
                <p className="text-content leading-snug">{insight.text}</p>
                <div className="flex items-center justify-between gap-2">
                  {insight.competitorId ? (
                    <Link
                      href={`/dashboard/competitors/${insight.competitorId}`}
                      className="text-dense text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
                    >
                      View competitor
                    </Link>
                  ) : (
                    <span />
                  )}
                  <InsightFeedback insight={insight} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pricing side-by-side — the user's own plans first, then each competitor. */}
      {hasPricing && (
        <section>
          <SectionHead title="Pricing today" sub="latest captured prices" divider={false} />
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-dense min-w-[560px]">
              <thead>
                <tr>
                  <th className={TH}>Company</th>
                  <th className={TH}>Plan</th>
                  <th className={`${TH} text-right`}>Price</th>
                  <th className={TH}>Free trial</th>
                </tr>
              </thead>
              <tbody>
                {self &&
                  data.selfPricing.slice(0, 4).map((row, i) => (
                    <tr
                      key={`self-${row.planName}-${row.billingPeriod}`}
                      className="border-b border-border last:border-b-0 bg-accent/30"
                    >
                      <td className="px-3.5 py-2.5 align-middle">
                        {i === 0 && (
                          <span className="flex items-center gap-2 font-medium">
                            {self.name}
                            <span className="rounded-full border border-border px-1.5 py-px text-meta text-muted-foreground">
                              You
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle">{row.planName}</td>
                      <td className="px-3.5 py-2.5 align-middle text-right tabular-nums font-mono">
                        {fmtPrice(row)}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle text-muted-foreground">
                        {row.hasTrial ? (row.trialDays ? `${row.trialDays} days` : "Yes") : "—"}
                      </td>
                    </tr>
                  ))}
                {data.competitors.map((c) =>
                  (pricingByComp.get(c.id) ?? []).slice(0, 4).map((row, i) => (
                    <tr
                      key={`${c.id}-${row.planName}-${row.billingPeriod}`}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-3.5 py-2.5 align-middle">
                        {i === 0 && (
                          <Link
                            href={`/dashboard/competitors/${c.id}`}
                            className="flex items-center gap-2 font-medium hover:underline underline-offset-2"
                            style={competitorNameColor(c.color)}
                          >
                            <CompAvatar name={c.name} url={c.url} />
                            {c.name}
                          </Link>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle">{row.planName}</td>
                      <td className="px-3.5 py-2.5 align-middle text-right tabular-nums font-mono">
                        {fmtPrice(row)}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle text-muted-foreground">
                        {row.hasTrial ? (row.trialDays ? `${row.trialDays} days` : "Yes") : "—"}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Hiring + reviews — compact standing, side by side. */}
      {(data.hiring.length > 0 || data.reviews.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.hiring.length > 0 && (
            <section className="rounded-md border border-border">
              <h2 className="px-4 pt-3.5 text-sm font-semibold tracking-tight">Hiring right now</h2>
              <ul className="mt-1 pb-2">
                {data.hiring.slice(0, 5).map((h) => {
                  const comp = nameById.get(h.competitorId);
                  if (!comp) return null;
                  return (
                    <li
                      key={h.competitorId}
                      className="flex items-baseline justify-between gap-3 px-4 py-2 text-dense"
                    >
                      <span className="font-medium truncate" style={competitorNameColor(comp.color)}>
                        {comp.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        <span className="font-mono tabular-nums text-foreground">{h.total}</span>{" "}
                        open role{h.total > 1 ? "s" : ""}
                        {h.departments[0] ? ` · mostly ${h.departments[0].department}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {data.reviews.length > 0 && (
            <section className="rounded-md border border-border">
              <h2 className="px-4 pt-3.5 text-sm font-semibold tracking-tight">Review scores</h2>
              <ul className="mt-1 pb-2">
                {data.reviews.slice(0, 5).map((r) => {
                  const comp = nameById.get(r.competitorId);
                  if (!comp) return null;
                  return (
                    <li
                      key={`${r.competitorId}-${r.source}`}
                      className="flex items-baseline justify-between gap-3 px-4 py-2 text-dense"
                    >
                      <span className="font-medium truncate" style={competitorNameColor(comp.color)}>
                        {comp.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {REVIEW_SOURCE_LABELS[r.source] ?? r.source}{" "}
                        <span className="font-mono tabular-nums text-foreground">{r.score}/5</span> (
                        {r.reviewCount})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
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
            {data.recentActivity.map((item) => {
              const comp = nameById.get(item.competitorId);
              return (
                <div
                  key={`${item.competitorId}-${item.title}`}
                  className="flex items-baseline gap-3 px-4 py-2.5 border-b border-border last:border-b-0"
                >
                  <span className="w-14 shrink-0 font-mono text-meta text-muted-foreground tabular-nums">
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
                      <ExternalLink
                        size={10}
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

      {/* Transparent waiting (Lever 4) — per-source lights + the honest ETA. */}
      <section>
        <SectionHead
          title="Monitoring status"
          sub={
            data.nextCheckAt
              ? `next change check ${formatDistanceToNow(new Date(data.nextCheckAt), { addSuffix: true })}`
              : "scans run continuously"
          }
          divider={false}
        />
        <div className="mt-3 rounded-md border border-border">
          {data.competitors.map((c) => {
            const srcs = sourcesByComp.get(c.id) ?? [];
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-border last:border-b-0"
              >
                <Link
                  href={`/dashboard/competitors/${c.id}`}
                  className="flex w-40 shrink-0 items-center gap-2 text-dense font-medium truncate hover:underline underline-offset-2"
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
                        <Check size={11} className="text-primary" aria-hidden />
                      ) : s.status === "pending" ? (
                        <Clock3 size={11} aria-hidden />
                      ) : (
                        <TriangleAlert size={11} aria-hidden />
                      )}
                      {SOURCE_LABELS[s.sourceType] ?? s.sourceType.replace(/_/g, " ")}
                      {s.status === "pending" && <span className="sr-only"> — first scan pending</span>}
                      {s.status === "unavailable" && (
                        <span className="sr-only"> — temporarily unavailable</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          A signal appears when something actually changes on one of these sources — we
          can&apos;t predict when a competitor moves, only that we&apos;ll catch it.
        </p>
      </section>

      {/* What a signal will look like — clearly labeled example, never real data. */}
      <section>
        <div className="rounded-md border border-dashed border-border px-4 py-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="rounded-full border border-border px-1.5 py-px text-meta text-muted-foreground">
              Example signal
            </span>
            <span className="font-semibold text-content">Acme</span>
            <SeverityBadge severity="high" />
            <CatPill size="compact">pricing</CatPill>
          </div>
          <div className="text-content leading-snug">
            Acme dropped its Pro plan from $49 to $39/mo.
          </div>
          <div className="text-muted-foreground text-sm mt-1">
            Undercuts your mid-tier by 20% — expect pressure in head-to-head trials.
          </div>
        </div>
      </section>

      {!hasAnyContent && data.sources.length === 0 && (
        <WaitEmptyState competitorCount={competitorCount} />
      )}
    </>
  );
}
