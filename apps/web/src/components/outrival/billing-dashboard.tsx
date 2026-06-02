"use client";

import { useEffect, useState, type ReactNode } from "react";
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

const SOURCE_LABELS: Record<SourceType, string> = {
  homepage: "Homepage",
  pricing: "Pricing page",
  blog: "Blog",
  changelog: "Changelog",
  jobs: "Job postings",
  g2_reviews: "G2 reviews",
  capterra_reviews: "Capterra reviews",
  appstore_reviews: "App Store reviews",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  github_repo: "GitHub repo",
  // patch-18: internal anchor source, never shown in plan source lists.
  tech_stack: "Tech stack",
};

const FEATURE_ROWS: Array<{
  label: string;
  read: (p: Plan) => string | boolean;
  tooltip?: (p: Plan) => ReactNode;
}> = [
  {
    label: "Tracked competitors",
    read: (p) => {
      const lim = PLAN_LIMITS[p].maxCompetitors;
      return Number.isFinite(lim) ? `Up to ${lim}` : "Unlimited";
    },
  },
  {
    label: "Scraping frequency",
    read: (p) => {
      const freqs = PLAN_LIMITS[p].allowedFrequencies;
      if (freqs.includes("realtime")) return "Hourly";
      if (freqs.includes("daily")) return "Daily";
      return "Weekly";
    },
  },
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
  {
    label: "Alert channels",
    read: (p) =>
      PLAN_LIMITS[p].allowedChannels
        .map((c) => c[0]!.toUpperCase() + c.slice(1))
        .join(", "),
  },
  { label: "AI battle cards", read: (p) => PLAN_LIMITS[p].features.battleCards },
  {
    label: "Real-time alerts",
    read: (p) => PLAN_LIMITS[p].features.realtimeAlerts,
  },
  { label: "API access", read: (p) => PLAN_LIMITS[p].features.api },
  { label: "Multi-user", read: (p) => PLAN_LIMITS[p].features.multiUser },
];

function renderCell(v: string | boolean) {
  if (v === true)
    return <Check size={14} className="text-foreground inline-block" />;
  if (v === false)
    return <Minus size={14} className="text-muted-foreground/50 inline-block" />;
  return <span className="text-foreground">{v}</span>;
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
      setToast("Subscription cancelled. No changes made.");
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

  const used = billing.usage.competitors.used;
  const limit = billing.usage.competitors.limit;
  const usagePct =
    limit !== null && limit > 0
      ? Math.min(100, Math.round((used / limit) * 100))
      : 0;
  const isUnlimited = limit === null;

  return (
    <div className="flex flex-col gap-8">
      {toast && (
        <Card className="border-primary/40 bg-primary/[0.04] px-4 py-3 text-sm">
          {toast}
        </Card>
      )}

      <Card className="px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex flex-col">
              <span
                className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted-2)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Current plan
              </span>
              <span className="font-semibold text-base mt-0.5 tracking-tight">
                {PLAN_LABELS[billing.plan]}
                {billing.planPeriod && (
                  <span className="text-muted-foreground font-normal ml-1.5 text-sm">
                    · {billing.planPeriod}
                  </span>
                )}
              </span>
            </div>

            <div className="h-8 w-px bg-border hidden sm:block" />

            <div className="flex flex-col min-w-[180px]">
              <span
                className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted-2)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Competitors
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm tabular-nums">
                  {used}
                  {!isUnlimited && (
                    <span className="text-muted-foreground"> / {limit}</span>
                  )}
                  {isUnlimited && (
                    <span className="text-muted-foreground"> · ∞</span>
                  )}
                </span>
                {!isUnlimited && (
                  <Progress
                    value={usagePct}
                    className={cn(
                      "h-1 w-20",
                      usagePct >= 100 && "[&>div]:bg-destructive",
                    )}
                  />
                )}
              </div>
            </div>
          </div>

          {billing.hasSubscription && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePortal}
              disabled={busy === "portal"}
            >
              {busy === "portal" && (
                <Loader2 size={12} className="animate-spin" />
              )}
              {busy === "portal" ? "Opening…" : "Manage subscription"}
            </Button>
          )}
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-base tracking-tight">Change plan</h3>
            <p className="text-muted-foreground text-sm mt-0.5">
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

        <Card className="p-0 overflow-hidden">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[200px] align-bottom" />
                {PLANS.map((plan) => {
                  const isCurrent = plan === billing.plan;
                  const isPaid = plan !== "free";
                  const pricing = isPaid
                    ? PLAN_PRICING[plan as PaidPlan][period]
                    : 0;
                  const monthly =
                    period === "yearly" && isPaid
                      ? Math.round((pricing / 12) * 10) / 10
                      : pricing;

                  return (
                    <TableHead
                      key={plan}
                      className={cn(
                        "align-top py-4 px-3 border-l border-border",
                        isCurrent && "bg-surface-2/40",
                      )}
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted-2)]"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {PLAN_LABELS[plan]}
                          </span>
                          {isCurrent && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded bg-foreground text-background tracking-wider"
                              style={{ fontFamily: "var(--font-mono)" }}
                            >
                              CURRENT
                            </span>
                          )}
                        </div>

                        <div className="flex items-baseline gap-1">
                          <span className="text-xl font-semibold tracking-tight text-foreground tabular-nums">
                            {monthly}€
                          </span>
                          {isPaid && (
                            <span className="text-[11px] text-muted-foreground">
                              /mo
                            </span>
                          )}
                        </div>
                        <div className="h-3 text-[10px] text-muted-foreground">
                          {period === "yearly" && isPaid
                            ? `${pricing}€ billed yearly`
                            : ""}
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
                            size="sm"
                            onClick={() => handleCheckout(plan as PaidPlan)}
                            disabled={Boolean(busy)}
                            className="w-full"
                          >
                            {busy === plan && (
                              <Loader2 size={12} className="animate-spin" />
                            )}
                            {busy === plan ? "Redirecting…" : "Upgrade"}
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
              {FEATURE_ROWS.map((row) => (
                <TableRow key={row.label} className="hover:bg-transparent">
                  <TableCell className="text-muted-foreground font-normal whitespace-normal py-2.5 px-4">
                    {row.label}
                  </TableCell>
                  {PLANS.map((plan) => {
                    const isCurrent = plan === billing.plan;
                    return (
                      <TableCell
                        key={plan}
                        className={cn(
                          "text-center py-2.5 px-3 border-l border-border whitespace-normal",
                          isCurrent && "bg-surface-2/40",
                        )}
                      >
                        {row.tooltip ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-[3px] cursor-help">
                                {row.read(plan)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-[220px] text-[11px] leading-relaxed normal-case"
                            >
                              {row.tooltip(plan)}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          renderCell(row.read(plan))
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
