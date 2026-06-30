"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { api } from "@/lib/api";
import { billingQuery, invoicesQuery } from "@/lib/queries";
import { formatDate } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function BillingDashboard() {
  const router = useRouter();
  const search = useSearchParams();
  // Server-seeded on first paint (settings/billing/page.tsx) → useQuery reads the
  // hydrated cache; falls back to a client fetch when the seed is missing.
  const queryClient = useQueryClient();
  const billingQ = useQuery(billingQuery());
  const billing = billingQ.data ?? null;
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Target plan awaiting confirmation (downgrade to Free, or any switch that would
  // leave the org over the new tier's competitor cap). null = no dialog open.
  const [confirm, setConfirm] = useState<Plan | null>(null);
  // Invoices only matter once subscribed; gated so it doesn't fetch otherwise.
  const invoicesQ = useQuery({ ...invoicesQuery(), enabled: !!billing?.hasSubscription });
  const invoices: Invoice[] = invoicesQ.data ?? [];

  useEffect(() => {
    const status = search.get("status");
    if (status === "success") {
      setToast(
        "Subscription activated. The new plan will be available in a few seconds.",
      );
      // Stripe needs a beat to propagate the new plan; refetch billing after a delay.
      const t = setTimeout(
        () => queryClient.invalidateQueries({ queryKey: billingQuery().queryKey }),
        2000,
      );
      router.replace("/dashboard/settings/billing");
      return () => clearTimeout(t);
    }
    if (status === "cancelled") {
      setToast("Checkout cancelled. No changes made.");
      router.replace("/dashboard/settings/billing");
    }
  }, [search, router, queryClient]);

  // Apply a plan change. Free → schedule cancel-at-period-end; paid → Checkout
  // redirect (no sub) or an in-place prorated switch (existing sub). On the redirect
  // path we keep `busy` set so the button stays in its loading state until unload.
  async function applyChange(plan: Plan) {
    setBusy(plan);
    setError(null);
    try {
      if (plan === "free") {
        await api.downgradeToFree();
        setToast(
          "Your plan switches to Free at the end of the billing cycle — you keep full access until then.",
        );
      } else {
        const res = await api.changePlan(plan as PaidPlan, period);
        if (res.url) {
          window.location.href = res.url;
          return;
        }
        setToast("Plan updated. The change will reflect in a few seconds.");
      }
      setConfirm(null);
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: billingQuery().queryKey }),
        1500,
      );
      setBusy(null);
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  // Card click. Confirm first when dropping to Free, or when the target tier's
  // competitor cap is below current usage (the user should know what gets paused).
  function selectPlan(plan: Plan) {
    if (!billing || plan === billing.plan) return;
    const targetLimit = PLAN_LIMITS[plan].maxCompetitors;
    const wouldExceed = Number.isFinite(targetLimit) && used > targetLimit;
    if (plan === "free" || wouldExceed) {
      setConfirm(plan);
      return;
    }
    void applyChange(plan);
  }

  async function handleResume() {
    setBusy("resume");
    setError(null);
    try {
      await api.resumeSubscription();
      setToast("Cancellation reverted — your plan stays active.");
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: billingQuery().queryKey }),
        1500,
      );
    } catch (e) {
      setError(String(e));
    }
    setBusy(null);
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

  if ((error || billingQ.error) && !billing)
    return (
      <p className="text-sm text-muted-foreground">
        Error: {error ?? String(billingQ.error)}
      </p>
    );
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
  // Over the current tier's cap (e.g. after a downgrade). The excess competitors are
  // frozen non-destructively by the scheduler, not deleted — surfaced as a banner.
  const overLimit = limit !== null && used > limit;
  const overBy = overLimit ? used - (limit as number) : 0;

  // Competitors that the confirmed target plan would pause (over-cap), for the
  // pre-confirmation warning. 0 when the target's cap still covers current usage.
  const confirmLimit = confirm ? PLAN_LIMITS[confirm].maxCompetitors : 0;
  const confirmPaused =
    confirm && Number.isFinite(confirmLimit) ? Math.max(0, used - confirmLimit) : 0;

  const effPeriod: BillingPeriod = billing.planPeriod ?? "monthly";
  const currentPrice =
    billing.plan === "free" ? 0 : PLAN_PRICING[billing.plan as PaidPlan][effPeriod];

  return (
    <div className="flex flex-col gap-8">
      {toast && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-primary/40 bg-primary/[0.05] px-4 py-3 text-sm"
        >
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
          <span>{toast}</span>
        </div>
      )}

      {/* ── Over-limit notice ──────────────────────────────────────────── */}
      {overLimit && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-high/40 bg-high/[0.06] px-4 py-3 text-sm"
        >
          <span className="text-foreground">
            {overBy} competitor{overBy > 1 ? "s" : ""} over your{" "}
            {PLAN_LABELS[billing.plan]} limit{" "}
            {overBy > 1 ? "are" : "is"} paused. Nothing was deleted — upgrade to
            resume monitoring{overBy > 1 ? " them" : " it"}.
          </span>
          <Button
            size="sm"
            onClick={() => {
              const target = document.getElementById("plan-selector");
              target?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Upgrade
          </Button>
        </div>
      )}

      {/* ── Current plan ───────────────────────────────────────────────── */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
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

        {billing.cancelAtPeriodEnd && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-high/30 bg-high/[0.05] px-4 py-3 text-sm">
            <span className="text-foreground">
              Your {PLAN_LABELS[billing.plan]} plan ends
              {billing.cancelAt
                ? ` on ${formatDate(billing.cancelAt, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}`
                : ""}
              , then switches to Free. You keep full access until then.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResume}
              disabled={busy === "resume"}
            >
              {busy === "resume" && <Loader2 size={12} className="animate-spin" />}
              {busy === "resume" ? "Resuming…" : "Resume plan"}
            </Button>
          </div>
        )}

        <div className="border-t border-border p-4">
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
                    {formatDate(inv.date, {
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
      <section id="plan-selector" className="flex flex-col gap-6">
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
            // The primary accent (border + ring + filled badge) is rationed to the
            // upsell. The current plan is a *state*, not a CTA → neutral, solid
            // treatment so the two are never visually confused.
            const isPopular = card.featured && !isCurrent;

            return (
              <div
                key={plan}
                className={cn(
                  "relative flex flex-col rounded-xl border bg-surface p-6",
                  isPopular && "border-primary/60 ring-1 ring-primary/30",
                  isCurrent && "border-foreground/25 bg-muted/20",
                  !isPopular && !isCurrent && "border-border",
                )}
              >
                {(isCurrent || isPopular) && (
                  <span
                    className={cn(
                      "absolute -top-2.5 left-6 rounded-full px-2.5 py-0.5 text-meta font-semibold uppercase tracking-wider",
                      isCurrent
                        ? "border border-border bg-muted text-foreground"
                        : "bg-primary text-primary-foreground",
                    )}
                  >
                    {isCurrent ? "Current plan" : "Most popular"}
                  </span>
                )}

                <div>
                  <div
                    className={cn(
                      "text-xs uppercase tracking-wider",
                      isPopular ? "text-primary" : "text-text-subtle",
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
                    onClick={() => selectPlan(plan)}
                    disabled={Boolean(busy)}
                    className="mt-6 w-full"
                  >
                    {busy === plan && (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                    {busy === plan
                      ? "Working…"
                      : isUpgrade
                        ? "Upgrade"
                        : "Switch plan"}
                  </Button>
                ) : billing.cancelAtPeriodEnd ? (
                  <Button
                    variant="outline"
                    disabled
                    className="mt-6 w-full font-normal"
                  >
                    Scheduled
                  </Button>
                ) : (
                  // Free card while on a paid plan → the downgrade entry point.
                  <Button
                    variant="outline"
                    onClick={() => selectPlan("free")}
                    disabled={Boolean(busy)}
                    className="mt-6 w-full"
                  >
                    {busy === "free" && (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                    {busy === "free" ? "Working…" : "Downgrade to Free"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ── Downgrade / over-cap switch confirmation ───────────────────── */}
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "free"
                ? "Downgrade to Free?"
                : `Switch to ${confirm ? PLAN_LABELS[confirm] : ""}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm === "free"
                ? "Your subscription cancels at the end of the current billing cycle. You keep full access until then, then the workspace moves to the Free plan."
                : "Your plan switches now, prorated against your current billing cycle."}
            </DialogDescription>
          </DialogHeader>

          {confirmPaused > 0 && (
            <p className="rounded-md border border-high/40 bg-high/[0.06] px-3 py-2.5 text-sm text-foreground">
              {confirmPaused} of your {used} competitors will be paused to fit the{" "}
              {confirm ? PLAN_LABELS[confirm] : ""} limit of {confirmLimit}. Nothing
              is deleted — they’re restored automatically if you upgrade again.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={Boolean(busy)}
            >
              Keep current plan
            </Button>
            <Button
              variant={confirm === "free" ? "destructive" : "default"}
              onClick={() => confirm && applyChange(confirm)}
              disabled={Boolean(busy)}
            >
              {busy === confirm && <Loader2 size={12} className="animate-spin" />}
              {confirm === "free" ? "Downgrade to Free" : "Confirm switch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
