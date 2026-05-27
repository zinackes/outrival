"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { PLAN_LABELS, PLAN_LIMITS, type Plan } from "@outrival/shared";
import {
  ApiError,
  api,
  type DiscoveredCompetitor,
  type ProductProfile,
} from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { resetUser, track } from "@/lib/posthog/events";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;
type SourceType = "homepage" | "pricing" | "blog";
type Frequency = "daily" | "weekly";

interface Selection extends DiscoveredCompetitor {
  selected: boolean;
}

type FieldErrors = Partial<
  Record<"productUrl" | "manualUrl" | "competitors" | "sources" | "global", string>
>;

const STEP_META: Record<
  Step,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    icon: typeof Globe;
    shortLabel: string;
    caption: string;
  }
> = {
  1: {
    eyebrow: "Step 1 of 4",
    title: "Which product do we watch?",
    subtitle:
      "Give us your product URL. We analyze it to understand your market and identify your real competitors.",
    icon: Globe,
    shortLabel: "Product",
    caption: "Your website URL",
  },
  2: {
    eyebrow: "Step 2 of 4",
    title: "Did we understand your product?",
    subtitle:
      "Here's what we extracted from your site. Fix anything inaccurate — it directly improves the relevance of the competitors we suggest.",
    icon: Target,
    shortLabel: "Profile",
    caption: "AI validation",
  },
  3: {
    eyebrow: "Step 3 of 4",
    title: "Your competitors",
    subtitle:
      "We found a list. Check the ones that really matter — you can add or remove more later.",
    icon: Users,
    shortLabel: "Competitors",
    caption: "Target selection",
  },
  4: {
    eyebrow: "Step 4 of 4",
    title: "Monitoring preferences",
    subtitle:
      "Pick the scraping frequency and the sources to watch. You can change everything later.",
    icon: Bell,
    shortLabel: "Monitoring",
    caption: "Frequency + sources",
  },
};

const SOURCE_DEF: Record<SourceType, { label: string; description: string }> = {
  homepage: {
    label: "Homepage",
    description: "Repositioning and messaging changes.",
  },
  pricing: {
    label: "Pricing",
    description: "Prices, new plans or modified tiers.",
  },
  blog: {
    label: "Blog",
    description: "Product announcements and strategic content.",
  },
};

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown; error?: unknown };
    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string" && !data.error.startsWith("plan_"))
      return data.error;
    if (err.status === 401) return "Session expired. Please sign in again.";
    if (err.status === 429)
      return "Too many requests. Wait a few seconds before trying again.";
    if (err.status >= 500)
      return "The server encountered an error. Try again in a moment.";
    return err.message;
  }
  if (err instanceof Error) {
    if (err.name === "TypeError" || err.message.toLowerCase().includes("fetch"))
      return "Cannot connect to the server. Check your network connection.";
    return err.message;
  }
  return String(err);
}

export function OnboardingForm({ plan }: { plan: Plan }) {
  const router = useRouter();
  const planLimits = PLAN_LIMITS[plan];
  const maxCompetitors = planLimits.maxCompetitors;
  const allowedFrequencies = planLimits.allowedFrequencies;
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState<null | "analyze" | "discover" | "complete">(
    null,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  // Form state — preserved across back navigation
  const [productUrl, setProductUrl] = useState("");
  const [committedUrl, setCommittedUrl] = useState("");
  const [profile, setProfile] = useState<ProductProfile | null>(null);
  const [competitors, setCompetitors] = useState<Selection[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [frequency, setFrequency] = useState<Frequency>(
    allowedFrequencies.includes("daily") ? "daily" : "weekly",
  );
  const [sources, setSources] = useState<SourceType[]>([
    "homepage",
    "pricing",
    "blog",
  ]);

  useEffect(() => {
    track("onboarding_started");
  }, []);

  const completedSteps = useMemo<Record<Step, boolean>>(
    () => ({
      1: profile !== null,
      2: competitors.length > 0,
      3: step > 3,
      4: false,
    }),
    [profile, competitors.length, step],
  );

  function clearErrors() {
    setErrors({});
  }

  async function handleSignOut() {
    await signOut();
    resetUser();
    router.push("/login");
  }

  // ── Step 1 → Step 2 ────────────────────────────────────────────────────
  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    clearErrors();
    if (!isValidUrl(productUrl)) {
      setErrors({
        productUrl:
          "Invalid URL. Expected format: https://yourproduct.com",
      });
      return;
    }

    setBusy("analyze");
    try {
      const res = await api.analyzeProduct(productUrl);
      // If the user re-analyzed with a different URL, invalidate downstream state
      if (productUrl !== committedUrl) {
        setCompetitors([]);
      }
      setProfile(res.profile);
      setCommittedUrl(productUrl);
      setStep(2);
      track("onboarding_product_analyzed");
    } catch (e) {
      setErrors({ global: extractMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  // ── Step 2 → Step 3 ────────────────────────────────────────────────────
  async function handleProfileConfirm() {
    if (!profile) return;
    clearErrors();

    const empty = (
      ["category", "audience", "valueProp", "pricingModel"] as const
    ).filter((k) => !profile[k].trim());
    if (empty.length > 0) {
      setErrors({
        global:
          "All fields are required. Fill in the empty ones.",
      });
      return;
    }

    setBusy("discover");
    try {
      await api.patchProductProfile(profile);
      const res = await api.discoverCompetitors(committedUrl, profile);
      const sorted = [...res.competitors].sort(
        (a, b) => b.overlapScore - a.overlapScore,
      );
      let picked = 0;
      setCompetitors(
        sorted.map((c) => {
          const wantSelect = c.overlapScore > 60 && picked < maxCompetitors;
          if (wantSelect) picked += 1;
          return { ...c, selected: wantSelect };
        }),
      );
      setStep(3);
      track("onboarding_competitors_found", { count: sorted.length });
    } catch (e) {
      setErrors({ global: extractMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  // ── Step 3 helpers ─────────────────────────────────────────────────────
  function showCompetitorLimitPaywall(used: number) {
    setPaywall({
      code: "plan_limit_competitors",
      plan,
      limit: maxCompetitors,
      used,
    });
  }

  function toggleCompetitor(url: string) {
    setCompetitors((prev) => {
      const target = prev.find((c) => c.url === url);
      if (!target) return prev;
      if (!target.selected) {
        const currentSelected = prev.filter((c) => c.selected).length;
        if (currentSelected >= maxCompetitors) {
          showCompetitorLimitPaywall(currentSelected);
          return prev;
        }
      }
      return prev.map((c) =>
        c.url === url ? { ...c, selected: !c.selected } : c,
      );
    });
  }

  function removeCompetitor(url: string) {
    setCompetitors((prev) => prev.filter((c) => c.url !== url));
  }

  function addManualCompetitor() {
    clearErrors();
    const trimmed = manualUrl.trim();
    if (!trimmed) {
      setErrors({ manualUrl: "Enter a URL." });
      return;
    }
    if (!isValidUrl(trimmed)) {
      setErrors({ manualUrl: "Invalid URL." });
      return;
    }
    if (competitors.some((c) => c.url === trimmed)) {
      setErrors({ manualUrl: "This competitor is already in the list." });
      return;
    }
    const currentSelected = competitors.filter((c) => c.selected).length;
    if (currentSelected >= maxCompetitors) {
      showCompetitorLimitPaywall(currentSelected);
      return;
    }
    const u = new URL(trimmed);
    const title = u.hostname.replace(/^www\./, "");
    setCompetitors((prev) => [
      {
        url: trimmed,
        title,
        snippet: "Added manually.",
        overlapScore: 0,
        reason: "Manual",
        selected: true,
      },
      ...prev,
    ]);
    setManualUrl("");
  }

  // ── Step 3 → Step 4 ────────────────────────────────────────────────────
  function handleCompetitorsConfirm() {
    clearErrors();
    if (competitors.filter((c) => c.selected).length === 0) {
      setErrors({ competitors: "Select at least one competitor." });
      return;
    }
    setStep(4);
  }

  function toggleSource(s: SourceType) {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  function selectFrequency(f: Frequency) {
    if (!allowedFrequencies.includes(f)) {
      setPaywall({ code: "plan_locked_frequency", plan, frequency: f });
      return;
    }
    setFrequency(f);
  }

  // ── Step 4 → Complete ──────────────────────────────────────────────────
  async function handleComplete() {
    clearErrors();
    if (sources.length === 0) {
      setErrors({ sources: "Select at least one source to monitor." });
      return;
    }
    const selected = competitors.filter((c) => c.selected);
    if (selected.length === 0) {
      setErrors({
        global: "No competitor selected. Go back to the previous step.",
      });
      return;
    }

    setBusy("complete");
    try {
      const payload = {
        selectedCompetitors: selected.map((c) => {
          const u = new URL(c.url);
          return {
            name: c.title || u.hostname,
            url: c.url,
            overlapScore: c.overlapScore || undefined,
          };
        }),
        monitoringPrefs: { frequency, sources },
      };
      await api.completeOnboarding(payload);
      track("onboarding_completed", { competitorCount: selected.length });
      router.push("/dashboard");
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
      } else {
        setErrors({ global: extractMessage(e) });
      }
      setBusy(null);
    }
  }

  function goBack() {
    clearErrors();
    if (step > 1) setStep((step - 1) as Step);
  }

  const selectedCount = competitors.filter((c) => c.selected).length;
  const meta = STEP_META[step];

  return (
    <div className="min-h-screen flex flex-col bg-background-2">
      <Header onSignOut={handleSignOut} />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-8 py-8 sm:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 lg:gap-12">
          <Stepper currentStep={step} completedSteps={completedSteps} />

          <div className="min-w-0">
            <StepHeader meta={meta} />

            {errors.global && (
              <ErrorBanner message={errors.global} onDismiss={clearErrors} />
            )}

            <div className="mt-8">
              {step === 1 && (
                <Step1
                  productUrl={productUrl}
                  setProductUrl={setProductUrl}
                  onSubmit={handleAnalyze}
                  busy={busy === "analyze"}
                  fieldError={errors.productUrl}
                />
              )}

              {step === 2 && profile && (
                <Step2
                  hostname={hostnameOf(committedUrl)}
                  profile={profile}
                  setProfile={setProfile}
                  onConfirm={handleProfileConfirm}
                  onBack={goBack}
                  busy={busy === "discover"}
                />
              )}

              {step === 3 && (
                <Step3
                  competitors={competitors}
                  selectedCount={selectedCount}
                  maxCompetitors={maxCompetitors}
                  plan={plan}
                  toggleCompetitor={toggleCompetitor}
                  removeCompetitor={removeCompetitor}
                  manualUrl={manualUrl}
                  setManualUrl={setManualUrl}
                  addManualCompetitor={addManualCompetitor}
                  manualError={errors.manualUrl}
                  competitorsError={errors.competitors}
                  onConfirm={handleCompetitorsConfirm}
                  onBack={goBack}
                />
              )}

              {step === 4 && (
                <Step4
                  frequency={frequency}
                  setFrequency={selectFrequency}
                  allowedFrequencies={allowedFrequencies}
                  plan={plan}
                  sources={sources}
                  toggleSource={toggleSource}
                  selectedCount={selectedCount}
                  sourcesError={errors.sources}
                  busy={busy === "complete"}
                  onConfirm={handleComplete}
                  onBack={goBack}
                />
              )}
            </div>
          </div>
        </div>
      </main>

      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── Shell ────────────────────────────────────────────────────────────────

function Header({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background-2/85 backdrop-blur supports-[backdrop-filter]:bg-background-2/65">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="text-base font-semibold font-[var(--font-display)] tracking-tight"
        >
          <span className="text-muted-foreground">Out</span>rival
        </Link>
        <Button variant="ghost" size="sm" onClick={() => void onSignOut()}>
          Sign out
        </Button>
      </div>
    </header>
  );
}

function Stepper({
  currentStep,
  completedSteps,
}: {
  currentStep: Step;
  completedSteps: Record<Step, boolean>;
}) {
  return (
    <aside>
      {/* Mobile compact bar */}
      <div className="lg:hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            Setup
          </span>
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {currentStep} / 4
          </span>
        </div>
        <div className="mb-8 flex gap-1.5">
          {([1, 2, 3, 4] as const).map((n) => (
            <div
              key={n}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                n < currentStep || completedSteps[n]
                  ? "bg-foreground"
                  : n === currentStep
                    ? "bg-foreground/60"
                    : "bg-border-strong",
              )}
            />
          ))}
        </div>
      </div>

      {/* Desktop vertical timeline */}
      <div className="hidden lg:block lg:sticky lg:top-24">
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-6">
          Setup · {currentStep} / 4
        </p>
        <ol className="flex flex-col">
          {(Object.entries(STEP_META) as Array<[string, (typeof STEP_META)[Step]]>).map(
            ([k, m]) => {
              const n = Number(k) as Step;
              const isCurrent = currentStep === n;
              const isDone = n < currentStep && completedSteps[n];
              const Icon = m.icon;
              return (
                <li key={n} className="flex items-start gap-3 py-2">
                  <div
                    className={cn(
                      "shrink-0 mt-0.5 w-7 h-7 rounded-md flex items-center justify-center border transition-colors",
                      isCurrent &&
                        "bg-foreground text-background border-foreground",
                      !isCurrent &&
                        isDone &&
                        "bg-foreground/10 text-foreground border-border-strong",
                      !isCurrent &&
                        !isDone &&
                        "bg-transparent text-muted-foreground border-border",
                    )}
                  >
                    {isDone ? <Check size={14} /> : <Icon size={14} />}
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p
                      className={cn(
                        "text-[13px] font-medium leading-tight",
                        isCurrent ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {m.shortLabel}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                      {m.caption}
                    </p>
                  </div>
                </li>
              );
            },
          )}
        </ol>

        <div className="mt-10 pt-6 border-t border-border">
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            Estimated time
          </p>
          <p className="text-sm text-foreground">~ 2 minutes</p>
        </div>
      </div>
    </aside>
  );
}

function StepHeader({ meta }: { meta: (typeof STEP_META)[Step] }) {
  return (
    <div>
      <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {meta.eyebrow}
      </p>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2 font-[var(--font-display)]">
        {meta.title}
      </h1>
      <p className="text-sm text-muted-foreground mt-3 max-w-xl">
        {meta.subtitle}
      </p>
    </div>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-6 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"
    >
      <AlertCircle size={16} className="mt-0.5 text-destructive shrink-0" />
      <p className="flex-1 text-sm text-foreground">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close"
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function FooterNav({
  primaryLabel,
  busy,
  busyLabel,
  onBack,
  onSubmit,
  primaryDisabled,
  hint,
}: {
  primaryLabel: string;
  busy?: boolean;
  busyLabel?: string;
  onBack?: () => void;
  onSubmit: () => void | Promise<void>;
  primaryDisabled?: boolean;
  hint?: string;
}) {
  return (
    <>
      <div className="mt-10 pt-6 border-t border-border flex items-center justify-between gap-3">
        <div>
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={busy}
            >
              <ArrowLeft size={14} /> Back
            </Button>
          )}
        </div>
        <Button
          type="button"
          onClick={() => void onSubmit()}
          disabled={busy || primaryDisabled}
        >
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {busyLabel ?? "Loading…"}
            </>
          ) : (
            <>
              {primaryLabel}
              <ArrowRight size={14} />
            </>
          )}
        </Button>
      </div>
      {hint && (
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70 mt-3 text-right">
          {hint}
        </p>
      )}
    </>
  );
}

// ── Step 1 ───────────────────────────────────────────────────────────────

function Step1({
  productUrl,
  setProductUrl,
  onSubmit,
  busy,
  fieldError,
}: {
  productUrl: string;
  setProductUrl: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  fieldError?: string;
}) {
  return (
    <form onSubmit={onSubmit}>
      <Card className="p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <Label htmlFor="product-url" className="text-sm">
            Your product URL
          </Label>
          <Input
            id="product-url"
            type="url"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="https://yourproduct.com"
            autoFocus
            disabled={busy}
            aria-invalid={Boolean(fieldError)}
            className="h-11 text-base"
          />
          {fieldError ? (
            <p className="text-xs text-destructive mt-1">{fieldError}</p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              We extract your category, audience, value prop, and pricing model
              from this URL.
            </p>
          )}
        </div>
      </Card>

      <div className="mt-10 pt-6 border-t border-border flex items-center justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              Analyze <ArrowRight size={14} />
            </>
          )}
        </Button>
      </div>
      {busy && (
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70 mt-3 text-right">
          May take 10 to 20 seconds
        </p>
      )}
    </form>
  );
}

// ── Step 2 ───────────────────────────────────────────────────────────────

const PROFILE_FIELDS: Array<{
  key: keyof ProductProfile;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  {
    key: "category",
    label: "Category",
    placeholder: "e.g. B2B SaaS CRM",
  },
  {
    key: "audience",
    label: "Target audience",
    placeholder: "e.g. Sales teams of 10–200 people",
  },
  {
    key: "valueProp",
    label: "Value proposition",
    placeholder: "What makes your product unique",
    multiline: true,
  },
  {
    key: "pricingModel",
    label: "Pricing model",
    placeholder: "e.g. Per-seat, freemium with Pro plan at $20/month",
  },
];

function Step2({
  hostname,
  profile,
  setProfile,
  onConfirm,
  onBack,
  busy,
}: {
  hostname: string;
  profile: ProductProfile;
  setProfile: (p: ProductProfile) => void;
  onConfirm: () => void | Promise<void>;
  onBack: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        <Sparkles size={12} />
        AI-extracted from <span className="text-foreground/80">{hostname}</span>
      </div>

      <Card className="p-6 sm:p-8 flex flex-col gap-5">
        {PROFILE_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`field-${f.key}`} className="text-sm">
              {f.label}
            </Label>
            {f.multiline ? (
              <Textarea
                id={`field-${f.key}`}
                value={profile[f.key]}
                onChange={(e) =>
                  setProfile({ ...profile, [f.key]: e.target.value })
                }
                placeholder={f.placeholder}
                disabled={busy}
                rows={3}
              />
            ) : (
              <Input
                id={`field-${f.key}`}
                value={profile[f.key]}
                onChange={(e) =>
                  setProfile({ ...profile, [f.key]: e.target.value })
                }
                placeholder={f.placeholder}
                disabled={busy}
              />
            )}
          </div>
        ))}
      </Card>

      <FooterNav
        onBack={onBack}
        onSubmit={onConfirm}
        busy={busy}
        busyLabel="Finding competitors…"
        primaryLabel="That's right"
        hint={busy ? "May take 15 to 30 seconds" : undefined}
      />
    </div>
  );
}

// ── Step 3 ───────────────────────────────────────────────────────────────

function Step3({
  competitors,
  selectedCount,
  maxCompetitors,
  plan,
  toggleCompetitor,
  removeCompetitor,
  manualUrl,
  setManualUrl,
  addManualCompetitor,
  manualError,
  competitorsError,
  onConfirm,
  onBack,
}: {
  competitors: Selection[];
  selectedCount: number;
  maxCompetitors: number;
  plan: Plan;
  toggleCompetitor: (url: string) => void;
  removeCompetitor: (url: string) => void;
  manualUrl: string;
  setManualUrl: (v: string) => void;
  addManualCompetitor: () => void;
  manualError?: string;
  competitorsError?: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const atLimit = selectedCount >= maxCompetitors;
  const limitLabel = Number.isFinite(maxCompetitors)
    ? `${selectedCount} / ${maxCompetitors}`
    : `${selectedCount}`;
  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {competitors.length} found · {limitLabel} selected
        </p>
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Plan {PLAN_LABELS[plan]}
          {Number.isFinite(maxCompetitors) ? ` · max ${maxCompetitors}` : ""}
        </p>
      </div>

      <Card className="p-2 sm:p-3 max-h-[420px] overflow-auto">
        {competitors.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No competitor suggested. Add some manually below.
          </div>
        ) : (
          <ul className="flex flex-col">
            {competitors.map((c) => (
              <CompetitorRow
                key={c.url}
                competitor={c}
                disabled={atLimit && !c.selected}
                onToggle={() => toggleCompetitor(c.url)}
                onRemove={() => removeCompetitor(c.url)}
              />
            ))}
          </ul>
        )}
      </Card>

      {competitorsError && (
        <p className="text-xs text-destructive mt-2">{competitorsError}</p>
      )}

      <div className="mt-6">
        <Label htmlFor="manual-url" className="text-sm mb-2 block">
          Add a competitor manually
        </Label>
        <div className="flex gap-2">
          <Input
            id="manual-url"
            type="url"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://other-competitor.com"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManualCompetitor();
              }
            }}
            aria-invalid={Boolean(manualError)}
          />
          <Button type="button" variant="outline" onClick={addManualCompetitor}>
            <Plus size={14} /> Add
          </Button>
        </div>
        {manualError && (
          <p className="text-xs text-destructive mt-1">{manualError}</p>
        )}
      </div>

      <FooterNav
        onBack={onBack}
        onSubmit={onConfirm}
        primaryLabel="Continue"
        primaryDisabled={selectedCount === 0}
      />
    </div>
  );
}

function CompetitorRow({
  competitor,
  disabled,
  onToggle,
  onRemove,
}: {
  competitor: Selection;
  disabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 px-3 py-3 rounded-md cursor-pointer transition-colors",
        "hover:bg-surface-2",
        competitor.selected && "bg-surface-2/60",
        disabled && "opacity-50",
      )}
      onClick={onToggle}
      title={disabled ? "Limit reached — upgrade to add more" : competitor.reason}
    >
      <Checkbox
        checked={competitor.selected}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="mt-1"
        aria-label={`Select ${competitor.title}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {competitor.title}
          </span>
          {competitor.overlapScore > 0 && (
            <OverlapBadge score={competitor.overlapScore} />
          )}
        </div>
        <a
          href={competitor.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[11px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-0.5 transition-colors"
        >
          {competitor.url.replace(/^https?:\/\//, "")}
          <ExternalLink size={10} />
        </a>
        {competitor.snippet && (
          <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-2">
            {competitor.snippet}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Remove"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 size={14} />
      </Button>
    </li>
  );
}

function OverlapBadge({ score }: { score: number }) {
  const tone = score > 75 ? "positive" : score > 50 ? "accent" : "muted";
  const classes = {
    positive: "bg-positive/15 text-positive border-positive/30",
    accent: "bg-foreground/10 text-foreground border-border-strong",
    muted: "bg-transparent text-muted-foreground border-border",
  }[tone];
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 font-medium border rounded font-mono uppercase tracking-wider",
        classes,
      )}
    >
      {Math.round(score)}%
    </span>
  );
}

// ── Step 4 ───────────────────────────────────────────────────────────────

function Step4({
  frequency,
  setFrequency,
  allowedFrequencies,
  plan,
  sources,
  toggleSource,
  selectedCount,
  sourcesError,
  busy,
  onConfirm,
  onBack,
}: {
  frequency: Frequency;
  setFrequency: (f: Frequency) => void;
  allowedFrequencies: ReadonlyArray<string>;
  plan: Plan;
  sources: SourceType[];
  toggleSource: (s: SourceType) => void;
  selectedCount: number;
  sourcesError?: string;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
  onBack: () => void;
}) {
  return (
    <div>
      <Card className="p-6 sm:p-8 flex flex-col gap-8">
        <section>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Frequency
            </p>
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Plan {PLAN_LABELS[plan]}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["daily", "weekly"] as const).map((f) => {
              const locked = !allowedFrequencies.includes(f);
              return (
                <SegmentChoice
                  key={f}
                  active={frequency === f}
                  locked={locked}
                  onClick={() => setFrequency(f)}
                  title={f === "daily" ? "Daily" : "Weekly"}
                  description={
                    f === "daily"
                      ? "Scrape once a day. Recommended."
                      : "Once a week. Lighter."
                  }
                  variant="radio"
                />
              );
            })}
          </div>
        </section>

        <section>
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
            Sources to monitor
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(["homepage", "pricing", "blog"] as const).map((s) => {
              const def = SOURCE_DEF[s];
              return (
                <SegmentChoice
                  key={s}
                  active={sources.includes(s)}
                  onClick={() => toggleSource(s)}
                  title={def.label}
                  description={def.description}
                  variant="check"
                />
              );
            })}
          </div>
          {sourcesError && (
            <p className="text-xs text-destructive mt-2">{sourcesError}</p>
          )}
        </section>
      </Card>

      <Card className="mt-6 p-5 bg-background border-dashed">
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
          Summary
        </p>
        <ul className="text-sm text-foreground flex flex-col gap-1.5">
          <li>
            <span className="text-muted-foreground">
              Tracked competitors:{" "}
            </span>
            {selectedCount}
          </li>
          <li>
            <span className="text-muted-foreground">Frequency: </span>
            {frequency === "daily" ? "Daily" : "Weekly"}
          </li>
          <li>
            <span className="text-muted-foreground">Sources: </span>
            {sources.length > 0
              ? sources.map((s) => SOURCE_DEF[s].label).join(" · ")
              : "—"}
          </li>
        </ul>
      </Card>

      <FooterNav
        onBack={onBack}
        onSubmit={onConfirm}
        busy={busy}
        busyLabel="Setting up…"
        primaryLabel="Start monitoring"
      />
    </div>
  );
}

function SegmentChoice({
  active,
  locked,
  onClick,
  title,
  description,
  variant,
}: {
  active: boolean;
  locked?: boolean;
  onClick: () => void;
  title: string;
  description: string;
  variant: "radio" | "check";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={locked ? "Higher plan required" : undefined}
      className={cn(
        "text-left p-4 rounded-md border transition-all",
        active
          ? "border-foreground bg-foreground/5 ring-1 ring-foreground/40"
          : "border-border hover:border-border-strong hover:bg-surface-2",
        locked && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2">
        {variant === "radio" ? (
          <span
            className={cn(
              "w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
              active
                ? "bg-foreground border-foreground"
                : "bg-transparent border-border-strong",
            )}
          >
            {active && (
              <span className="w-1.5 h-1.5 rounded-full bg-background" />
            )}
          </span>
        ) : (
          <span
            className={cn(
              "w-4 h-4 rounded-sm border flex items-center justify-center transition-colors",
              active
                ? "bg-foreground border-foreground text-background"
                : "bg-transparent border-border-strong text-transparent",
            )}
          >
            <Check size={10} strokeWidth={3} />
          </span>
        )}
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
        {description}
      </p>
    </button>
  );
}
