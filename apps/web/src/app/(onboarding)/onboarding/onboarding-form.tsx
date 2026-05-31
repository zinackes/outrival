"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  GitBranch,
  Globe,
  Lightbulb,
  Loader2,
  Lock,
  LogOut,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { PLAN_LABELS, PLAN_LIMITS, detectTemporaryUrl, type Plan } from "@outrival/shared";
import {
  ApiError,
  api,
  type DiscoveredCompetitor,
  type OnboardingStep,
  type ProductProfile,
  type ProjectStage,
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

type Screen = "stage" | "input" | "profile" | "discover" | "monitoring" | "done";
type SourceType = "homepage" | "pricing" | "blog";
type Frequency = "daily" | "weekly";

interface Selection extends DiscoveredCompetitor {
  selected: boolean;
}

const SCREEN_TO_STEP: Record<Screen, number> = {
  stage: 1,
  input: 1,
  profile: 2,
  discover: 3,
  monitoring: 4,
  done: 5,
};

const STAGE_META: Record<
  ProjectStage,
  { icon: typeof Lightbulb; title: string; description: string }
> = {
  idea: {
    icon: Lightbulb,
    title: "J'ai une idée à explorer",
    description: "Décrivez votre concept en quelques mots",
  },
  document: {
    icon: FileText,
    title: "J'ai un pitch ou un brief",
    description: "Uploadez votre pitch deck ou business plan",
  },
  developing: {
    icon: GitBranch,
    title: "Je suis en train de le développer",
    description: "Connectez votre repo GitHub public",
  },
  live: {
    icon: Globe,
    title: "Mon produit est en ligne",
    description: "Donnez-nous votre URL",
  },
};

const LOADING_MESSAGE: Record<ProjectStage, string> = {
  idea: "Analyse de votre concept…",
  document: "Lecture de votre document…",
  developing: "Lecture de votre repo…",
  live: "Analyse de votre site…",
};

const CATEGORY_SUGGESTIONS = [
  "B2B SaaS",
  "DevTools",
  "Marketplace",
  "Consumer",
  "Fintech",
  "Productivity",
  "AI/ML",
  "Healthcare",
  "Education",
];

const SOURCE_DEF: Record<SourceType, { label: string; description: string }> = {
  homepage: { label: "Homepage", description: "Repositioning and messaging changes." },
  pricing: { label: "Pricing", description: "Prices, new plans or modified tiers." },
  blog: { label: "Blog", description: "Product announcements and strategic content." },
};

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isGitHubRepoUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return false;
    return u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function fallbackFromError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 422 &&
    (err.data as { fallback?: unknown }).fallback === "description"
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown; error?: unknown };
    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string" && !data.error.startsWith("plan_")) return data.error;
    if (err.status === 401) return "Session expired. Please sign in again.";
    if (err.status === 429) return "Too many requests. Wait a few seconds before trying again.";
    if (err.status >= 500) return "The server encountered an error. Try again in a moment.";
    return err.message;
  }
  if (err instanceof Error) {
    if (err.name === "TypeError" || err.message.toLowerCase().includes("fetch"))
      return "Cannot connect to the server. Check your network connection.";
    return err.message;
  }
  return String(err);
}

export function OnboardingForm({
  plan,
  initialStage,
  initialStep,
  initialProfile,
}: {
  plan: Plan;
  initialStage: ProjectStage | null;
  initialStep: OnboardingStep | null;
  initialProfile: ProductProfile | null;
}) {
  const router = useRouter();
  const planLimits = PLAN_LIMITS[plan];
  const maxCompetitors = planLimits.maxCompetitors;
  const allowedFrequencies = planLimits.allowedFrequencies;
  const discoveryDisabled = useFeatureFlagEnabled("kill-switch-discovery");

  // Resume: jump to the saved step when we already have a profile; otherwise
  // start at stage selection. discover/monitoring resume one step back (to
  // profile) is avoided — we resume to discover and re-run discovery, since
  // the competitor list isn't persisted server-side.
  const initialScreen: Screen = (() => {
    if (initialProfile && initialStep === "profile") return "profile";
    if (initialProfile && (initialStep === "discover" || initialStep === "monitoring"))
      return "discover";
    return "stage";
  })();

  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [stage, setStage] = useState<ProjectStage | null>(initialStage);
  const [busy, setBusy] = useState<null | "analyze" | "discover" | "complete">(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackOffer, setFallbackOffer] = useState<{ prefill: string } | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  // Mode inputs (1-bis) — kept across back navigation within the same session.
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [inspirations, setInspirations] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [productUrl, setProductUrl] = useState("");

  // Downstream state
  const [profile, setProfile] = useState<ProductProfile | null>(initialProfile);
  const [committedUrl, setCommittedUrl] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState<Selection[]>([]);
  // Trashed rows are kept aside (not dropped) so they can be saved as
  // "dismissed" candidates on complete — a remembered rejection.
  const [removed, setRemoved] = useState<Selection[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [frequency, setFrequency] = useState<Frequency>(
    allowedFrequencies.includes("daily") ? "daily" : "weekly",
  );
  const [sources, setSources] = useState<SourceType[]>(["homepage", "pricing", "blog"]);

  useEffect(() => {
    track("onboarding_started");
  }, []);

  // Persist progress on each screen transition (fire-and-forget).
  const goTo = useCallback((next: Screen) => {
    setError(null);
    setScreen(next);
    void api.patchOnboardingProgress(next as OnboardingStep).catch(() => {});
  }, []);

  async function handleSignOut() {
    await signOut();
    resetUser();
    router.push("/login");
  }

  async function handleSkip() {
    try {
      await api.skipOnboarding();
      router.push("/dashboard");
    } catch (e) {
      setError(extractMessage(e));
    }
  }

  function restart() {
    setError(null);
    setFallbackOffer(null);
    setStage(null);
    setProfile(null);
    setCompetitors([]);
    setRemoved([]);
    setCommittedUrl(null);
    goTo("stage");
  }

  function chooseStage(s: ProjectStage) {
    setStage(s);
    setError(null);
    setFallbackOffer(null);
    goTo("input");
  }

  // ── Analyze (per mode) ─────────────────────────────────────────────────
  function onProfileReady(p: ProductProfile, url: string | null) {
    setProfile(p);
    setCommittedUrl(url);
    setCompetitors([]);
    setRemoved([]);
    track("onboarding_product_analyzed");
    goTo("profile");
  }

  function handleAnalyzeError(e: unknown, prefill: string) {
    if (fallbackFromError(e)) {
      toast.error("L'analyse automatique n'a pas abouti.");
      setFallbackOffer({ prefill });
      return;
    }
    setError(extractMessage(e));
  }

  async function analyze() {
    if (!stage) return;
    setError(null);
    setBusy("analyze");
    try {
      if (stage === "idea") {
        const insp = inspirations
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3);
        const res = await api.analyzeDescription({
          description,
          category: category.trim() || undefined,
          inspirations: insp.length ? insp : undefined,
        });
        onProfileReady(res.profile, null);
      } else if (stage === "document") {
        if (!file) {
          setError("Sélectionnez un fichier.");
          return;
        }
        const res = await api.analyzeDocument(file);
        onProfileReady(res.profile, null);
      } else if (stage === "developing") {
        const res = await api.analyzeRepo(repoUrl.trim());
        onProfileReady(res.profile, null);
      } else {
        const res = await api.analyzeUrl(productUrl.trim());
        onProfileReady(res.profile, productUrl.trim());
      }
    } catch (e) {
      const prefill =
        stage === "developing"
          ? repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "")
          : stage === "live"
            ? productUrl
            : description;
      handleAnalyzeError(e, prefill);
    } finally {
      setBusy(null);
    }
  }

  function acceptDescriptionFallback() {
    const prefill = fallbackOffer?.prefill ?? "";
    setFallbackOffer(null);
    setStage("idea");
    setDescription((d) => d || prefill);
    setError(null);
    goTo("input");
  }

  // ── Discovery ──────────────────────────────────────────────────────────
  const runDiscovery = useCallback(
    async (p: ProductProfile, url: string | null) => {
      if (discoveryDisabled) {
        setError(
          "Discovery is temporarily disabled. Add competitors manually after onboarding.",
        );
        return;
      }
      setBusy("discover");
      try {
        const res = await api.discoverCompetitors(p, url);
        const sorted = [...res.competitors].sort((a, b) => b.overlapScore - a.overlapScore);
        let picked = 0;
        setRemoved([]);
        setCompetitors(
          sorted.map((c) => {
            const wantSelect = c.overlapScore > 60 && picked < maxCompetitors;
            if (wantSelect) picked += 1;
            return { ...c, selected: wantSelect };
          }),
        );
        track("onboarding_competitors_found", { count: sorted.length });
      } catch (e) {
        setError(extractMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [discoveryDisabled, maxCompetitors],
  );

  async function handleProfileConfirm() {
    if (!profile) return;
    setError(null);
    const empty = (["category", "audience", "valueProp", "pricingModel"] as const).filter(
      (k) => !profile[k].trim(),
    );
    if (empty.length > 0) {
      setError("Tous les champs sont requis. Complétez ceux qui sont vides.");
      return;
    }
    try {
      await api.patchProductProfile(profile);
    } catch (e) {
      setError(extractMessage(e));
      return;
    }
    goTo("discover");
    await runDiscovery(profile, committedUrl);
  }

  // Auto-run discovery when entering an empty discover screen (resume / back-nav).
  const discoverRan = useRef(false);
  useEffect(() => {
    if (screen !== "discover") {
      discoverRan.current = false;
      return;
    }
    if (
      !discoverRan.current &&
      competitors.length === 0 &&
      profile &&
      busy === null &&
      !discoveryDisabled
    ) {
      discoverRan.current = true;
      void runDiscovery(profile, committedUrl);
    }
  }, [screen, competitors.length, profile, busy, discoveryDisabled, committedUrl, runDiscovery]);

  // ── Step 3 helpers ─────────────────────────────────────────────────────
  const selectedCount = competitors.filter((c) => c.selected).length;

  function showCompetitorLimitPaywall(used: number) {
    setPaywall({ code: "plan_limit_competitors", plan, limit: maxCompetitors, used });
  }

  function toggleCompetitor(url: string) {
    setCompetitors((prev) => {
      const target = prev.find((c) => c.url === url);
      if (!target) return prev;
      if (!target.selected) {
        const current = prev.filter((c) => c.selected).length;
        if (current >= maxCompetitors) {
          showCompetitorLimitPaywall(current);
          return prev;
        }
      }
      return prev.map((c) => (c.url === url ? { ...c, selected: !c.selected } : c));
    });
  }

  function removeCompetitor(url: string) {
    setCompetitors((prev) => {
      const target = prev.find((c) => c.url === url);
      if (target) {
        setRemoved((r) => (r.some((x) => x.url === url) ? r : [...r, target]));
      }
      return prev.filter((c) => c.url !== url);
    });
  }

  function addManualCompetitor() {
    const trimmed = manualUrl.trim();
    if (!isValidUrl(trimmed)) {
      setError("URL invalide.");
      return;
    }
    if (competitors.some((c) => c.url === trimmed)) {
      setError("Ce concurrent est déjà dans la liste.");
      return;
    }
    const current = competitors.filter((c) => c.selected).length;
    if (current >= maxCompetitors) {
      showCompetitorLimitPaywall(current);
      return;
    }
    const u = new URL(trimmed);
    setCompetitors((prev) => [
      {
        url: trimmed,
        title: u.hostname.replace(/^www\./, ""),
        snippet: "Ajouté manuellement.",
        overlapScore: 0,
        reason: "Manual",
        selected: true,
      },
      ...prev,
    ]);
    setManualUrl("");
    setError(null);
  }

  function handleCompetitorsConfirm() {
    if (selectedCount === 0) {
      setError("Sélectionnez au moins un concurrent.");
      return;
    }
    goTo("monitoring");
  }

  function toggleSource(s: SourceType) {
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function selectFrequency(f: Frequency) {
    if (!allowedFrequencies.includes(f)) {
      setPaywall({ code: "plan_locked_frequency", plan, frequency: f });
      return;
    }
    setFrequency(f);
  }

  async function handleComplete() {
    if (sources.length === 0) {
      setError("Sélectionnez au moins une source à surveiller.");
      return;
    }
    const selected = competitors.filter((c) => c.selected);
    if (selected.length === 0) {
      setError("Aucun concurrent sélectionné. Revenez à l'étape précédente.");
      return;
    }
    // Discovered-but-untracked → saved as "new" candidates; trashed → "dismissed".
    const toCandidate = (c: Selection) => ({
      url: c.url,
      title: c.title || undefined,
      overlapScore: c.overlapScore || undefined,
      reason: c.reason || undefined,
    });
    setBusy("complete");
    try {
      await api.completeOnboarding({
        selectedCompetitors: selected.map((c) => {
          const u = new URL(c.url);
          return {
            name: c.title || u.hostname,
            url: c.url,
            overlapScore: c.overlapScore || undefined,
          };
        }),
        savedCandidates: competitors.filter((c) => !c.selected).map(toCandidate),
        dismissedCandidates: removed.map(toCandidate),
        monitoringPrefs: { frequency, sources },
      });
      track("onboarding_completed", { competitorCount: selected.length });
      setScreen("done");
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) setPaywall(reason);
      else setError(extractMessage(e));
      setBusy(null);
    }
  }

  const currentStep = SCREEN_TO_STEP[screen];

  return (
    <div className="min-h-screen flex flex-col bg-background-2">
      <Header
        onSignOut={handleSignOut}
        onRestart={restart}
        onSkip={handleSkip}
        showControls={screen !== "done"}
      />

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 sm:px-8 py-8 sm:py-12">
        {screen !== "done" && <ProgressBar step={currentStep} />}

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {fallbackOffer && (
          <FallbackOffer
            onAccept={acceptDescriptionFallback}
            onDismiss={() => setFallbackOffer(null)}
          />
        )}

        <div className="mt-8">
          {screen === "stage" && <StageChooser onChoose={chooseStage} current={stage} />}

          {screen === "input" && stage && (
            <ModeForm
              stage={stage}
              busy={busy === "analyze"}
              onAnalyze={analyze}
              onBack={() => goTo("stage")}
              description={description}
              setDescription={setDescription}
              category={category}
              setCategory={setCategory}
              inspirations={inspirations}
              setInspirations={setInspirations}
              file={file}
              setFile={setFile}
              repoUrl={repoUrl}
              setRepoUrl={setRepoUrl}
              productUrl={productUrl}
              setProductUrl={setProductUrl}
              onSwitchToRepo={() => chooseStage("developing")}
            />
          )}

          {screen === "profile" && profile && (
            <ProfileForm
              profile={profile}
              setProfile={setProfile}
              onConfirm={handleProfileConfirm}
              onBack={() => goTo("input")}
              busy={busy === "discover"}
            />
          )}

          {screen === "discover" && (
            <DiscoverStep
              competitors={competitors}
              busy={busy === "discover"}
              selectedCount={selectedCount}
              maxCompetitors={maxCompetitors}
              plan={plan}
              toggleCompetitor={toggleCompetitor}
              removeCompetitor={removeCompetitor}
              manualUrl={manualUrl}
              setManualUrl={setManualUrl}
              addManualCompetitor={addManualCompetitor}
              onConfirm={handleCompetitorsConfirm}
              onBack={() => goTo("profile")}
              onRefine={() => goTo("profile")}
            />
          )}

          {screen === "monitoring" && (
            <MonitoringStep
              frequency={frequency}
              setFrequency={selectFrequency}
              allowedFrequencies={allowedFrequencies}
              plan={plan}
              sources={sources}
              toggleSource={toggleSource}
              selectedCount={selectedCount}
              busy={busy === "complete"}
              onConfirm={handleComplete}
              onBack={() => goTo("discover")}
            />
          )}

          {screen === "done" && (
            <DoneStep totalCompetitors={selectedCount} onDashboard={() => router.push("/dashboard")} />
          )}
        </div>
      </main>

      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────

function Header({
  onSignOut,
  onRestart,
  onSkip,
  showControls,
}: {
  onSignOut: () => void | Promise<void>;
  onRestart: () => void;
  onSkip: () => void | Promise<void>;
  showControls: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background-2/85 backdrop-blur supports-[backdrop-filter]:bg-background-2/65">
      <div className="mx-auto max-w-3xl px-4 sm:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="text-base font-semibold font-[var(--font-display)] tracking-tight">
          <span className="text-muted-foreground">Out</span>rival
        </Link>
        <div className="flex items-center gap-1">
          {showControls && (
            <>
              <Button variant="ghost" size="sm" onClick={onRestart}>
                <RotateCcw size={14} /> Recommencer
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void onSkip()}>
                <LogOut size={14} /> Quitter pour l'instant
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Configuration en moins de 3 minutes
        </span>
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Étape {step} sur 5
        </span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              n < step ? "bg-foreground" : n === step ? "bg-foreground/60" : "bg-border-strong",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
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

function FallbackOffer({ onAccept, onDismiss }: { onAccept: () => void; onDismiss: () => void }) {
  return (
    <div className="mt-6 flex items-start gap-3 rounded-md border border-border-strong bg-surface-2/60 px-4 py-3">
      <Sparkles size={16} className="mt-0.5 text-foreground shrink-0" />
      <div className="flex-1">
        <p className="text-sm text-foreground">Décrivez plutôt votre produit en quelques mots.</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={onAccept}>
            Continuer en mode description
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Réessayer
          </Button>
        </div>
      </div>
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
            <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
              <ArrowLeft size={14} /> Modifier
            </Button>
          )}
        </div>
        <Button type="button" onClick={() => void onSubmit()} disabled={busy || primaryDisabled}>
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

// ── Screen: stage chooser ────────────────────────────────────────────────

function StageChooser({
  onChoose,
  current,
}: {
  onChoose: (s: ProjectStage) => void;
  current: ProjectStage | null;
}) {
  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight font-[var(--font-display)]">
        Où en êtes-vous avec votre projet ?
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        Chaque point de départ ouvre une façon adaptée de nous décrire votre produit.
      </p>
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(Object.keys(STAGE_META) as ProjectStage[]).map((s) => {
          const meta = STAGE_META[s];
          const Icon = meta.icon;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChoose(s)}
              aria-pressed={current === s}
              className={cn(
                "text-left p-5 rounded-md border transition-all",
                current === s
                  ? "border-foreground bg-foreground/5 ring-1 ring-foreground/40"
                  : "border-border hover:border-border-strong hover:bg-surface-2",
              )}
            >
              <Icon size={20} className="text-foreground" />
              <p className="text-sm font-medium mt-3">{meta.title}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {meta.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Screen: mode form (1-bis) ────────────────────────────────────────────

function ModeForm({
  stage,
  busy,
  onAnalyze,
  onBack,
  description,
  setDescription,
  category,
  setCategory,
  inspirations,
  setInspirations,
  file,
  setFile,
  repoUrl,
  setRepoUrl,
  productUrl,
  setProductUrl,
  onSwitchToRepo,
}: {
  stage: ProjectStage;
  busy: boolean;
  onAnalyze: () => void | Promise<void>;
  onBack: () => void;
  description: string;
  setDescription: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  inspirations: string;
  setInspirations: (v: string) => void;
  file: File | null;
  setFile: (f: File | null) => void;
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  productUrl: string;
  setProductUrl: (v: string) => void;
  onSwitchToRepo: () => void;
}) {
  const temp = stage === "live" && productUrl ? detectTemporaryUrl(productUrl) : { temporary: false };

  const canSubmit =
    stage === "idea"
      ? description.trim().length >= 10
      : stage === "document"
        ? file !== null
        : stage === "developing"
          ? isGitHubRepoUrl(repoUrl.trim())
          : isValidUrl(productUrl.trim());

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight font-[var(--font-display)]">
        {STAGE_META[stage].title}
      </h1>

      <Card className="mt-6 p-6 sm:p-8 flex flex-col gap-5">
        {stage === "idea" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description" className="text-sm">
                Décrivez votre concept
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: un outil de veille concurrentielle pour les startups B2B SaaS…"
                rows={4}
                maxLength={600}
                disabled={busy}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">~ 300 caractères suffisent.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category" className="text-sm">
                Catégorie
              </Label>
              <Input
                id="category"
                list="category-suggestions"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="B2B SaaS, DevTools, Marketplace…"
                disabled={busy}
              />
              <datalist id="category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inspirations" className="text-sm">
                Vous vous inspirez de… <span className="text-muted-foreground">(optionnel)</span>
              </Label>
              <Input
                id="inspirations"
                value={inspirations}
                onChange={(e) => setInspirations(e.target.value)}
                placeholder="Linear, Crayon (jusqu'à 3, séparés par des virgules)"
                disabled={busy}
              />
            </div>
          </>
        )}

        {stage === "document" && (
          <>
            <label
              htmlFor="doc-file"
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong px-6 py-10 cursor-pointer transition-colors hover:bg-surface-2",
                busy && "pointer-events-none opacity-60",
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setFile(f);
              }}
            >
              <Upload size={20} className="text-muted-foreground" />
              <span className="text-sm text-foreground">
                {file ? file.name : "Déposez ou sélectionnez un fichier"}
              </span>
              <span className="text-xs text-muted-foreground">PDF, DOCX, MD, TXT — max 10MB</span>
              <input
                id="doc-file"
                type="file"
                accept=".pdf,.docx,.md,.markdown,.txt"
                className="hidden"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <div className="flex items-start gap-2 rounded-md border border-positive/30 bg-positive/10 px-4 py-3">
              <Lock size={15} className="mt-0.5 text-positive shrink-0" />
              <p className="text-xs text-foreground leading-relaxed">
                Votre document est analysé en mémoire et ne sera <strong>jamais stocké</strong>.
                Seul le profil produit extrait sera sauvegardé.
              </p>
            </div>
          </>
        )}

        {stage === "developing" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="repo-url" className="text-sm">
              URL du repo GitHub
            </Label>
            <Input
              id="repo-url"
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              disabled={busy}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Le repo doit être public. Vous pourrez connecter vos repos privés plus tard.
            </p>
          </div>
        )}

        {stage === "live" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-url" className="text-sm">
              URL de votre produit
            </Label>
            <Input
              id="product-url"
              type="url"
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="https://yourproduct.com"
              disabled={busy}
              autoFocus
            />
            {temp.temporary && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-border-strong bg-surface-2/60 px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 text-foreground shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-foreground">
                    On dirait une URL temporaire. Voulez-vous plutôt utiliser le mode « En
                    développement » avec votre repo ?
                  </p>
                  <Button size="sm" variant="ghost" className="mt-1" onClick={onSwitchToRepo}>
                    Changer de mode
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <FooterNav
        onBack={onBack}
        onSubmit={onAnalyze}
        busy={busy}
        busyLabel={LOADING_MESSAGE[stage]}
        primaryLabel="Analyser"
        primaryDisabled={!canSubmit}
        hint={busy ? "~ 3 à 15 secondes" : undefined}
      />
    </div>
  );
}

// ── Screen: profile (step 2) ─────────────────────────────────────────────

const PROFILE_FIELDS: Array<{
  key: keyof ProductProfile;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: "category", label: "Catégorie", placeholder: "ex: B2B SaaS CRM" },
  { key: "audience", label: "Audience cible", placeholder: "ex: Équipes sales de 10–200 personnes" },
  {
    key: "valueProp",
    label: "Proposition de valeur",
    placeholder: "Ce qui rend votre produit unique",
    multiline: true,
  },
  { key: "pricingModel", label: "Modèle de prix", placeholder: "ex: Freemium + Pro à 20$/mois" },
];

function ProfileForm({
  profile,
  setProfile,
  onConfirm,
  onBack,
  busy,
}: {
  profile: ProductProfile;
  setProfile: (p: ProductProfile) => void;
  onConfirm: () => void | Promise<void>;
  onBack: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight font-[var(--font-display)]">
        Avons-nous bien compris votre produit ?
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        Corrigez ce qui est inexact — cela améliore directement la pertinence des concurrents.
      </p>

      <div className="flex items-center gap-2 mt-6 mb-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        <Sparkles size={12} /> Extrait par l'IA
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
                onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                disabled={busy}
                rows={3}
              />
            ) : (
              <Input
                id={`field-${f.key}`}
                value={profile[f.key]}
                onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
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
        busyLabel="Recherche de concurrents…"
        primaryLabel="C'est correct"
        hint={busy ? "~ 15 à 30 secondes" : undefined}
      />
    </div>
  );
}

// ── Screen: discover (step 3) ────────────────────────────────────────────

function DiscoverStep({
  competitors,
  busy,
  selectedCount,
  maxCompetitors,
  plan,
  toggleCompetitor,
  removeCompetitor,
  manualUrl,
  setManualUrl,
  addManualCompetitor,
  onConfirm,
  onBack,
  onRefine,
}: {
  competitors: Selection[];
  busy: boolean;
  selectedCount: number;
  maxCompetitors: number;
  plan: Plan;
  toggleCompetitor: (url: string) => void;
  removeCompetitor: (url: string) => void;
  manualUrl: string;
  setManualUrl: (v: string) => void;
  addManualCompetitor: () => void;
  onConfirm: () => void;
  onBack: () => void;
  onRefine: () => void;
}) {
  const atLimit = selectedCount >= maxCompetitors;
  const limitLabel = Number.isFinite(maxCompetitors)
    ? `${selectedCount} / ${maxCompetitors}`
    : `${selectedCount}`;
  const noStrongMatch =
    !busy && competitors.length > 0 && competitors.every((c) => c.overlapScore < 30);

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight font-[var(--font-display)]">
        Vos concurrents
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        Cochez ceux qui comptent vraiment — vous pourrez en ajouter ou retirer plus tard.
      </p>

      {noStrongMatch && (
        <div className="mt-6 flex items-start gap-3 rounded-md border border-border-strong bg-surface-2/60 px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 text-foreground shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-foreground">On n'a pas trouvé de concurrents évidents.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={onRefine}>
                Affiner mon profil
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-6 mb-3 gap-3 flex-wrap">
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {busy ? "Recherche…" : `${competitors.length} trouvés · ${limitLabel} sélectionnés`}
        </p>
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Plan {PLAN_LABELS[plan]}
        </p>
      </div>

      <Card className="p-2 sm:p-3 max-h-[420px] overflow-auto">
        {busy ? (
          <div className="px-4 py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Analyse de votre marché…
          </div>
        ) : competitors.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Aucun concurrent suggéré. Ajoutez-en manuellement ci-dessous.
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

      <div className="mt-6">
        <Label htmlFor="manual-url" className="text-sm mb-2 block">
          Ajouter un concurrent manuellement
        </Label>
        <div className="flex gap-2">
          <Input
            id="manual-url"
            type="url"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://autre-concurrent.com"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManualCompetitor();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addManualCompetitor}>
            <Plus size={14} /> Ajouter
          </Button>
        </div>
      </div>

      {competitors.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
          Les concurrents découverts mais non sélectionnés restent disponibles dans{" "}
          <span className="text-foreground">Détections</span> — vous pourrez les suivre plus tard
          (par exemple après un changement de plan).
        </p>
      )}

      <FooterNav
        onBack={onBack}
        onSubmit={onConfirm}
        primaryLabel="Continuer"
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
        "flex items-start gap-3 px-3 py-3 rounded-md cursor-pointer transition-colors hover:bg-surface-2",
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
          <span className="text-sm font-medium truncate">{competitor.title}</span>
          {competitor.overlapScore > 0 && <OverlapBadge score={competitor.overlapScore} />}
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

// ── Screen: monitoring (step 4) ──────────────────────────────────────────

function MonitoringStep({
  frequency,
  setFrequency,
  allowedFrequencies,
  plan,
  sources,
  toggleSource,
  selectedCount,
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
  busy: boolean;
  onConfirm: () => void | Promise<void>;
  onBack: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight font-[var(--font-display)]">
        Préférences de monitoring
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        On a pré-sélectionné des réglages adaptés. Validez ou personnalisez.
      </p>

      <Card className="mt-6 p-6 sm:p-8 flex flex-col gap-4">
        <ul className="text-sm text-foreground flex flex-col gap-1.5">
          <li>
            <span className="text-muted-foreground">Concurrents suivis : </span>
            {selectedCount}
          </li>
          <li>
            <span className="text-muted-foreground">Fréquence : </span>
            {frequency === "daily" ? "Quotidien" : "Hebdomadaire"}
          </li>
          <li>
            <span className="text-muted-foreground">Sources : </span>
            {sources.length > 0 ? sources.map((s) => SOURCE_DEF[s].label).join(" · ") : "—"}
          </li>
        </ul>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown size={13} className={cn("transition-transform", advanced && "rotate-180")} />
          Personnaliser les préférences avancées
        </button>

        {advanced && (
          <div className="flex flex-col gap-6 pt-2 border-t border-border">
            <section>
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Fréquence · Plan {PLAN_LABELS[plan]}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(["daily", "weekly"] as const).map((f) => (
                  <SegmentChoice
                    key={f}
                    active={frequency === f}
                    locked={!allowedFrequencies.includes(f)}
                    onClick={() => setFrequency(f)}
                    title={f === "daily" ? "Quotidien" : "Hebdomadaire"}
                    description={
                      f === "daily" ? "Scrape une fois par jour. Recommandé." : "Une fois par semaine."
                    }
                    variant="radio"
                  />
                ))}
              </div>
            </section>
            <section>
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Sources à surveiller
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(["homepage", "pricing", "blog"] as const).map((s) => (
                  <SegmentChoice
                    key={s}
                    active={sources.includes(s)}
                    onClick={() => toggleSource(s)}
                    title={SOURCE_DEF[s].label}
                    description={SOURCE_DEF[s].description}
                    variant="check"
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </Card>

      <FooterNav
        onBack={onBack}
        onSubmit={onConfirm}
        busy={busy}
        busyLabel="Configuration…"
        primaryLabel="Lancer le monitoring"
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
              active ? "bg-foreground border-foreground" : "bg-transparent border-border-strong",
            )}
          >
            {active && <span className="w-1.5 h-1.5 rounded-full bg-background" />}
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
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{description}</p>
    </button>
  );
}

// ── Screen: done (step 5, first session) ─────────────────────────────────

function DoneStep({
  totalCompetitors,
  onDashboard,
}: {
  totalCompetitors: number;
  onDashboard: () => void;
}) {
  const [analyzed, setAnalyzed] = useState(0);

  useEffect(() => {
    let active = true;
    let tries = 0;
    async function poll() {
      try {
        const { competitors } = await api.listCompetitors();
        if (!active) return;
        // Best-effort progress proxy: a competitor counts as analyzed once it has
        // an AI summary (first scrape → classify → summary pipeline produced output).
        setAnalyzed(competitors.filter((c) => c.aiSummary != null).length);
      } catch {
        // ignore — indicator is informational
      }
    }
    void poll();
    const id = setInterval(() => {
      tries += 1;
      if (!active || tries > 40) {
        clearInterval(id);
        return;
      }
      void poll();
    }, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const allDone = totalCompetitors > 0 && analyzed >= totalCompetitors;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full bg-positive/15 border border-positive/30 flex items-center justify-center">
        <Check size={22} className="text-positive" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-5 font-[var(--font-display)]">
        Configuration terminée
      </h1>
      <p className="text-sm text-muted-foreground mt-3 max-w-md">
        Vos concurrents sont en cours d'analyse. Le premier snapshot est lancé — vous verrez les
        premiers signaux apparaître dans le feed dans quelques minutes.
      </p>

      <div className="mt-6 inline-flex items-center gap-2 rounded-md border border-border bg-surface-2/60 px-4 py-2">
        {!allDone && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        {allDone && <Check size={14} className="text-positive" />}
        <span className="text-sm text-foreground">
          {analyzed}/{totalCompetitors} concurrents analysés
        </span>
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        Votre premier digest hebdomadaire vous sera envoyé lundi prochain.
      </p>

      <Card className="mt-8 w-full max-w-md p-5 text-left">
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
          Prochaines étapes recommandées
        </p>
        <ul className="flex flex-col gap-2 text-sm text-foreground">
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-sm border border-border-strong" /> Configurer votre
            webhook Slack pour les alertes temps-réel
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-sm border border-border-strong" /> Inviter un coéquipier
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-sm border border-border-strong" /> Personnaliser votre
            fréquence de monitoring
          </li>
        </ul>
      </Card>

      <Button className="mt-8" onClick={onDashboard}>
        Aller au dashboard <ArrowRight size={14} />
      </Button>
    </div>
  );
}
