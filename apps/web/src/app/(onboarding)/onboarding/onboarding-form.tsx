"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  WarningCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  DotsThreeIcon,
  ArrowSquareOutIcon,
  EyeIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  LightbulbIcon,
  PencilSimpleLineIcon,
  SpinnerIcon,
  LockIcon,
  SignOutIcon,
  PlusIcon,
  ArrowCounterClockwiseIcon,
  SparkleIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from "@/components/icons";
import {
  PLAN_LIMITS,
  detectTemporaryUrl,
  DISCOVERY_REGIONS,
  inferRegionFromUrl,
  type Plan,
} from "@outrival/shared";
import {
  ApiError,
  api,
  type DiscoveredCompetitor,
  type OnboardingMode,
  type OnboardingStep,
  type ProductProfile,
  type ProjectStage,
} from "@/lib/api";
import { errorMessage } from "@/lib/error-helpers";
import { signOut } from "@/lib/auth-client";
import { resetUser } from "@/lib/posthog/events";
import { useFeatureFlag } from "@/lib/posthog/use-feature-flag";
import {
  ONBOARDING_EVENTS,
  milestoneKey,
  trackOnboarding,
} from "@/lib/posthog/onboarding-events";
import { useOnboardingSession } from "@/hooks/use-onboarding-session";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Screen = "stage" | "input" | "profile" | "discover";
type SourceType = "homepage" | "pricing" | "blog";
type Frequency = "daily" | "weekly";

interface Selection extends DiscoveredCompetitor {
  selected: boolean;
}

// One screen, one step. The previous map counted "stage" and "input" as the same
// step — so the very first choice moved nothing — and gave the finished flow a
// step number of its own. Naming the four steps replaces the bare "Step 1 of 3":
// position was the only thing the old bar could answer, never "of what".
const SETUP_STEPS = [
  "Where you are",
  "Your product",
  "What we read",
  "Competitors",
] as const;

const SCREEN_TO_STEP: Record<Screen, number> = {
  stage: 1,
  input: 2,
  profile: 3,
  discover: 4,
};

const STAGE_META: Record<
  ProjectStage,
  { icon: typeof LightbulbIcon; title: string; description: string }
> = {
  idea: {
    icon: LightbulbIcon,
    title: "I have an idea to explore",
    description: "Describe your concept in a few words",
  },
  document: {
    icon: FileTextIcon,
    title: "I have a pitch or a brief",
    description: "Upload your pitch deck or business plan",
  },
  developing: {
    icon: GitBranchIcon,
    title: "I'm building it",
    description: "Connect your public GitHub repo",
  },
  live: {
    icon: GlobeIcon,
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

// The two long waits (3 to 15s, then 15 to 30s) used to be a spinner inside the
// primary button plus a duration hint. Naming the work says what is happening
// rather than only that something is. The last step holds until the real answer
// lands, so the list never claims to be finished before the work is.
const ANALYZE_STEPS: Record<ProjectStage, readonly string[]> = {
  idea: ["Reading your description", "Placing it in a category", "Writing your product profile"],
  document: ["Extracting the text", "Reading your document", "Writing your product profile"],
  developing: ["Opening the repo", "Reading the code and the README", "Writing your product profile"],
  live: ["Fetching your site", "Reading the page", "Writing your product profile"],
};

const DISCOVERY_STEPS = [
  "Searching your market",
  "Scoring how much each one overlaps",
  "Checking every site is reachable",
] as const;

// Functional categories (what a product does), not business-model labels. The old
// list ("B2B SaaS", "DevTools"…) nudged every idea toward the same generic bucket,
// which then made competitor discovery imprecise.
const CATEGORY_SUGGESTIONS = [
  "Appointment scheduling",
  "Competitive intelligence",
  "Email marketing",
  "Project management",
  "API monitoring",
  "Freelance marketplace",
  "Headless CMS",
  "Meal-kit delivery",
  "Expense management",
];

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
    return "We couldn't find any selectable text in that file. It looks scanned or image-based. Paste a short description instead, or upload a PDF with selectable text, a .docx, .md, or .txt.";
  }
  return null;
}

// Patch-25 hybrid parallelization: prefetch discovery in the background while
// the user reviews/edits the profile. Default on; debounce avoids re-billing Exa
// on every keystroke.
const PARALLEL_DISCOVERY = process.env.NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY !== "false";
const DISCOVERY_DEBOUNCE_MS =
  Number(process.env.NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS ?? 3000) || 3000;

// Drafts are one row update, not a billed search, so they are written back on a
// short pause: the point is to be ahead of the user leaving the screen, not to
// batch keystrokes.
const DRAFT_SAVE_DEBOUNCE_MS = 800;

// Identity of the profile the user has on screen, independent of where discovery
// would search with it.
function profileDraftKey(p: ProductProfile): string {
  return JSON.stringify([
    p.category,
    p.audience,
    p.valueProp,
    p.pricingModel,
    p.whatItDoes ?? "",
    (p.keywords ?? []).join("|"),
  ]);
}

// Identity of a discovery input — a prefetch is reusable only for the exact same
// profile + URL, so editing any field invalidates it (and re-bills, debounced).
function profileKey(p: ProductProfile, url: string | null, region: string | null): string {
  return JSON.stringify([profileDraftKey(p), url, region]);
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: unknown; error?: unknown };
    if (typeof data.message === "string") return data.message;
    if (err.status === 401) return "Session expired. Please sign in again.";
    if (err.status === 429) return "Too many requests. Wait a few seconds before trying again.";
    if (err.status >= 500) return "The server encountered an error. Try again in a moment.";
    // Below this line the API sent no sentence, only a machine code (or nothing at
    // all). Returning it verbatim printed "no_evidence" at the user; the shared
    // error configs turn the ones we know about into a sentence and everything
    // else into the generic one.
    return errorMessage(err);
  }
  if (err instanceof Error) {
    if (err.name === "TypeError" || err.message.toLowerCase().includes("fetch"))
      return "Cannot connect to the server. Check your network connection.";
    return err.message;
  }
  return errorMessage(err);
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
  const discoveryDisabled = useFeatureFlag("kill-switch-discovery");

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
  // The fallback offer carries its own sentence: it used to arrive as a toast on
  // top of a card, which put the reason and the way out in two places at once.
  const [fallbackOffer, setFallbackOffer] = useState<{ message: string } | null>(null);
  // Set when the user reaches the description form through "Describe it instead".
  // The offer's sentence disappears with the notice, so the form has to restate why
  // it is being asked; without it the screen reads as a step the user chose.
  const [describeFromFallback, setDescribeFromFallback] = useState(false);
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
  // What to call the product. Only asked for (and only sent) when the run produced no
  // URL — idea / document / developing — since those are the stages where the product
  // otherwise lands as the "My product" placeholder with no way to say otherwise.
  const [productName, setProductName] = useState("");
  // Primary market for discovery geo-biasing. Defaults from the product URL's
  // ccTLD (editable on the discover step); `regionTouched` freezes the auto-default
  // once the user picks explicitly. null = global (no bias).
  const [region, setRegion] = useState<string | null>(null);
  const regionTouched = useRef(false);
  const [competitors, setCompetitors] = useState<Selection[]>([]);
  // Trashed rows are kept aside (not dropped) so they can be saved as
  // "dismissed" candidates on complete — a remembered rejection.
  const [removed, setRemoved] = useState<Selection[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  // The dedicated monitoring step was removed: onboarding finishes on the
  // competitor screen with these fixed defaults (free plan → weekly, the three
  // free sources). Everything is adjustable later in Settings.
  const frequency: Frequency = allowedFrequencies.includes("daily") ? "daily" : "weekly";
  const sources: SourceType[] = ["homepage", "pricing", "blog"];

  // Background discovery prefetch (patch-25): status drives the discreet profile
  // indicator; refs hold the in-flight controllers.
  const [discoveryStatus, setDiscoveryStatus] = useState<"idle" | "running" | "completed">("idle");
  const prefetchAbort = useRef<AbortController | null>(null);
  const discoverAbort = useRef<AbortController | null>(null);
  // Every result set fetched during this wizard, keyed by discovery input identity
  // (profile + URL + market). It used to hold ONE entry, readable only by the
  // profile step, so toggling the market away and back on the discover step paid a
  // fresh Exa search plus the reachability sweep for a set already on screen.
  const discoveryCache = useRef(new Map<string, DiscoveredCompetitor[]>());

  // Onboarding mode (patch-25): always quick_start now that the advanced monitoring
  // step is gone; still adopted from a resumed session and reported in the funnel.
  const [mode, setMode] = useState<OnboardingMode>("quick_start");
  const modeAdopted = useRef(false);
  useEffect(() => {
    if (session?.mode && !modeAdopted.current) {
      modeAdopted.current = true;
      setMode(session.mode);
    }
  }, [session?.mode]);

  // The profile step used to hold everything typed on it in React state until
  // "Looks right": leaving the screen — and the dashboard sends the user straight
  // back here while the gate is on — restored the step and the analysed profile but
  // dropped the edits and the typed name. Both are now written back while the user
  // types, through the endpoints the confirm already uses. These two refs hold what
  // is known to be saved, so an unchanged draft is never re-sent.
  const savedProfile = useRef<string | null>(
    initialProfile ? profileDraftKey(initialProfile) : null,
  );
  const savedName = useRef("");
  // The session loads after the field is already live, so the saved name is adopted
  // once and never over something the user has started typing.
  const nameAdopted = useRef(false);
  useEffect(() => {
    if (nameAdopted.current || !session) return;
    nameAdopted.current = true;
    const saved = session.productName ?? "";
    savedName.current = saved;
    if (saved) setProductName((v) => v || saved);
  }, [session]);

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
  // metrics). Every Screen is a real session stage now that "done" is gone, so
  // the transition no longer needs a guard for the one that wasn't.
  const goTo = useCallback(
    (next: Screen) => {
      setError(null);
      // The fallback offer is rendered globally (above the screen switch), so it
      // would otherwise leak onto later screens once an analysis finally succeeds.
      setFallbackOffer(null);
      setScreen(next);
      void api.patchOnboardingProgress(next as OnboardingStep).catch(() => {});
      // The wizard's first screen ("stage", project-stage pick) is the session's
      // "started" stage; the other screens share their literal name with the stage.
      void updateSession({ stage: next === "stage" ? "started" : next });
    },
    [updateSession],
  );

  async function handleSignOut() {
    await signOut();
    resetUser();
    router.push("/auth");
  }

  // Both exits out of the wizard leave through here rather than through the client
  // router. /dashboard gates on onboardingCompleted / onboardingSkipped in a server
  // component, and the Router Cache still holds the payload it rendered BEFORE the
  // flag flipped — the one that redirects to /onboarding, whose own gate now sends
  // it back. `replace` also keeps /onboarding out of history, so Back can't re-enter
  // a finished flow and bounce off the same pair of gates.
  function leaveTo(path: string) {
    window.location.replace(path);
  }

  async function handleSkip() {
    try {
      await api.skipOnboarding();
      leaveTo("/dashboard");
    } catch (e) {
      setError(extractMessage(e));
    }
  }

  function restart() {
    setError(null);
    setFallbackOffer(null);
    setDescribeFromFallback(false);
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
    setDescribeFromFallback(false);
    goTo("input");
  }

  // ── Analyze (per mode) ─────────────────────────────────────────────────
  function onProfileReady(p: ProductProfile, url: string | null) {
    // Never assume "Free" from a missing price: an empty pricingModel means the AI
    // found no pricing signal at all (an early-stage idea, a private repo, a bare
    // landing page). Asserting "Free" would misread sales-led / usage-based / demo
    // products and poison overlap scoring + battle cards. The field is optional, so
    // leave it blank for the user to fill — the extractor already classifies the real
    // model (freemium / usage-based / contact-sales / demo) whenever a signal exists.
    const normalized: ProductProfile = {
      ...p,
      pricingModel: p.pricingModel?.trim() ?? "",
    };
    setProfile(normalized);
    // The analysis route stored this exact profile on the org, so the draft save
    // has nothing to do until the user edits a field.
    savedProfile.current = profileDraftKey(normalized);
    setCommittedUrl(url);
    setCompetitors([]);
    setRemoved([]);
    trackOnboarding(ONBOARDING_EVENTS.PRODUCT_ANALYZED, sessionId);
    void updateSession({
      productProfile: normalized,
      productUrl: url,
      timings: { [milestoneKey(ONBOARDING_EVENTS.PRODUCT_ANALYZED)]: Date.now() },
    });
    goTo("profile");
  }

  function handleAnalyzeError(e: unknown) {
    if (fallbackFromError(e)) {
      setFallbackOffer({
        message: unreadableDocumentMessage(e) ?? "Automatic analysis didn't work out.",
      });
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
      handleAnalyzeError(e);
    } finally {
      setBusy(null);
    }
  }

  // Deliberately leaves the textarea empty. It used to be seeded with whatever the
  // failed run was given — the raw URL, or the owner/repo slug — and a user in a hurry
  // submits that as their "description", which is exactly the input the extractor
  // can't work from: it yields a placeholder name and a wrong category. None of those
  // strings is a description, so there is nothing worth carrying over.
  function acceptDescriptionFallback() {
    setFallbackOffer(null);
    setStage("idea");
    setDescribeFromFallback(true);
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
    async (p: ProductProfile, url: string | null, regionArg: string | null) => {
      if (discoveryDisabled) {
        setError(
          "Discovery is temporarily disabled. Add competitors manually after onboarding.",
        );
        return;
      }
      // Replay an input we already searched (market toggled back, step re-entered)
      // instead of re-billing Exa for a set we still hold.
      const key = profileKey(p, url, regionArg);
      const memo = discoveryCache.current.get(key);
      if (memo) {
        applyDiscovered(memo);
        return;
      }
      // Two market switches in a row leave two searches in flight; without this the
      // slower one lands last and shows a market the select no longer names.
      discoverAbort.current?.abort();
      const controller = new AbortController();
      discoverAbort.current = controller;
      setBusy("discover");
      trackOnboarding(ONBOARDING_EVENTS.DISCOVERY_STARTED, sessionId, { trigger: "confirm" });
      void updateSession({
        timings: { [milestoneKey(ONBOARDING_EVENTS.DISCOVERY_STARTED)]: Date.now() },
      });
      try {
        const res = await api.discoverCompetitors(p, url, regionArg, controller.signal);
        if (discoverAbort.current !== controller) return;
        discoveryCache.current.set(key, res.competitors);
        applyDiscovered(res.competitors);
      } catch (e) {
        if (discoverAbort.current !== controller) return;
        setError(extractMessage(e));
      } finally {
        // A superseded run must not clear the newer run's spinner.
        if (discoverAbort.current === controller) {
          discoverAbort.current = null;
          setBusy(null);
        }
      }
    },
    [discoveryDisabled, sessionId, updateSession, applyDiscovered],
  );

  // Default the market from the committed product URL's ccTLD until the user
  // overrides it on the discover step. Re-runs on each new URL, never after a
  // manual pick.
  useEffect(() => {
    if (regionTouched.current) return;
    setRegion(inferRegionFromUrl(committedUrl));
  }, [committedUrl]);

  // Prefetch discovery in the background while the user reviews the profile, so
  // confirming is often instant. Debounced + abortable: each profile edit cancels
  // the in-flight request and reschedules; a result is cached by profile identity.
  useEffect(() => {
    if (!PARALLEL_DISCOVERY || screen !== "profile" || !profile || discoveryDisabled) return;
    const key = profileKey(profile, committedUrl, region);
    if (discoveryCache.current.has(key)) {
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
        .discoverCompetitors(profile, committedUrl, region, controller.signal)
        .then((res) => {
          if (prefetchAbort.current !== controller) return;
          discoveryCache.current.set(key, res.competitors);
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
  }, [screen, profile, committedUrl, region, discoveryDisabled, sessionId]);

  // Draft saves for the profile step (see the refs above). Best-effort and silent:
  // a failed background write must not take the notice slot from the screen the user
  // is on, and confirming saves the same thing again anyway.
  useEffect(() => {
    if (screen !== "profile" || !profile) return;
    const key = profileDraftKey(profile);
    if (key === savedProfile.current) return;
    const timer = setTimeout(() => {
      savedProfile.current = key;
      void api.patchProductProfile(profile).catch(() => {});
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [screen, profile]);

  // The name has no org column of its own — it is a per-attempt answer, and it rides
  // the session row that already carries the URL and the profile for resume.
  useEffect(() => {
    if (screen !== "profile" || !sessionId || productName === savedName.current) return;
    const timer = setTimeout(() => {
      savedName.current = productName;
      void updateSession({ productName: productName.trim() || null });
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [screen, sessionId, productName, updateSession]);

  async function handleProfileConfirm() {
    if (!profile) return;
    setError(null);
    // pricingModel is intentionally optional — a free / open-source product (e.g. a
    // package registry) legitimately has no pricing, and the AI leaves it blank.
    const empty = (["category", "audience", "valueProp"] as const).filter(
      (k) => !profile[k].trim(),
    );
    if (empty.length > 0) {
      setError("All fields are required. Fill in the empty ones.");
      return;
    }
    trackOnboarding(ONBOARDING_EVENTS.PRODUCT_PROFILE_CONFIRMED, sessionId);
    void updateSession({
      timings: { [milestoneKey(ONBOARDING_EVENTS.PRODUCT_PROFILE_CONFIRMED)]: Date.now() },
    });
    // Move first, then work. The profile save and the search both used to gate the
    // step change, so confirming held the user on a screen with nothing left to do
    // for as long as the search took. The discover step renders its own loading
    // state, and a save that fails still surfaces there — goTo clears the notice
    // slot on the way in, so a later rejection lands on the step the user is on.
    goTo("discover");
    savedProfile.current = profileDraftKey(profile);
    void api.patchProductProfile(profile).catch((e) => setError(extractMessage(e)));
    // runDiscovery replays the background prefetch when it already resolved for
    // this exact input (instant), and searches otherwise.
    await runDiscovery(profile, committedUrl, region);
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
      void runDiscovery(profile, committedUrl, region);
    }
  }, [screen, competitors.length, profile, busy, discoveryDisabled, committedUrl, region, runDiscovery]);

  // The market is asked for on the profile screen, before the first search. It used
  // to sit on the competitor screen, where changing it re-ran discovery and replaced
  // the list wholesale: manual additions and every checkbox went with it, silently.
  // Asked here there is nothing curated to lose — the background prefetch re-keys on
  // the new market and confirming picks that result up.
  function changeRegion(next: string | null) {
    regionTouched.current = true;
    setRegion(next);
  }

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
    void handleComplete();
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
      // Carried through so the queue can describe the company on day one.
      snippet: c.snippet || undefined,
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
        discoveryRegion: region,
        onboardingSessionId: sessionId ?? undefined,
        productName: committedUrl ? undefined : productName.trim() || undefined,
      });
      trackOnboarding(ONBOARDING_EVENTS.COMPETITORS_FINALIZED, sessionId, {
        competitorCount: selected.length,
        mode,
      });
      void updateSession({
        timings: { [milestoneKey(ONBOARDING_EVENTS.COMPETITORS_FINALIZED)]: Date.now() },
      });
      // No completion screen. /complete already flipped the org to
      // onboardingCompleted + step "done", so the page gate sends any return visit
      // straight to the dashboard — where OnboardingAnalysisPanel renders the very
      // progress this wizard used to poll for on a screen with nothing else on it.
      // `busy` deliberately stays set: the button holds its pending state until the
      // route actually changes. The success toast is gone with the client-side push
      // that used to carry it — a document navigation tears the toaster down before
      // it paints, and OnboardingAnalysisPanel already names the same work on arrival.
      trackOnboarding(ONBOARDING_EVENTS.REDIRECT_TO_DASHBOARD, sessionId);
      leaveTo("/dashboard");
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) setPaywall(reason);
      else setError(extractMessage(e));
      setBusy(null);
    }
  }

  const currentStep = SCREEN_TO_STEP[screen];

  // One slot for recoverable problems, rendered by each screen under its own
  // heading. Five containers could say something went wrong, in three visual
  // languages, and two of them stacked above the title and pushed the content
  // down. The paywall keeps its dialog: it is the one that can't be resolved here.
  const notice = error ? (
    <Notice tone="critical" onDismiss={() => setError(null)}>
      {error}
    </Notice>
  ) : fallbackOffer ? (
    <Notice
      icon={SparkleIcon}
      onDismiss={() => setFallbackOffer(null)}
      action={
        <Button size="sm" onClick={acceptDescriptionFallback}>
          Describe it instead
        </Button>
      }
    >
      {fallbackOffer.message}
    </Notice>
  ) : null;

  // Continuity between screens: each one opens by echoing the answer it was built
  // from, so a step reads as the next move rather than a new page.
  const sourceEcho = !stage
    ? null
    : stage === "live" && committedUrl
      ? committedUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : stage === "developing"
        ? repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/$/, "")
        : stage === "document"
          ? (file?.name ?? "your document")
          : "your description";

  const regionLabel =
    DISCOVERY_REGIONS.find((r) => r.code === region)?.label ?? "Global (no preference)";

  return (
    // Flat canvas. The ambient glow that used to sit here was clipped to h-72 by an
    // overflow-hidden wrapper, which cuts a 140px blur mid-gradient and leaves a
    // straight seam across the page — it read as a rendering fault, not atmosphere.
    <div className="min-h-screen flex flex-col bg-background">
      <Header
        step={currentStep}
        onSignOut={handleSignOut}
        onRestart={restart}
        onSkip={handleSkip}
      />

      {/* The header is in normal flow, so `flex-1` is already the space below it:
          centring here centres against that space, not against the viewport, and
          a step taller than the fold still grows the column instead of clipping.
          The bottom padding runs deeper than the top on purpose: geometric centre
          reads as sitting low, and each step is bottom-heavy (a short title over a
          grid of cards), so the extra padding lifts the block by half the surplus
          — 40px — back onto the optical centre. */}
      <main className="flex flex-1 flex-col justify-center mx-auto w-full max-w-3xl px-4 sm:px-8 pt-8 pb-28 sm:pt-12 sm:pb-32">
        <div
          key={screen}
          className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out"
        >
          {screen === "stage" && <StageChooser onChoose={chooseStage} notice={notice} />}

          {screen === "input" && stage && (
            <ModeForm
              stage={stage}
              notice={notice}
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
              fromFallback={describeFromFallback}
              onSwitchToRepo={() => chooseStage("developing")}
            />
          )}

          {screen === "profile" && profile && (
            <ProfileForm
              profile={profile}
              setProfile={setProfile}
              notice={notice}
              sourceEcho={sourceEcho}
              onConfirm={handleProfileConfirm}
              onBack={() => goTo("input")}
              busy={busy === "discover"}
              prefetchStatus={discoveryStatus}
              mode={mode}
              productName={productName}
              setProductName={setProductName}
              askName={committedUrl === null}
              region={region}
              onRegionChange={changeRegion}
            />
          )}

          {screen === "discover" && (
            <DiscoverStep
              competitors={competitors}
              notice={notice}
              categoryEcho={profile?.category ?? null}
              regionLabel={regionLabel}
              busy={busy === "discover"}
              completing={busy === "complete"}
              selectedCount={selectedCount}
              maxCompetitors={maxCompetitors}
              frequency={frequency}
              sources={sources}
              toggleCompetitor={toggleCompetitor}
              removeCompetitor={removeCompetitor}
              manualUrl={manualUrl}
              setManualUrl={setManualUrl}
              addManualCompetitor={addManualCompetitor}
              onConfirm={handleCompetitorsConfirm}
              onBack={() => goTo("profile")}
              onRefine={() => goTo("profile")}
              onUpgrade={() => showCompetitorLimitPaywall(selectedCount)}
            />
          )}

        </div>
      </main>

      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────

// The header used to carry three ghost buttons on every screen, one of them a
// destructive Restart four pixels from the button that saves progress. Brand,
// progress and a single overflow menu now: the flow's own controls are the only
// thing competing for a click.
function Header({
  step,
  onSignOut,
  onRestart,
  onSkip,
}: {
  step: number;
  onSignOut: () => void | Promise<void>;
  onRestart: () => void;
  onSkip: () => void | Promise<void>;
}) {
  const [confirmRestart, setConfirmRestart] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      {/* Three tracks rather than a flex row: progress is centred on the page,
          not on whatever width the brand and the actions leave over. Brand reads
          first, progress second, the two controls last as one right-hand cluster.
          Full-bleed, not capped to the content column: an app bar reads as the
          window's own chrome, and a brand indented to a text measure looks like a
          stray heading. The middle track keeps progress on the page's centreline. */}
      <div className="grid h-16 w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0 text-base font-semibold font-[var(--font-display)] tracking-tight"
        >
          <span className="text-foreground">out</span>
          <span className="text-primary">rival</span>
        </Link>

        <HeaderSteps step={step} />

        <div className="flex shrink-0 items-center gap-0.5">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label="Setup options"
              >
                <DotsThreeIcon size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setConfirmRestart(true)}>
                <ArrowCounterClockwiseIcon size={16} /> Start over
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onSkip()}>
                <SignOutIcon size={16} /> Leave for now
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void onSignOut()}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Restart discards every answer given so far, so it asks first. */}
      <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start over?</DialogTitle>
            <DialogDescription>
              This clears the starting point you picked, the profile we extracted from your
              product and the competitors on screen. Your account and your plan are untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRestart(false)}>
              Keep going
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRestart(false);
                onRestart();
              }}
            >
              Start over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

// Progress lives in the header rather than at the top of the content column, so
// it stays on screen while a step scrolls. Below md the four labels don't fit, so
// the bars keep position on their own. The "2/4" counter that used to sit beside
// them is gone: it restated the bars in the one place with the least room, and
// the step's own title and description say where you are with actual words.
function HeaderSteps({ step }: { step: number }) {
  return (
    <div className="min-w-0">
      {/* The desktop list is display:none below md, so it is gone from the
          accessibility tree too — without this, dropping the counter would leave a
          small screen with no readable progress at all. */}
      <span className="sr-only md:hidden">
        Step {step} of {SETUP_STEPS.length}: {SETUP_STEPS[step - 1]}
      </span>
      <div className="flex items-center gap-1.5 md:hidden" aria-hidden>
        {SETUP_STEPS.map((label, i) => (
          <span
            key={label}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              i < step ? "bg-primary" : "bg-stroke",
            )}
          />
        ))}
      </div>

      <ol className="hidden items-center justify-center md:flex">
        {SETUP_STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className="flex min-w-0 items-center"
            >
              {i > 0 && <span aria-hidden className="mx-2.5 h-px w-5 shrink-0 bg-border" />}
              <span aria-hidden className="grid size-5 shrink-0 place-items-center">
                {done ? (
                  <CheckIcon size={16} className="text-primary" />
                ) : (
                  <span
                    className={cn(
                      "size-2 rounded-full transition-colors duration-300",
                      current ? "bg-primary" : "bg-stroke",
                    )}
                  />
                )}
              </span>
              <span
                className={cn(
                  "ml-2 truncate text-dense transition-colors",
                  current ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// One container for every recoverable problem, in one visual language, rendered
// by each screen under its own heading. It replaces the error banner, the
// fallback-offer card and the "no obvious competitors" card, which said the same
// kind of thing in three different shapes. `critical` is a failure the user has
// to read; the neutral tone carries an offer, which is information, not an error.
function Notice({
  children,
  tone = "neutral",
  icon: Icon = WarningCircleIcon,
  action,
  onDismiss,
}: {
  children: ReactNode;
  tone?: "neutral" | "critical";
  icon?: typeof WarningCircleIcon;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  const critical = tone === "critical";
  return (
    <div
      role={critical ? "alert" : "status"}
      className={cn(
        "mt-5 flex items-start gap-3 rounded-md border px-4 py-3",
        critical ? "border-destructive/40 bg-destructive/10" : "border-border-strong bg-surface-2/60",
      )}
    >
      <Icon
        size={16}
        className={cn("mt-0.5 shrink-0", critical ? "text-destructive" : "text-foreground")}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{children}</p>
        {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
}

// The answer the current screen was built from, above its heading. Every screen
// used to open cold, which made each one read as a new page rather than the next
// move of the same one.
function StepEcho({ children }: { children: ReactNode }) {
  return <p className="truncate text-meta text-muted-foreground">{children}</p>;
}

// The two AI waits used to be a spinner inside the primary button plus an 11px
// duration hint. Here the wait takes the content area and names what is being
// done. The last step never ticks off on its own: the work ends when the request
// lands, so the list can't claim to be finished before it is.
function WaitChecklist({
  title,
  steps,
  stepMs,
}: {
  title: string;
  steps: readonly string[];
  stepMs: number;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActive((i) => Math.min(i + 1, steps.length - 1)), stepMs);
    return () => clearInterval(id);
  }, [steps.length, stepMs]);

  return (
    <Card className="mt-6 p-5 sm:p-6">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <ol className="mt-4 flex flex-col gap-3">
        {steps.map((label, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li key={label} className="flex items-center gap-2.5">
              <span aria-hidden className="grid size-4 shrink-0 place-items-center">
                {done ? (
                  <CheckIcon size={14} className="text-primary" />
                ) : current ? (
                  <SpinnerIcon size={14} className="animate-spin text-foreground" />
                ) : (
                  <span className="size-1.5 rounded-full bg-stroke" />
                )}
              </span>
              <span
                className={cn("text-sm", done || current ? "text-foreground" : "text-muted-foreground")}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// The duration hint under the button is gone with it: WaitChecklist now shows the
// wait itself, so a "~ 15 to 30 seconds" caption would only re-state it.
function FooterNav({
  primaryLabel,
  busy,
  busyLabel,
  onBack,
  onSubmit,
  primaryDisabled,
}: {
  primaryLabel: string;
  busy?: boolean;
  busyLabel?: string;
  onBack?: () => void;
  onSubmit: () => void | Promise<void>;
  primaryDisabled?: boolean;
}) {
  return (
    <div className="mt-10 pt-6 border-t border-border flex items-center justify-between gap-3">
      <div>
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeftIcon size={16} /> Edit
          </Button>
        )}
      </div>
      <Button type="button" onClick={() => void onSubmit()} disabled={busy || primaryDisabled}>
        {busy ? (
          <>
            <SpinnerIcon size={16} className="animate-spin" />
            {busyLabel ?? "Loading…"}
          </>
        ) : (
          <>
            {primaryLabel}
            <ArrowRightIcon size={16} />
          </>
        )}
      </Button>
    </div>
  );
}

// ── Screen: stage chooser ────────────────────────────────────────────────

// The cards navigate on click, so the accent ring and aria-pressed state they used
// to carry only ever rendered after back navigation: styling paid for and never
// seen, on cards that looked like a choice to hold rather than the four routes
// they are. The pick is echoed on the next screen instead, where it is still true.
function StageChooser({
  onChoose,
  notice,
}: {
  onChoose: (s: ProjectStage) => void;
  notice: ReactNode;
}) {
  return (
    <div>
      <h1 className="text-title md:text-title-lg font-semibold">
        Where are you with your project?
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        Outrival watches your competitors and tells you what changed on their pages,
        their pricing and their content. First it needs to know what you're building.
      </p>

      {notice}

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(Object.keys(STAGE_META) as ProjectStage[]).map((s) => {
          const meta = STAGE_META[s];
          const Icon = meta.icon;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChoose(s)}
              className="text-left p-5 rounded-md border border-border transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              <Icon size={20} className="text-foreground" />
              <p className="text-sm font-medium mt-3">{meta.title}</p>
              <p className="text-dense text-muted-foreground mt-1 leading-relaxed">
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
  notice,
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
  fromFallback,
  onSwitchToRepo,
}: {
  stage: ProjectStage;
  notice: ReactNode;
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
  fromFallback: boolean;
  onSwitchToRepo: () => void;
}) {
  const temp = stage === "live" && productUrl ? detectTemporaryUrl(productUrl) : { temporary: false };

  // A disabled "Analyze" is the only thing a malformed URL used to produce: no
  // message, no aria-invalid, and nothing naming the expected format. Same predicate
  // and same inline treatment as the product wizard, so the two forms fail alike.
  const urlInvalid =
    stage === "live" && productUrl.trim().length > 0 && !isValidUrl(productUrl.trim());
  const repoInvalid =
    stage === "developing" && repoUrl.trim().length > 0 && !isGitHubRepoUrl(repoUrl.trim());

  const canSubmit =
    stage === "idea"
      ? description.trim().length >= 10
      : stage === "document"
        ? file !== null
        : stage === "developing"
          ? isGitHubRepoUrl(repoUrl.trim())
          : isValidUrl(productUrl.trim());

  // The wait takes over the content area instead of hiding inside the button: the
  // form has nothing left to say while it runs, and 15 seconds of unnamed spinner
  // is the longest silence in the flow.
  if (busy) {
    return (
      <div>
        <h1 className="text-title md:text-title-lg font-semibold">
          {STAGE_META[stage].title}
        </h1>
        <WaitChecklist
          title={LOADING_MESSAGE[stage]}
          steps={ANALYZE_STEPS[stage]}
          stepMs={3500}
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-title md:text-title-lg font-semibold">
        {STAGE_META[stage].title}
      </h1>
      {/* Every other screen opens title-then-description; this one used to open on
          a bare title, with the sentence that explains the ask stranded on the card
          the user just left. */}
      <p className="text-sm text-muted-foreground mt-3">
        {fromFallback
          ? "Automatic analysis didn't work. Describe what you're building in your own words."
          : STAGE_META[stage].description}
      </p>

      {notice}

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
              <p className="text-dense text-muted-foreground">~ 300 characters is enough.</p>
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
              <UploadSimpleIcon size={20} className="text-muted-foreground" />
              <span className="text-sm text-foreground">
                {file ? file.name : "Drop or select a file"}
              </span>
              <span className="text-dense text-muted-foreground">PDF, DOCX, MD, TXT (max 10MB)</span>
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
              <LockIcon size={14} className="mt-0.5 text-positive shrink-0" />
              <p className="text-dense text-foreground leading-relaxed">
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
              aria-invalid={repoInvalid}
              aria-describedby={repoInvalid ? "repo-url-error" : undefined}
            />
            {repoInvalid && (
              <p id="repo-url-error" className="text-dense text-destructive">
                Enter a full repo URL, e.g. https://github.com/owner/repo.
              </p>
            )}
            <p className="text-dense text-muted-foreground">
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
              aria-invalid={urlInvalid}
              aria-describedby={urlInvalid ? "product-url-error" : undefined}
            />
            {urlInvalid && (
              <p id="product-url-error" className="text-dense text-destructive">
                Enter a full URL starting with http:// or https://.
              </p>
            )}
            {temp.temporary && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-border-strong bg-surface-2/60 px-3 py-2">
                <WarningCircleIcon size={16} className="mt-0.5 text-foreground shrink-0" />
                <div className="flex-1">
                  <p className="text-dense text-foreground">
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
        primaryLabel="Analyze"
        primaryDisabled={!canSubmit}
      />
    </div>
  );
}

// ── Screen: profile (step 2) ─────────────────────────────────────────────

const PROFILE_FIELDS: Array<{
  key: "category" | "audience" | "whatItDoes" | "valueProp" | "pricingModel";
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: "category", label: "Category", placeholder: "e.g. Appointment-scheduling software" },
  { key: "audience", label: "Target audience", placeholder: "e.g. Independent clinics of 5–50 staff" },
  {
    key: "whatItDoes",
    label: "What it does",
    placeholder: "Concretely, what the product does and its real capabilities",
    multiline: true,
  },
  {
    key: "valueProp",
    label: "Value proposition",
    placeholder: "The concrete job it does and the outcome, no filler",
    multiline: true,
  },
  { key: "pricingModel", label: "Pricing model", placeholder: "e.g. Freemium + Pro at $20/mo" },
];

// One line of the profile: a summary to read, editable where it's wrong. The screen
// used to open on five fields, two of them three-row textareas, right after an
// automated extraction — shaped for correction, so it read as work even when
// nothing was off. Same data, same edits, a fraction of the perceived effort.
function EditableRow({
  id,
  label,
  value,
  placeholder,
  multiline,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 py-1.5">
        <Label htmlFor={id} className="text-meta text-muted-foreground">
          {label}
        </Label>
        {multiline ? (
          <Textarea
            id={id}
            autoFocus
            rows={3}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
        ) : (
          <Input
            id={id}
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditing(true)}
      className="group -mx-2 flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
        {label}
        <PencilSimpleLineIcon
          size={14}
          className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </span>
      <span className={cn("text-sm", value ? "text-foreground" : "text-muted-foreground")}>
        {value || placeholder}
      </span>
    </button>
  );
}

function ProfileForm({
  profile,
  setProfile,
  notice,
  sourceEcho,
  onConfirm,
  onBack,
  busy,
  prefetchStatus,
  mode,
  productName,
  setProductName,
  askName,
  region,
  onRegionChange,
}: {
  profile: ProductProfile;
  setProfile: (p: ProductProfile) => void;
  notice: ReactNode;
  sourceEcho: string | null;
  onConfirm: () => void | Promise<void>;
  onBack: () => void;
  busy: boolean;
  prefetchStatus: "idle" | "running" | "completed";
  mode: OnboardingMode;
  productName: string;
  setProductName: (v: string) => void;
  // A description / document / repo run has no hostname to name the product after.
  askName: boolean;
  region: string | null;
  onRegionChange: (region: string | null) => void;
}) {
  return (
    <div>
      {sourceEcho && <StepEcho>Read from {sourceEcho}</StepEcho>}
      <h1 className="text-title md:text-title-lg font-semibold mt-1">
        Did we get your product right?
      </h1>
      <p className="text-sm text-muted-foreground mt-3">
        Click any line to change it. What's here decides which competitors we look for.
      </p>

      {notice}

      {/* The name is the one thing on this screen we did not read anywhere, so it
          stays a real field and stays out of the card that claims to be extracted. */}
      {askName && (
        <Card className="p-5 sm:p-6 mt-6 flex flex-col gap-1.5">
          <Label htmlFor="product-name" className="text-sm">
            Product name
          </Label>
          <Input
            id="product-name"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="My product"
            maxLength={80}
            disabled={busy}
          />
          <p className="text-dense text-muted-foreground">
            We have no site to take a name from. You can change it later.
          </p>
        </Card>
      )}

      <Card className="p-5 sm:p-6 mt-6">
        <div className="flex flex-col">
          {PROFILE_FIELDS.map((f) => (
            <EditableRow
              key={f.key}
              id={`field-${f.key}`}
              label={f.label}
              value={profile[f.key] ?? ""}
              placeholder={f.placeholder}
              multiline={f.multiline}
              disabled={busy}
              onChange={(v) => setProfile({ ...profile, [f.key]: v })}
            />
          ))}
        </div>

        {(profile.keywords?.length ?? 0) > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-meta text-muted-foreground">Search keywords</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {profile.keywords!.map((k) => (
                <span
                  key={k}
                  className="rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-meta text-muted-foreground"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* The marker used to float between two cards at 12px, attached to neither.
            It describes this card, so it is a caption inside it. */}
        <p className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-dense text-muted-foreground">
          <SparkleIcon size={14} className="text-primary shrink-0" /> Extracted by AI from what
          you gave us
        </p>
      </Card>

      {/* Asked here, before the first search, rather than on the competitor screen
          where changing it threw the curated list away. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Label htmlFor="discover-market" className="text-sm text-muted-foreground">
          Find competitors in
        </Label>
        <Select
          value={region ?? "global"}
          onValueChange={(v) => onRegionChange(v === "global" ? null : v)}
          disabled={busy}
        >
          <SelectTrigger id="discover-market" className="h-8 w-auto min-w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Global (no preference)</SelectItem>
            {DISCOVERY_REGIONS.map((r) => (
              <SelectItem key={r.code} value={r.code}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="w-full text-dense text-muted-foreground sm:w-auto">
          Biases results toward a market. Global players still show up.
        </span>
      </div>

      {prefetchStatus === "running" && (
        <p className="mt-4 flex items-center gap-1.5 text-dense text-muted-foreground">
          <SpinnerIcon size={14} className="animate-spin" /> Searching competitors…
        </p>
      )}
      {prefetchStatus === "completed" && (
        <p className="mt-4 flex items-center gap-1.5 text-dense text-positive">
          <CheckIcon size={14} /> Competitors found
        </p>
      )}

      <FooterNav
        onBack={onBack}
        onSubmit={onConfirm}
        busy={busy}
        busyLabel="Finding competitors…"
        primaryLabel={mode === "quick_start" ? "Looks right, find competitors" : "Looks right"}
      />
    </div>
  );
}

// ── Screen: discover (step 3) ────────────────────────────────────────────

function DiscoverStep({
  competitors,
  notice,
  categoryEcho,
  regionLabel,
  busy,
  completing,
  selectedCount,
  maxCompetitors,
  frequency,
  sources,
  toggleCompetitor,
  removeCompetitor,
  manualUrl,
  setManualUrl,
  addManualCompetitor,
  onConfirm,
  onBack,
  onRefine,
  onUpgrade,
}: {
  competitors: Selection[];
  notice: ReactNode;
  categoryEcho: string | null;
  regionLabel: string;
  busy: boolean;
  completing: boolean;
  selectedCount: number;
  maxCompetitors: number;
  frequency: Frequency;
  sources: SourceType[];
  toggleCompetitor: (url: string) => void;
  removeCompetitor: (url: string) => void;
  manualUrl: string;
  setManualUrl: (v: string) => void;
  addManualCompetitor: () => void;
  onConfirm: () => void;
  onBack: () => void;
  onRefine: () => void;
  onUpgrade: () => void;
}) {
  const atLimit = selectedCount >= maxCompetitors;
  const noStrongMatch =
    !busy && competitors.length > 0 && competitors.every((c) => c.overlapScore < 30);
  const watched =
    sources.length > 1
      ? `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`
      : sources.join("");

  return (
    <div>
      {categoryEcho && (
        <StepEcho>
          {categoryEcho} · {regionLabel}
        </StepEcho>
      )}
      <h1 className="text-title md:text-title-lg font-semibold mt-1">Your competitors</h1>
      <p className="text-sm text-muted-foreground mt-3">
        Check the ones that really matter. You can add or remove more later.
      </p>

      {notice ??
        (noStrongMatch ? (
          <Notice
            action={
              <Button size="sm" variant="outline" onClick={onRefine}>
                Refine my profile
              </Button>
            }
          >
            We didn't find any obvious competitors for this profile.
          </Notice>
        ) : null)}

      {/* The search used to replace this whole step with a wait screen, which read
          as "you can't be here yet" for the fifteen seconds it ran. The step keeps
          its shape now and the wait sits where the list will land, so arriving
          early is a normal state: the market line and the manual field stay usable. */}
      <BudgetMeter
        selected={selectedCount}
        max={maxCompetitors}
        found={competitors.length}
        searching={busy}
        onUpgrade={onUpgrade}
      />

      {busy ? (
        <WaitChecklist title="Searching your market…" steps={DISCOVERY_STEPS} stepMs={6000} />
      ) : (
        <Card className="mt-3 p-2 sm:p-3 max-h-[420px] overflow-auto">
          {competitors.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No competitors suggested. Add some manually below.
            </div>
          ) : (
            <ul className="flex flex-col">
              {competitors.map((c) => (
                <CompetitorRow
                  key={c.url}
                  competitor={c}
                  overBudget={atLimit && !c.selected}
                  onToggle={() => toggleCompetitor(c.url)}
                  onRemove={() => removeCompetitor(c.url)}
                />
              ))}
            </ul>
          )}
        </Card>
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
            <PlusIcon size={16} /> Add
          </Button>
        </div>
      </div>

      {/* What gets monitored is decided by the plan, not by a step, and it used to
          be asserted for the first time after the flow was over. One line, above
          the button that acts on it. */}
      <p className="mt-8 flex items-start gap-2 text-dense text-muted-foreground">
        <EyeIcon size={16} className="mt-px shrink-0" />
        <span>
          We'll read each one's {watched}, {frequency}. Change that any time in Settings.
        </span>
      </p>

      <FooterNav
        onBack={onBack}
        onSubmit={onConfirm}
        busy={completing}
        busyLabel="Setting up…"
        primaryLabel="Start monitoring"
        primaryDisabled={selectedCount === 0}
      />
    </div>
  );
}

// The plan's competitor budget, stated before it is enforced. Free tracks 2:
// discovery returns ten or more, pre-selects the two strongest, and the third
// click opened a paywall — the most commercially important moment of the flow
// arriving as an error. Over budget is not blocked here, it is kept for later.
function BudgetMeter({
  selected,
  max,
  found,
  searching,
  onUpgrade,
}: {
  selected: number;
  max: number;
  found: number;
  searching: boolean;
  onUpgrade: () => void;
}) {
  const capped = Number.isFinite(max);
  const atLimit = capped && selected >= max;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-foreground">
          {capped ? (
            <>
              Tracking <span className="tabular-nums">{selected}</span> of{" "}
              <span className="tabular-nums">{max}</span>
            </>
          ) : (
            <>
              <span className="tabular-nums">{selected}</span> selected
            </>
          )}
        </p>
        {/* "0 found" mid-search reads as a result, not a pending one. */}
        {searching ? (
          <p className="flex items-center gap-1.5 text-dense text-muted-foreground">
            <SpinnerIcon size={14} className="animate-spin" /> Searching…
          </p>
        ) : (
          <p className="text-dense text-muted-foreground">
            <span className="tabular-nums text-foreground">{found}</span> found
          </p>
        )}
      </div>

      {capped && max <= 10 && (
        <div className="mt-2 flex gap-1" aria-hidden>
          {Array.from({ length: max }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-200",
                i < selected ? "bg-primary" : "bg-stroke",
              )}
            />
          ))}
        </div>
      )}

      {atLimit ? (
        // The rows over budget are inert now, so the limit no longer explains itself
        // on the click that hits it. It says so here, next to the way past it.
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-dense text-muted-foreground">
            That's every slot your plan tracks. The rest stay in Detections, ready to track
            later.
          </p>
          <Button variant="ghost" size="sm" onClick={onUpgrade}>
            Track more
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-dense text-muted-foreground">
          Whatever you leave unchecked stays in Detections, ready to track later.
        </p>
      )}
    </div>
  );
}

// One company per row, not four fragments in forty pixels: name and overlap on the
// first line, host on the second in sans, one line of snippet. Once the plan's slots
// are full the remaining rows go inert — dimmed, checkbox disabled, no toggle — so
// the limit is visible before the click rather than as a paywall after it. Removing
// a row and opening its site stay live: neither spends a slot.
function CompetitorRow({
  competitor,
  overBudget,
  onToggle,
  onRemove,
}: {
  competitor: Selection;
  overBudget: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 rounded-md transition-colors",
        overBudget ? "opacity-60" : "cursor-pointer hover:bg-surface-2",
        competitor.selected && "bg-primary/5",
      )}
      onClick={overBudget ? undefined : onToggle}
      aria-disabled={overBudget || undefined}
      title={competitor.reason}
    >
      <Checkbox
        checked={competitor.selected}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        disabled={overBudget}
        className="mt-0.5"
        aria-label={`Track ${competitor.title}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{competitor.title}</span>
          {competitor.overlapScore > 0 && <OverlapBadge score={competitor.overlapScore} />}
          {overBudget && (
            <span className="shrink-0 text-meta text-muted-foreground">Kept for later</span>
          )}
        </div>
        <a
          href={competitor.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-meta text-muted-foreground hover:text-foreground inline-flex items-center gap-1 max-w-full transition-colors"
        >
          <span className="truncate">{competitor.url.replace(/^https?:\/\//, "")}</span>
          <ArrowSquareOutIcon size={14} className="shrink-0" />
        </a>
        {competitor.snippet && (
          <p className="text-dense text-muted-foreground mt-0.5 truncate">{competitor.snippet}</p>
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
        <TrashIcon size={16} />
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
        "text-meta px-1.5 py-0.5 font-medium border rounded tabular-nums",
        classes,
      )}
    >
      {Math.round(score)}%
    </span>
  );
}
