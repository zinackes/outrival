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
  Bell,
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
  Package,
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
  type OnboardingMode,
  type OnboardingStep,
  type ProductProfile,
  type ProjectStage,
} from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { resetUser } from "@/lib/posthog/events";
import {
  ONBOARDING_EVENTS,
  milestoneKey,
  trackOnboarding,
} from "@/lib/posthog/onboarding-events";
import { useOnboardingSession } from "@/hooks/use-onboarding-session";
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
    title: "I have an idea to explore",
    description: "Describe your concept in a few words",
  },
  document: {
    icon: FileText,
    title: "I have a pitch or a brief",
    description: "Upload your pitch deck or business plan",
  },
  developing: {
    icon: GitBranch,
    title: "I'm building it",
    description: "Connect your public GitHub repo",
  },
  live: {
    icon: Globe,
    title: "My product is live",
    description: "Give us your URL",
  },
};

const LOADING_MESSAGE: Record<ProjectStage, string> = {
  idea: "Analyzing your concept…",
  document: "Reading your document…",
  developing: "Reading your repo…",
  live: "Analyzing your site…",
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

// A scanned / image-only document (no text layer) yields no extractable text — a
// dead end retrying won't fix. Surface that precisely so the user picks another
// path instead of re-uploading the same file; null → generic fallback message.
function unreadableDocumentMessage(err: unknown): string | null {
  if (err instanceof ApiError && (err.data as { reason?: unknown }).reason === "unreadable_document") {
    return "We couldn't find any selectable text in that file — it looks scanned or image-based. Paste a short description instead, or upload a PDF with selectable text, a .docx, .md, or .txt.";
  }
  return null;
}

// Patch-25 hybrid parallelization: prefetch discovery in the background while
// the user reviews/edits the profile. Default on; debounce avoids re-billing Exa
// on every keystroke.
const PARALLEL_DISCOVERY = process.env.NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY !== "false";
const DISCOVERY_DEBOUNCE_MS =
  Number(process.env.NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS ?? 3000) || 3000;

// Identity of a discovery input — a prefetch is reusable only for the exact same
// profile + URL, so editing any field invalidates it (and re-bills, debounced).
function profileKey(p: ProductProfile, url: string | null): string {
  return JSON.stringify([p.category, p.audience, p.valueProp, p.pricingModel, url]);
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
  const { session, sessionId, updateSession } = useOnboardingSession();
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

  // Background discovery prefetch (patch-25): status drives the discreet profile
  // indicator; refs hold the in-flight controller and the last completed result.
  const [discoveryStatus, setDiscoveryStatus] = useState<"idle" | "running" | "completed">("idle");
  const prefetchRef = useRef<{ key: string; competitors: DiscoveredCompetitor[] } | null>(null);
  const prefetchAbort = useRef<AbortController | null>(null);

  // Onboarding mode (patch-25): quick_start (default) keeps to the essentials;
  // "Customize more" switches to full and opens the advanced monitoring controls.
  const [mode, setMode] = useState<OnboardingMode>("quick_start");
  const modeAdopted = useRef(false);
  useEffect(() => {
    if (session?.mode && !modeAdopted.current) {
      modeAdopted.current = true;
      setMode(session.mode);
    }
  }, [session?.mode]);

  function enableFullMode() {
    if (mode === "full") return;
    setMode("full");
    void updateSession({ mode: "full" });
  }

  // Fire onboarding_started once the session id is known (so every funnel event
  // shares it). The session loads async; this waits for it.
  const startedFired = useRef(false);
  useEffect(() => {
    if (sessionId && !startedFired.current) {
      startedFired.current = true;
      trackOnboarding(ONBOARDING_EVENTS.STARTED, sessionId);
    }
  }, [sessionId]);

  // Persist progress on each screen transition (fire-and-forget). Mirrors the
  // step onto both the org (routing gate) and the onboarding session (resume +
  // metrics). "done" isn't a session stage — /complete flips it to analysis.
  const goTo = useCallback(
    (next: Screen) => {
      setError(null);
      setScreen(next);
      void api.patchOnboardingProgress(next as OnboardingStep).catch(() => {});
      // The wizard's first screen ("stage", project-stage pick) is the session's
      // "started" stage; the other screens share their literal name with the stage.
      // "done" isn't a session stage — /complete flips it to analysis.
      if (next !== "done") {
        void updateSession({ stage: next === "stage" ? "started" : next });
      }
    },
    [updateSession],
  );

  async function handleSignOut() {
    await signOut();
    resetUser();
    router.push("/auth");
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
    trackOnboarding(ONBOARDING_EVENTS.PRODUCT_ANALYZED, sessionId);
    void updateSession({
      productProfile: p,
      productUrl: url,
      timings: { [milestoneKey(ONBOARDING_EVENTS.PRODUCT_ANALYZED)]: Date.now() },
    });
    goTo("profile");
  }

  function handleAnalyzeError(e: unknown, prefill: string) {
    if (fallbackFromError(e)) {
      toast.error(unreadableDocumentMessage(e) ?? "Automatic analysis didn't work out.");
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
          setError("Select a file.");
          return;
        }
        const res = await api.analyzeDocument(file);
        onProfileReady(res.profile, null);
      } else if (stage === "developing") {
        const res = await api.analyzeRepo(repoUrl.trim());
        onProfileReady(res.profile, null);
      } else {
        trackOnboarding(ONBOARDING_EVENTS.PRODUCT_URL_SUBMITTED, sessionId);
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
  // Apply a discovery result set (network or background prefetch) to the UI:
  // sort by overlap, pre-select the strongest up to the plan limit, persist the
  // suggestions and stamp the discovery_completed milestone.
  const applyDiscovered = useCallback(
    (found: DiscoveredCompetitor[]) => {
      const sorted = [...found].sort((a, b) => b.overlapScore - a.overlapScore);
      let picked = 0;
      setRemoved([]);
      setCompetitors(
        sorted.map((c) => {
          const wantSelect = c.overlapScore > 60 && picked < maxCompetitors;
          if (wantSelect) picked += 1;
          return { ...c, selected: wantSelect };
        }),
      );
      trackOnboarding(ONBOARDING_EVENTS.DISCOVERY_COMPLETED, sessionId, { count: sorted.length });
      void updateSession({
        discoverySuggestions: sorted,
        timings: { [milestoneKey(ONBOARDING_EVENTS.DISCOVERY_COMPLETED)]: Date.now() },
      });
    },
    [maxCompetitors, sessionId, updateSession],
  );

  const runDiscovery = useCallback(
    async (p: ProductProfile, url: string | null) => {
      if (discoveryDisabled) {
        setError(
          "Discovery is temporarily disabled. Add competitors manually after onboarding.",
        );
        return;
      }
      setBusy("discover");
      trackOnboarding(ONBOARDING_EVENTS.DISCOVERY_STARTED, sessionId, { trigger: "confirm" });
      void updateSession({
        timings: { [milestoneKey(ONBOARDING_EVENTS.DISCOVERY_STARTED)]: Date.now() },
      });
      try {
        const res = await api.discoverCompetitors(p, url);
        applyDiscovered(res.competitors);
      } catch (e) {
        setError(extractMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [discoveryDisabled, sessionId, updateSession, applyDiscovered],
  );

  // Prefetch discovery in the background while the user reviews the profile, so
  // confirming is often instant. Debounced + abortable: each profile edit cancels
  // the in-flight request and reschedules; a result is cached by profile identity.
  useEffect(() => {
    if (!PARALLEL_DISCOVERY || screen !== "profile" || !profile || discoveryDisabled) return;
    const key = profileKey(profile, committedUrl);
    if (prefetchRef.current?.key === key) {
      setDiscoveryStatus("completed");
      return;
    }
    setDiscoveryStatus("idle");
    const timer = setTimeout(() => {
      const controller = new AbortController();
      prefetchAbort.current = controller;
      setDiscoveryStatus("running");
      trackOnboarding(ONBOARDING_EVENTS.DISCOVERY_STARTED, sessionId, { trigger: "background" });
      api
        .discoverCompetitors(profile, committedUrl, controller.signal)
        .then((res) => {
          if (prefetchAbort.current !== controller) return;
          prefetchRef.current = { key, competitors: res.competitors };
          setDiscoveryStatus("completed");
        })
        .catch(() => {
          if (prefetchAbort.current !== controller) return;
          setDiscoveryStatus("idle");
        });
    }, DISCOVERY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      prefetchAbort.current?.abort();
      prefetchAbort.current = null;
    };
  }, [screen, profile, committedUrl, discoveryDisabled, sessionId]);

  async function handleProfileConfirm() {
    if (!profile) return;
    setError(null);
    const empty = (["category", "audience", "valueProp", "pricingModel"] as const).filter(
      (k) => !profile[k].trim(),
    );
    if (empty.length > 0) {
      setError("All fields are required. Fill in the empty ones.");
      return;
    }
    try {
      await api.patchProductProfile(profile);
    } catch (e) {
      setError(extractMessage(e));
      return;
    }
    trackOnboarding(ONBOARDING_EVENTS.PRODUCT_PROFILE_CONFIRMED, sessionId);
    void updateSession({
      timings: { [milestoneKey(ONBOARDING_EVENTS.PRODUCT_PROFILE_CONFIRMED)]: Date.now() },
    });
    const key = profileKey(profile, committedUrl);
    goTo("discover");
    // If the background prefetch already resolved for this exact profile, use it
    // (instant); otherwise fall back to a synchronous discovery on the next screen.
    if (prefetchRef.current?.key === key) {
      applyDiscovered(prefetchRef.current.competitors);
    } else {
      await runDiscovery(profile, committedUrl);
    }
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
      setError("Invalid URL.");
      return;
    }
    if (competitors.some((c) => c.url === trimmed)) {
      setError("This competitor is already in the list.");
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
        snippet: "Added manually.",
        overlapScore: 0,
        reason: "Manual",
        selected: true,
      },
      ...prev,
    ]);
    setManualUrl("");
    setError(null);
    trackOnboarding(ONBOARDING_EVENTS.COMPETITOR_ADDED, sessionId, { source: "manual" });
  }

  function handleCompetitorsConfirm() {
    if (selectedCount === 0) {
      setError("Select at least one competitor.");
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
      setError("Select at least one source to monitor.");
      return;
    }
    const selected = competitors.filter((c) => c.selected);
    if (selected.length === 0) {
      setError("No competitor selected. Go back to the previous step.");
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
        onboardingSessionId: sessionId ?? undefined,
      });
      trackOnboarding(ONBOARDING_EVENTS.COMPETITORS_FINALIZED, sessionId, {
        competitorCount: selected.length,
        mode,
      });
      void updateSession({
        timings: { [milestoneKey(ONBOARDING_EVENTS.COMPETITORS_FINALIZED)]: Date.now() },
      });
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
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Ambient accent glow, matching the /auth surface — the welcome moment a
          first-run flow is licensed to have. Rationed, aria-hidden, behind content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 overflow-hidden"
      >
        <div className="absolute left-1/2 top-[-40%] size-[640px] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-[140px]" />
      </div>

      <Header
        onSignOut={handleSignOut}
        onRestart={restart}
        onSkip={handleSkip}
        showControls={screen !== "done"}
      />

      <main className="relative z-10 flex-1 mx-auto w-full max-w-3xl px-4 sm:px-8 py-8 sm:py-12">
        {screen !== "done" && <ProgressBar step={currentStep} />}

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {fallbackOffer && (
          <FallbackOffer
            onAccept={acceptDescriptionFallback}
            onDismiss={() => setFallbackOffer(null)}
          />
        )}

        <div
          key={screen}
          className="mt-8 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out"
        >
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
              prefetchStatus={discoveryStatus}
              mode={mode}
              onCustomize={enableFullMode}
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
              defaultAdvanced={mode === "full"}
              multiProduct={mode === "full"}
            />
          )}

          {screen === "done" && (
            <DoneStep
              totalCompetitors={selectedCount}
              plan={plan}
              onDashboard={() => {
                trackOnboarding(ONBOARDING_EVENTS.REDIRECT_TO_DASHBOARD, sessionId);
                router.push("/dashboard");
              }}
            />
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
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto max-w-3xl px-4 sm:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="text-base font-semibold font-[var(--font-display)] tracking-tight">
          <span className="text-foreground">out</span>
          <span className="text-primary">rival</span>
        </Link>
        <div className="flex items-center gap-1">
          {showControls && (
            <>
              <Button variant="ghost" size="sm" onClick={onRestart}>
                <RotateCcw size={14} /> Restart
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void onSkip()}>
                <LogOut size={14} /> Leave for now
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
        <span className="text-xs text-muted-foreground">
          Set up in under 3 minutes
        </span>
        <span className="text-xs text-muted-foreground">
          Step <span className="font-mono text-foreground">{step}</span> of{" "}
          <span className="font-mono">5</span>
        </span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              n <= step ? "bg-primary" : "bg-border-strong",
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
        <p className="text-sm text-foreground">Describe your product in a few words instead.</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={onAccept}>
            Continue in description mode
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Try again
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
              <ArrowLeft size={14} /> Edit
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
        <p className="text-xs text-muted-foreground mt-3 text-right">{hint}</p>
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
      <h1 className="text-title md:text-title-lg font-semibold">
        Where are you with your project?
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        Each starting point opens a way to describe your product that fits.
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
                  ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                  : "border-border hover:border-border-strong hover:bg-surface-2",
              )}
            >
              <Icon
                size={20}
                className={cn(
                  "transition-colors",
                  current === s ? "text-primary" : "text-foreground",
                )}
              />
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
      <h1 className="text-title md:text-title-lg font-semibold">
        {STAGE_META[stage].title}
      </h1>

      <Card className="mt-6 p-5 sm:p-6 flex flex-col gap-5">
        {stage === "idea" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description" className="text-sm">
                Describe your concept
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="E.g. a competitive-intelligence tool for B2B SaaS startups…"
                rows={4}
                maxLength={600}
                disabled={busy}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">~ 300 characters is enough.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category" className="text-sm">
                Category
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
                Inspired by… <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="inspirations"
                value={inspirations}
                onChange={(e) => setInspirations(e.target.value)}
                placeholder="Linear, Crayon (up to 3, comma-separated)"
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
                {file ? file.name : "Drop or select a file"}
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
                Your document is analyzed in memory and will <strong>never be stored</strong>.
                Only the extracted product profile is saved.
              </p>
            </div>
          </>
        )}

        {stage === "developing" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="repo-url" className="text-sm">
              GitHub repo URL
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
              The repo must be public. You'll be able to connect private repos later.
            </p>
          </div>
        )}

        {stage === "live" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-url" className="text-sm">
              Your product URL
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
                    This looks like a temporary URL. Would you rather use the “In
                    development” mode with your repo?
                  </p>
                  <Button size="sm" variant="ghost" className="mt-1" onClick={onSwitchToRepo}>
                    Switch mode
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
        primaryLabel="Analyze"
        primaryDisabled={!canSubmit}
        hint={busy ? "~ 3 to 15 seconds" : undefined}
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
  { key: "category", label: "Category", placeholder: "e.g. B2B SaaS CRM" },
  { key: "audience", label: "Target audience", placeholder: "e.g. Sales teams of 10–200 people" },
  {
    key: "valueProp",
    label: "Value proposition",
    placeholder: "What makes your product unique",
    multiline: true,
  },
  { key: "pricingModel", label: "Pricing model", placeholder: "e.g. Freemium + Pro at $20/mo" },
];

function ProfileForm({
  profile,
  setProfile,
  onConfirm,
  onBack,
  busy,
  prefetchStatus,
  mode,
  onCustomize,
}: {
  profile: ProductProfile;
  setProfile: (p: ProductProfile) => void;
  onConfirm: () => void | Promise<void>;
  onBack: () => void;
  busy: boolean;
  prefetchStatus: "idle" | "running" | "completed";
  mode: OnboardingMode;
  onCustomize: () => void;
}) {
  return (
    <div>
      <h1 className="text-title md:text-title-lg font-semibold">
        Did we get your product right?
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        Fix anything that's off — it directly improves competitor relevance.
      </p>

      <div className="flex items-center gap-1.5 mt-6 mb-3 text-xs text-muted-foreground">
        <Sparkles size={13} className="text-primary" /> Extracted by AI
      </div>

      <Card className="p-5 sm:p-6 flex flex-col gap-5">
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

      {prefetchStatus === "running" && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Searching competitors…
        </p>
      )}
      {prefetchStatus === "completed" && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-positive">
          <Check size={12} /> Competitors found
        </p>
      )}

      {mode === "quick_start" && (
        <button
          type="button"
          onClick={onCustomize}
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown size={13} /> Customize more
        </button>
      )}

      <FooterNav
        onBack={onBack}
        onSubmit={onConfirm}
        busy={busy}
        busyLabel="Finding competitors…"
        primaryLabel={mode === "quick_start" ? "Looks right, find competitors" : "Looks right"}
        hint={busy ? "~ 15 to 30 seconds" : undefined}
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
      <h1 className="text-title md:text-title-lg font-semibold">
        Your competitors
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        Check the ones that really matter — you can add or remove more later.
      </p>

      {noStrongMatch && (
        <div className="mt-6 flex items-start gap-3 rounded-md border border-border-strong bg-surface-2/60 px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 text-foreground shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-foreground">We didn't find any obvious competitors.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={onRefine}>
                Refine my profile
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-6 mb-3 gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {busy ? (
            "Searching…"
          ) : (
            <>
              <span className="font-mono text-foreground">{competitors.length}</span> found
              {" · "}
              <span className="font-mono text-foreground">{limitLabel}</span> selected
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{PLAN_LABELS[plan]} plan</p>
      </div>

      <Card className="p-2 sm:p-3 max-h-[420px] overflow-auto">
        {busy ? (
          <div className="px-4 py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Analyzing your market…
          </div>
        ) : competitors.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No competitors suggested. Add some manually below.
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
          Add a competitor manually
        </Label>
        <div className="flex gap-2">
          <Input
            id="manual-url"
            type="url"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://another-competitor.com"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManualCompetitor();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addManualCompetitor}>
            <Plus size={14} /> Add
          </Button>
        </div>
      </div>

      {competitors.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
          Competitors we found but you didn't select stay available in{" "}
          <span className="text-foreground">Detections</span> — you can track them later
          (for example after a plan change).
        </p>
      )}

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
        "flex items-start gap-3 px-3 py-3 rounded-md cursor-pointer transition-colors hover:bg-surface-2",
        competitor.selected && "bg-primary/5",
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
          className="text-meta font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-0.5 transition-colors"
        >
          {competitor.url.replace(/^https?:\/\//, "")}
          <ExternalLink size={10} />
        </a>
        {competitor.snippet && (
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
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
    accent: "bg-primary/10 text-primary border-primary/30",
    muted: "bg-transparent text-muted-foreground border-border",
  }[tone];
  return (
    <span
      className={cn(
        "text-meta px-1.5 py-0.5 font-medium border rounded font-mono",
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
  defaultAdvanced,
  multiProduct,
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
  defaultAdvanced: boolean;
  multiProduct: boolean;
}) {
  const [advanced, setAdvanced] = useState(defaultAdvanced);

  return (
    <div>
      <h1 className="text-title md:text-title-lg font-semibold">
        Monitoring preferences
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        We've pre-selected sensible settings. Confirm or customize.
      </p>

      <Card className="mt-6 p-5 sm:p-6 flex flex-col gap-4">
        <ul className="text-sm text-foreground flex flex-col gap-1.5">
          <li>
            <span className="text-muted-foreground">Tracked competitors: </span>
            {selectedCount}
          </li>
          <li>
            <span className="text-muted-foreground">Frequency: </span>
            {frequency === "daily" ? "Daily" : "Weekly"}
          </li>
          <li>
            <span className="text-muted-foreground">Sources: </span>
            {sources.length > 0 ? sources.map((s) => SOURCE_DEF[s].label).join(" · ") : "—"}
          </li>
        </ul>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown size={13} className={cn("transition-transform", advanced && "rotate-180")} />
          Customize advanced preferences
        </button>

        {advanced && (
          <div className="flex flex-col gap-6 pt-2 border-t border-border">
            <section>
              <p className="text-xs font-medium text-muted-foreground mb-3">
                Frequency · {PLAN_LABELS[plan]} plan
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(["daily", "weekly"] as const).map((f) => (
                  <SegmentChoice
                    key={f}
                    active={frequency === f}
                    locked={!allowedFrequencies.includes(f)}
                    onClick={() => setFrequency(f)}
                    title={f === "daily" ? "Daily" : "Weekly"}
                    description={
                      f === "daily" ? "Scrapes once a day. Recommended." : "Once a week."
                    }
                    variant="radio"
                  />
                ))}
              </div>
            </section>
            <section>
              <p className="text-xs font-medium text-muted-foreground mb-3">
                Sources to monitor
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

      <WhatHappensNote multiProduct={multiProduct} />

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

// A single "what happens next" heads-up before finishing, replacing the two stacked
// cards (card-soup) with one boxless block. Covers notification timing (patch-26 —
// quiet hours, weekend off, grouping, applied automatically + detected timezone synced
// on the dashboard) and, in full mode, multi-SKU (patch-28 — extra products live in
// Settings → Products). Both are skippable heads-ups, everything adjustable later.
function WhatHappensNote({ multiProduct }: { multiProduct: boolean }) {
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      // Keep the generic copy.
    }
  }, []);

  return (
    <div className="mt-6 rounded-md border border-border bg-surface-2/40 px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <Bell size={15} className="mt-0.5 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm text-foreground">
            {tz ? (
              <>
                We&apos;ll notify you on your local time (
                <span className="font-medium">{tz}</span>).
              </>
            ) : (
              <>We&apos;ll notify you on your local time.</>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            No emails between 10pm and 8am or on weekends, and similar updates are
            grouped. Critical alerts always come through. Adjust anytime in Settings →
            Notifications.
          </p>
        </div>
      </div>
      {multiProduct && (
        <div className="flex items-start gap-2.5 pt-3 border-t border-border">
          <Package size={15} className="mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm text-foreground">Setting up your main product now.</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Selling several products (separate SKUs, hubs, or tiers)? Add them anytime
              in Settings → Products — each gets its own competitors and battle cards.
            </p>
          </div>
        </div>
      )}
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
          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
          : "border-border hover:border-border-strong hover:bg-surface-2",
        locked && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2">
        {variant === "radio" ? (
          <span
            className={cn(
              "w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
              active ? "bg-primary border-primary" : "bg-transparent border-border-strong",
            )}
          >
            {active && <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />}
          </span>
        ) : (
          <span
            className={cn(
              "w-4 h-4 rounded-sm border flex items-center justify-center transition-colors",
              active
                ? "bg-primary border-primary text-primary-foreground"
                : "bg-transparent border-border-strong text-transparent",
            )}
          >
            <Check size={10} strokeWidth={3} />
          </span>
        )}
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{description}</p>
    </button>
  );
}

// ── Screen: done (step 5, first session) ─────────────────────────────────

function DoneStep({
  totalCompetitors,
  plan,
  onDashboard,
}: {
  totalCompetitors: number;
  plan: Plan;
  onDashboard: () => void;
}) {
  const [analyzed, setAnalyzed] = useState(0);

  // Only recommend steps the current plan can actually act on — recommending
  // gated features right after sign-up is frustrating, not helpful.
  const limits = PLAN_LIMITS[plan];
  const nextSteps: string[] = [];
  if (limits.allowedChannels.includes("slack")) {
    nextSteps.push(
      limits.features.realtimeAlerts
        ? "Set up your Slack webhook for real-time alerts"
        : "Set up your Slack webhook for alerts",
    );
  }
  if (limits.features.multiUser) {
    nextSteps.push("Invite a teammate");
  }
  if (limits.allowedFrequencies.length > 1) {
    nextSteps.push("Customize your monitoring frequency");
  }
  nextSteps.push("Review your weekly digest settings");
  if (nextSteps.length < 2) {
    nextSteps.push("Browse your signal feed as it fills up");
  }

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
      <h1 className="text-title md:text-title-lg font-semibold mt-5">
        Setup complete
      </h1>
      <p className="text-sm text-muted-foreground mt-3 max-w-md">
        Your competitors are being analyzed in the background. You can head to your dashboard
        now — we'll send you a notification the moment the first analysis is ready.
      </p>

      <div className="mt-6 inline-flex items-center gap-2 rounded-md border border-border bg-surface-2/60 px-4 py-2">
        {!allDone && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        {allDone && <Check size={14} className="text-positive" />}
        <span className="text-sm text-foreground">
          {allDone
            ? `${totalCompetitors} competitors analyzed`
            : `Analyzing ${analyzed}/${totalCompetitors} competitors…`}
        </span>
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        Your first weekly digest will be sent next Monday.
      </p>

      <Card className="mt-8 w-full max-w-md p-5 text-left">
        <p className="text-xs font-medium text-muted-foreground mb-3">
          Recommended next steps
        </p>
        <ul className="flex flex-col gap-2 text-sm text-foreground">
          {nextSteps.map((step) => (
            <li key={step} className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-sm border border-border-strong" /> {step}
            </li>
          ))}
        </ul>
      </Card>

      <Button className="mt-8" onClick={onDashboard}>
        Go to dashboard <ArrowRight size={14} />
      </Button>
    </div>
  );
}
