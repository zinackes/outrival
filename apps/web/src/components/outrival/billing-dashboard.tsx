"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_PRICING,
  PLANS,
  type BillingPeriod,
  type Plan,
} from "@outrival/shared";
import { api, type BillingInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { BillingDashboardSkeleton } from "@/app/dashboard/settings/billing/billing-skeleton";

type PaidPlan = Exclude<Plan, "free">;
type Invoice = Awaited<ReturnType<typeof api.getInvoices>>["invoices"][number];

function formatInvoiceAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  business: 3,
};

const EYEBROW =
  "text-xs font-medium text-[var(--muted-2)]";

/** Curated plan blurbs + feature bullets, mirrored from the landing pricing section. */
const PLAN_CARDS: Record<
  Plan,
  { tag: string; featured: boolean; desc: string; features: string[] }
> = {
  free: {
    tag: "Free",
    featured: false,
    desc: "Validate the tool on 2 competitors before bringing in your team.",
    features: [
      "2 competitors",
      "Weekly email digest",
      "Homepage · pricing · blog",
      "1 user",
    ],
  },
  starter: {
    tag: "Starter",
    featured: false,
    desc: "For solo operators who need daily scans and Slack delivery.",
    features: [
      "5 competitors",
      "Daily scans · Slack & email digests",
      "Adds jobs + status page",
      "1 user",
    ],
  },
  pro: {
    tag: "Pro",
    featured: true,
    desc: "For product, growth, or strategy teams that need the full signal stream.",
    features: [
      "15 competitors",
      "All categories + severities",
      "Real-time Slack/email alerts",
      "AI-generated battle cards",
      "G2, Capterra, Trustpilot & Reddit reviews",
    ],
  },
  business: {
    tag: "Business",
    featured: false,
    desc: "50 competitors, every review source, multi-user, and API access.",
    features: [
      "50 competitors",
      "Every review source (+ Gartner, TrustRadius)",
      "App Store + Play Store reviews",
      "Multi-user · API access",
      "Priority cadence · audit logs · DPA",
    ],
  },
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

export function BillingDashboard({
  initialBilling = null,
}: {
  initialBilling?: BillingInfo | null;
} = {}) {
  const router = useRouter();
  const search = useSearchParams();
  const [billing, setBilling] = useState<BillingInfo | null>(initialBilling);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    // Server-seeded first paint → skip the redundant client fetch.
    if (initialBilling) return;
    api.getBilling().then(setBilling).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!billing?.hasSubscription) return;
    api
      .getInvoices()
      .then((r) => setInvoices(r.invoices))
      .catch(() => setInvoices([]));
  }, [billing?.hasSubscription]);

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
                <span className="rounded border border-border px-1.5 py-0.5 text-meta uppercase tracking-wider text-muted-foreground">
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
                <span className="font-mono text-meta tabular-nums text-[var(--muted-2)]">
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

      {/* ── Billing history ────────────────────────────────────────────── */}
      {invoices.length > 0 && (
        <section className="flex flex-col gap-4">
          <h3 className="font-semibold text-base tracking-tight">Billing history</h3>
          <Card className="divide-y divide-border overflow-hidden p-0">
            {invoices.map((inv) => (
              <div key={inv.id ?? inv.date} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-dense text-foreground">
                    {new Date(inv.date).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  {inv.status && inv.status !== "paid" && (
                    <div className="text-meta text-muted-foreground capitalize">{inv.status}</div>
                  )}
                </div>
                <span className="font-mono text-dense tabular-nums text-foreground">
                  {formatInvoiceAmount(inv.amountPaid, inv.currency)}
                </span>
                {inv.hostedUrl || inv.pdfUrl ? (
                  <a
                    href={(inv.hostedUrl ?? inv.pdfUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-dense text-link underline underline-offset-2"
                  >
                    Receipt
                  </a>
                ) : null}
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* ── Plan selector ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base tracking-tight">
              Compare plans
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              AI cost included — no usage-based billing. Yearly billing saves 17%.
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => {
            const card = PLAN_CARDS[plan];
            const isCurrent = plan === billing.plan;
            const isPaid = plan !== "free";
            const pricing = isPaid ? PLAN_PRICING[plan as PaidPlan][period] : 0;
            const perMonth =
              period === "yearly" && isPaid ? Math.round(pricing / 12) : pricing;
            const isUpgrade = PLAN_RANK[plan] > currentRank;
            const highlight = isCurrent || card.featured;

            return (
              <div
                key={plan}
                className={cn(
                  "relative flex flex-col rounded-xl border bg-surface p-6",
                  highlight
                    ? "border-primary/60 ring-1 ring-primary/30"
                    : "border-border",
                )}
              >
                {(isCurrent || card.featured) && (
                  <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-meta font-semibold uppercase tracking-wider text-primary-foreground">
                    {isCurrent ? "Current plan" : "Most popular"}
                  </span>
                )}

                <div>
                  <div
                    className={cn(
                      "text-xs uppercase tracking-wider",
                      highlight ? "text-primary" : "text-text-subtle",
                    )}
                  >
                    {card.tag}
                  </div>
                  <div className="mt-1.5 text-lg font-semibold">
                    {PLAN_LABELS[plan]}
                  </div>
                </div>

                <div
                  key={period}
                  className="mt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
                >
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tabular-nums">
                      €{perMonth}
                    </span>
                    <span className="text-sm text-text-subtle">/ month</span>
                  </div>
                  <span className="mt-1 block h-4 font-mono text-meta tabular-nums text-text-subtle">
                    {period === "yearly" && isPaid
                      ? `€${pricing} billed yearly`
                      : isPaid
                        ? "billed monthly"
                        : "No card required"}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-text-muted">
                  {card.desc}
                </p>

                <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                  {card.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <Button
                    variant="outline"
                    disabled
                    className="mt-6 w-full font-normal"
                  >
                    Current plan
                  </Button>
                ) : isPaid ? (
                  <Button
                    variant={isUpgrade ? "default" : "outline"}
                    onClick={() => handleCheckout(plan as PaidPlan)}
                    disabled={Boolean(busy)}
                    className="mt-6 w-full"
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
                    disabled
                    className="mt-6 w-full font-normal"
                  >
                    Free
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
