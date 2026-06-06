"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Minus, Loader2 } from "lucide-react";
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_PRICING,
  PLANS,
  type BillingPeriod,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import { api, type BillingInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BillingDashboardSkeleton } from "@/app/dashboard/settings/billing/loading";

type PaidPlan = Exclude<Plan, "free">;

const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  business: 3,
};

const EYEBROW =
  "font-mono text-micro uppercase tracking-[0.14em] text-[var(--muted-2)]";

const SOURCE_LABELS: Record<SourceType, string> = {
  homepage: "Homepage",
  pricing: "Pricing page",
  blog: "Blog",
  changelog: "Changelog",
  jobs: "Job postings",
  g2_reviews: "G2 reviews",
  capterra_reviews: "Capterra reviews",
  appstore_reviews: "App Store reviews",
  // patch-32: additional review platforms (pro+).
  trustpilot_reviews: "Trustpilot reviews",
  trustradius_reviews: "TrustRadius reviews",
  gartner_reviews: "Gartner reviews",
  playstore_reviews: "Play Store reviews",
  reddit: "Reddit mentions",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  github_repo: "GitHub repo",
  // patch-18: internal anchor source, never shown in plan source lists.
  tech_stack: "Tech stack",
  // patch-31: competitor status page (Statuspage/Instatus incidents).
  status: "Status page",
  // patch-32: internal sitemap-diff anchor, never shown in plan source lists.
  sitemap: "Sitemap",
};

function frequencyLabel(p: Plan): string {
  const freqs = PLAN_LIMITS[p].allowedFrequencies;
  if (freqs.includes("realtime")) return "Hourly";
  if (freqs.includes("daily")) return "Daily";
  return "Weekly";
}

function channelsLabel(p: Plan): string {
  return PLAN_LIMITS[p].allowedChannels
    .map((c) => c[0]!.toUpperCase() + c.slice(1))
    .join(", ");
}

function retentionLabel(p: Plan): string {
  const days = PLAN_LIMITS[p].historyRetentionDays;
  if (days >= 365) {
    const years = Math.round(days / 365);
    return `${years} year${years > 1 ? "s" : ""}`;
  }
  return `${days} days`;
}

type FeatureRow = {
  label: string;
  read: (p: Plan) => string | boolean;
  mono?: boolean;
  tooltip?: (p: Plan) => ReactNode;
};

const FEATURE_GROUPS: Array<{ title: string; rows: FeatureRow[] }> = [
  {
    title: "Monitoring",
    rows: [
      {
        label: "Tracked competitors",
        mono: true,
        read: (p) => `${PLAN_LIMITS[p].maxCompetitors}`,
      },
      { label: "Update frequency", read: frequencyLabel },
      {
        label: "Monitored sources",
        read: (p) => `${PLAN_LIMITS[p].allowedSources.length} sources`,
        tooltip: (p) => (
          <ul className="space-y-0.5">
            {PLAN_LIMITS[p].allowedSources.map((s) => (
              <li key={s}>{SOURCE_LABELS[s]}</li>
            ))}
          </ul>
        ),
      },
      { label: "History retention", read: retentionLabel },
    ],
  },
  {
    title: "Alerts & AI",
    rows: [
      { label: "Alert channels", read: channelsLabel },
      { label: "Real-time alerts", read: (p) => PLAN_LIMITS[p].features.realtimeAlerts },
      {
        label: "AI battle cards",
        mono: true,
        read: (p) => `${PLAN_LIMITS[p].battleCardsPerDay} / day`,
      },
      {
        label: "Competitor discovery",
        mono: true,
        read: (p) => `${PLAN_LIMITS[p].discoveriesPerMonth} / mo`,
      },
    ],
  },
  {
    title: "Platform",
    rows: [
      { label: "API access", read: (p) => PLAN_LIMITS[p].features.api },
      { label: "Multiple seats", read: (p) => PLAN_LIMITS[p].features.multiUser },
    ],
  },
];

function renderCell(row: FeatureRow, plan: Plan) {
  const v = row.read(plan);
  if (v === true)
    return <Check size={14} className="inline-block text-foreground" />;
  if (v === false)
    return <Minus size={14} className="inline-block text-muted-foreground/40" />;
  if (row.tooltip)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help text-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-[3px]">
            {v}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[220px] text-meta leading-relaxed normal-case"
        >
          {row.tooltip(plan)}
        </TooltipContent>
      </Tooltip>
    );
  return (
    <span
      className={cn(
        "text-foreground",
        row.mono && "font-mono tabular-nums text-xs",
      )}
    >
      {v}
    </span>
  );
}

export function BillingDashboard() {
  const router = useRouter();
  const search = useSearchParams();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.getBilling().then(setBilling).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const status = search.get("status");
    if (status === "success") {
      setToast(
        "Subscription activated. The new plan will be available in a few seconds.",
      );
      const t = setTimeout(
        () => api.getBilling().then(setBilling).catch(() => {}),
        2000,
      );
      router.replace("/dashboard/settings/billing");
      return () => clearTimeout(t);
    }
    if (status === "cancelled") {
      setToast("Checkout cancelled. No changes made.");
      router.replace("/dashboard/settings/billing");
    }
  }, [search, router]);

  async function handleCheckout(plan: PaidPlan) {
    setBusy(plan);
    setError(null);
    try {
      const { url } = await api.createCheckout(plan, period);
      window.location.href = url;
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  async function handlePortal() {
    setBusy("portal");
    setError(null);
    try {
      const { url } = await api.openPortal();
      window.location.href = url;
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  if (error && !billing)
    return <p className="text-sm text-muted-foreground">Error: {error}</p>;
  if (!billing) return <BillingDashboardSkeleton />;

  const currentRank = PLAN_RANK[billing.plan];
  const used = billing.usage.competitors.used;
  const limit = billing.usage.competitors.limit;
  const isUnlimited = limit === null;
  const usagePct =
    limit !== null && limit > 0
      ? Math.min(100, Math.round((used / limit) * 100))
      : 0;
  const remaining = limit !== null ? Math.max(0, limit - used) : null;

  const effPeriod: BillingPeriod = billing.planPeriod ?? "monthly";
  const currentPrice =
    billing.plan === "free" ? 0 : PLAN_PRICING[billing.plan as PaidPlan][effPeriod];

  const planFacts = [
    { label: "Update frequency", value: frequencyLabel(billing.plan) },
    { label: "Sources", value: `${PLAN_LIMITS[billing.plan].allowedSources.length} sources` },
    { label: "Alert channels", value: channelsLabel(billing.plan) },
  ];

  return (
    <div className="flex flex-col gap-10">
      {toast && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-primary/40 bg-primary/[0.05] px-4 py-3 text-sm"
        >
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
          <span>{toast}</span>
        </div>
      )}

      {/* ── Current plan ───────────────────────────────────────────────── */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex flex-col gap-2">
            <span className={EYEBROW}>Current plan</span>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-semibold text-2xl tracking-tight leading-none">
                {PLAN_LABELS[billing.plan]}
              </span>
              {billing.planPeriod && (
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider text-muted-foreground">
                  {billing.planPeriod}
                </span>
              )}
            </div>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {billing.plan === "free" ? (
                "No card required"
              ) : (
                <>
                  €{currentPrice}
                  <span className="text-muted-foreground">
                    {" "}
                    / {effPeriod === "yearly" ? "year" : "month"}
                  </span>
                </>
              )}
            </p>
          </div>

          {billing.hasSubscription && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePortal}
              disabled={busy === "portal"}
            >
              {busy === "portal" && <Loader2 size={12} className="animate-spin" />}
              {busy === "portal" ? "Opening…" : "Manage billing"}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-5 border-t border-border p-5">
          {/* Usage meter */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-foreground">Tracked competitors</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {used}
                {isUnlimited ? (
                  <span className="text-muted-foreground"> / ∞</span>
                ) : (
                  <span className="text-muted-foreground"> / {limit}</span>
                )}
              </span>
            </div>
            {!isUnlimited && (
              <>
                <Progress
                  value={usagePct}
                  className={cn(
                    "h-1.5",
                    usagePct >= 100 && "[&>div]:bg-destructive",
                  )}
                />
                <span className="font-mono text-micro tabular-nums text-[var(--muted-2)]">
                  {remaining} remaining
                </span>
              </>
            )}
          </div>

          {/* Plan facts strip */}
          <div className="grid grid-cols-1 overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 [&>*]:bg-surface gap-px">
            {planFacts.map((f) => (
              <div key={f.label} className="flex flex-col gap-1 px-3.5 py-3">
                <span className={EYEBROW}>{f.label}</span>
                <span className="text-dense text-foreground">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Plan selector ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base tracking-tight">
              Compare plans
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Yearly billing saves 17%.
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={(v) => v && setPeriod(v as BillingPeriod)}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
            <ToggleGroupItem value="yearly">
              Yearly <span className="ml-1 opacity-70">−17%</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <Card className="overflow-hidden p-0">
          <Table className="min-w-[680px] text-dense">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 z-[1] w-[190px] bg-surface align-bottom" />
                  {PLANS.map((plan) => {
                    const isCurrent = plan === billing.plan;
                    const isPaid = plan !== "free";
                    const pricing = isPaid
                      ? PLAN_PRICING[plan as PaidPlan][period]
                      : 0;
                    const perMonth =
                      period === "yearly" && isPaid
                        ? Math.round(pricing / 12)
                        : pricing;
                    const isUpgrade = PLAN_RANK[plan] > currentRank;

                    return (
                      <TableHead
                        key={plan}
                        className={cn(
                          "relative border-l border-border px-3 py-4 align-top",
                          isCurrent && "bg-primary/[0.04]",
                        )}
                      >
                        {isCurrent && (
                          <span className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
                        )}
                        <div className="flex flex-col gap-2.5">
                          <div className="flex items-center gap-2">
                            <span className={EYEBROW}>{PLAN_LABELS[plan]}</span>
                            {isCurrent && (
                              <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-micro tracking-wider text-primary-foreground">
                                CURRENT
                              </span>
                            )}
                          </div>

                          <div
                            key={period}
                            className="flex flex-col gap-0.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
                          >
                            <div className="flex items-baseline gap-1">
                              <span className="font-mono text-xl font-medium tabular-nums tracking-tight text-foreground">
                                €{perMonth}
                              </span>
                              {isPaid && (
                                <span className="text-meta text-muted-foreground">
                                  /mo
                                </span>
                              )}
                            </div>
                            <span className="h-3 font-mono text-micro tabular-nums text-[var(--muted-2)]">
                              {period === "yearly" && isPaid
                                ? `€${pricing} billed yearly`
                                : ""}
                            </span>
                          </div>

                          {isCurrent ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled
                              className="w-full font-normal"
                            >
                              Current plan
                            </Button>
                          ) : isPaid ? (
                            <Button
                              variant={isUpgrade ? "default" : "outline"}
                              size="sm"
                              onClick={() => handleCheckout(plan as PaidPlan)}
                              disabled={Boolean(busy)}
                              className="w-full"
                            >
                              {busy === plan && (
                                <Loader2 size={12} className="animate-spin" />
                              )}
                              {busy === plan
                                ? "Redirecting…"
                                : isUpgrade
                                  ? "Upgrade"
                                  : "Switch plan"}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled
                              className="w-full font-normal"
                            >
                              Free
                            </Button>
                          )}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {FEATURE_GROUPS.map((group) => (
                  <Fragment key={group.title}>
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableCell
                        colSpan={PLANS.length + 1}
                        className="sticky left-0 bg-surface px-4 pt-5 pb-1.5"
                      >
                        <span className={EYEBROW}>{group.title}</span>
                      </TableCell>
                    </TableRow>
                    {group.rows.map((row) => (
                      <TableRow key={row.label} className="hover:bg-transparent">
                        <TableCell className="sticky left-0 z-[1] whitespace-normal bg-surface px-4 py-2.5 font-normal text-muted-foreground">
                          {row.label}
                        </TableCell>
                        {PLANS.map((plan) => {
                          const isCurrent = plan === billing.plan;
                          return (
                            <TableCell
                              key={plan}
                              className={cn(
                                "border-l border-border px-3 py-2.5 text-center whitespace-normal",
                                isCurrent && "bg-primary/[0.04]",
                              )}
                            >
                              {renderCell(row, plan)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
        </Card>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
