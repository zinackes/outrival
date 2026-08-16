"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  CircleIcon,
  ClockIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  LightbulbIcon,
  SpinnerIcon,
  SparkleIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from "@/components/icons";
import { toast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  ApiError,
  type CompetitorCandidate,
  type ProductProfile,
  type ProjectStage,
} from "@/lib/api";
import { PLAN_LABELS, hasDiscoveryInputs, type Plan } from "@outrival/shared";
import { useSetProductScope } from "@/components/dashboard/product-scope-provider";
import { toastApiError } from "@/lib/error-helpers";
import { discoverOutcome, type DiscoverOutcome } from "@/lib/discovery-outcome";
import { cn, isGitHubRepoUrl, isValidHttpUrl } from "@/lib/utils";

// "Add product" as a mini-onboarding (patch-28 multi-SKU). Adding a 2nd+ product used
// to be a bare name+URL insert, so the SKU landed unanalysed and Discovery was blocked
// ("missing profile"). This wizard mirrors onboarding: pick a stage → derive a profile
// (URL / description / repo / document) → edit it → create the product with the profile
// seeded synchronously → kick off discovery for it → pick the competitors to track →
// switch scope to it.

type Screen = "stage" | "input" | "profile" | "discover";

const STAGES: {
  key: ProjectStage;
  label: string;
  hint: string;
  icon: typeof GlobeIcon;
}[] = [
  { key: "live", label: "Live site", hint: "It has a public website. We'll analyze and monitor it.", icon: GlobeIcon },
  { key: "developing", label: "In development", hint: "A public GitHub repo we can read for a profile.", icon: GitBranchIcon },
  { key: "idea", label: "Idea", hint: "Describe it in a few words, no site yet.", icon: LightbulbIcon },
  { key: "document", label: "Document", hint: "Upload a spec or deck, read in memory and never stored.", icon: FileTextIcon },
];

function blankProfile(seedCategory = ""): ProductProfile {
  return { category: seedCategory, audience: "", valueProp: "", pricingModel: "" };
}

// The editable text fields, same set and same wording as onboarding's profile step
// (apps/web/src/app/(onboarding)/onboarding/onboarding-form.tsx). This screen used to
// show three of them, so a SKU added from Settings was reviewed on strictly less than
// what onboarding asks for. `keywords` stays read-only chips here as it does there.
type ProfileTextKey = "category" | "audience" | "whatItDoes" | "valueProp" | "pricingModel";

const PROFILE_FIELDS: Array<{
  key: ProfileTextKey;
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

// What discovery is actually doing, in order (apps/api/src/lib/detect-candidates.ts):
// name the competitors we can already reason about, run the Exa search, then score
// each hit's overlap. The API is one blocking POST with no progress channel, so this
// advances on a timer rather than on server events — the STEPS are real, the timings
// are the observed shape of a run. It never claims a step finished that the run has
// not reached: the last one stays active until the request itself resolves.
const DISCOVER_STEPS = [
  { label: "Reading your product profile", after: 0 },
  { label: "Searching the market for similar companies", after: 4000 },
  { label: "Scoring how much each one overlaps with you", after: 14000 },
] as const;

function DiscoverProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 500);
    return () => clearInterval(id);
  }, []);

  const activeIndex = DISCOVER_STEPS.reduce(
    (acc, s, i) => (elapsed >= s.after ? i : acc),
    0,
  );

  return (
    <div className="flex flex-col gap-3 py-2">
      {DISCOVER_STEPS.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <div key={s.label} className="flex items-center gap-2.5">
            {done ? (
              <CheckIcon size={16} className="shrink-0 text-positive" />
            ) : active ? (
              <SpinnerIcon size={16} className="shrink-0 animate-spin text-primary" />
            ) : (
              <CircleIcon size={16} className="shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={cn(
                "text-sm",
                done || active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </div>
        );
      })}
      <p className="mt-1 text-xs text-muted-foreground">
        Usually 15 to 45 seconds. You can leave this open, or close it and pick the
        results up on the Discovery page.
      </p>
    </div>
  );
}

// One selectable discovery result. Same anatomy as onboarding's competitor row
// (checkbox, name + overlap, linked host, snippet) minus its per-row remove: nothing
// is persisted here until "Track", so there is nothing to remove yet.
function CandidateRow({
  candidate,
  checked,
  disabled,
  onToggle,
}: {
  candidate: CompetitorCandidate;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const host = candidate.url.replace(/^https?:\/\//, "");
  return (
    <li
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 transition-colors",
        disabled ? "opacity-50" : "cursor-pointer hover:bg-surface-2",
        checked && "bg-primary/5",
      )}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      title={
        disabled
          ? "No competitor seat left on your plan"
          : (candidate.reason ?? undefined)
      }
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5"
        aria-label={`Track ${candidate.title ?? host}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{candidate.title ?? host}</span>
          {candidate.overlapScore != null && candidate.overlapScore > 0 && (
            <span className="text-meta rounded border border-border px-1.5 py-0.5 text-muted-foreground tabular-nums">
              {Math.round(candidate.overlapScore)}%
            </span>
          )}
        </div>
        <a
          href={candidate.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-meta mt-0.5 inline-flex max-w-full items-center gap-1 font-mono text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="truncate">{host}</span>
          <ArrowSquareOutIcon size={14} className="shrink-0" />
        </a>
        {candidate.snippet && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{candidate.snippet}</p>
        )}
      </div>
    </li>
  );
}

export function AddProductWizard({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setScope = useSetProductScope();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [screen, setScreen] = useState<Screen>("stage");
  const [stage, setStage] = useState<ProjectStage | null>(null);
  const [busy, setBusy] = useState<null | "analyze" | "create">(null);

  // inputs
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // derived / editable profile + created product
  const [profile, setProfile] = useState<ProductProfile>(blankProfile());
  const [productId, setProductId] = useState<string | null>(null);
  const [detected, setDetected] = useState<number | null>(null);
  // Why discovery produced nothing, as a titled outcome rather than one sentence: the
  // product is already created at this point, so the screen has to say which of the
  // refusals happened (still running / rate-limited / quota / failed) and whether
  // retrying it here can work at all.
  const [discoverError, setDiscoverError] = useState<DiscoverOutcome | null>(null);
  // The discovery step's own lifecycle, kept OUT of `busy`. `busy` is cleared by every
  // action's `finally`, and createAndDiscover's finally ran after runDiscover had set
  // busy="discover" — so the screen rendered its terminal branch ("No new competitors
  // found yet") while the search was still in flight. That is the "it says there are
  // none before it even looked" report.
  const [discoverPhase, setDiscoverPhase] = useState<"idle" | "searching" | "done">("idle");
  // Everything discovery put in the review queue — the whole list, not a preview slice:
  // this step selects competitors like onboarding's does, so truncating it would hide
  // choices the user is being asked to make.
  const [candidates, setCandidates] = useState<CompetitorCandidate[]>([]);
  // Competitor seats left on the plan, straight from the queue endpoint. Caps how many
  // rows can be checked here, so the selection can't promise more than the plan allows.
  const [seats, setSeats] = useState<{ used: number; limit: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [tracking, setTracking] = useState(false);

  function reset() {
    setScreen("stage");
    setStage(null);
    setBusy(null);
    setName("");
    setUrl("");
    setRepoUrl("");
    setDescription("");
    setCategory("");
    setFile(null);
    setProfile(blankProfile());
    setProductId(null);
    setDetected(null);
    setDiscoverError(null);
    setDiscoverPhase("idle");
    setCandidates([]);
    setSeats(null);
    setSelected(new Set());
    setTracking(false);
  }

  function close() {
    if (busy || tracking) return;
    onOpenChange(false);
    // Defer reset so the closing animation doesn't flash the first screen.
    setTimeout(reset, 150);
  }

  function pickStage(s: ProjectStage) {
    setStage(s);
    setScreen("input");
  }

  // Derive a profile from the chosen input. On failure, degrade to manual entry
  // (prefilled with whatever we have) rather than dead-ending — same as onboarding.
  async function analyze() {
    if (!stage) return;
    setBusy("analyze");
    try {
      let res: { profile: ProductProfile };
      if (stage === "live") res = await api.analyzeProductUrl(url.trim());
      else if (stage === "developing") res = await api.analyzeProductRepo(repoUrl.trim());
      else if (stage === "document") {
        if (!file) throw new Error("Choose a file first");
        res = await api.analyzeProductDocument(file);
      } else {
        res = await api.analyzeProductDescription({
          description: description.trim(),
          category: category.trim() || undefined,
        });
      }
      setProfile(res.profile);
      setScreen("profile");
    } catch (e) {
      const fellBack = e instanceof ApiError && e.data?.fallback === "description";
      if (fellBack) {
        // Show the API's human reason (e.data.error), never the raw `API 4xx: {json}`
        // envelope that lives on e.message.
        const reason =
          e instanceof ApiError && typeof e.data.error === "string" ? e.data.error : undefined;
        toast.info("Automatic analysis didn't work. Fill the profile in manually.", {
          description: reason,
        });
        setProfile(blankProfile(category.trim()));
        setScreen("profile");
      } else if (e instanceof ApiError && e.status === 429) {
        toast.error("Analysis is rate-limited. Try again in a moment.");
      } else {
        toastApiError(e, { title: "Analysis failed" });
      }
    } finally {
      setBusy(null);
    }
  }

  // Skip AI derivation and go straight to manual profile entry.
  function fillManually() {
    setProfile(blankProfile(category.trim()));
    setScreen("profile");
  }

  // Same predicate the API refuses discovery with (`selfProfileToDiscoveryProfile`),
  // so this button can't hand over a profile the very next call answers
  // `missing_profile` to.
  const profileReady = hasDiscoveryInputs(profile);

  // Create the product with the (edited) profile seeded synchronously, then move to
  // the discovery step and kick off detection for it.
  async function createAndDiscover() {
    if (!name.trim() || !profileReady) return;
    setBusy("create");
    try {
      const { product } = await api.createProduct({
        name: name.trim(),
        url: stage === "live" ? url.trim() || undefined : undefined,
        repoUrl: stage === "developing" ? repoUrl.trim() || undefined : undefined,
        profile,
      });
      setProductId(product.id);
      onCreated();
      // Refresh every products cache (settings + the list the scope provider / switcher
      // read) so the new SKU is present before finish() switches scope to it — otherwise
      // the provider's self-heal drops the scope back to "all".
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      setScreen("discover");
      void runDiscover(product.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "plan_limit_products") {
        const suggested = e.data.suggestedPlan as Plan | undefined;
        toast.error(
          `You've reached your plan's product limit (${e.data.limit}).` +
            (suggested ? ` Upgrade to ${PLAN_LABELS[suggested]} for more.` : ""),
        );
      } else {
        toastApiError(e, { title: "Couldn't add the product" });
      }
    } finally {
      setBusy(null);
    }
  }

  async function runDiscover(pid: string) {
    setDiscoverPhase("searching");
    setDiscoverError(null);
    try {
      const { detected } = await api.detectCandidates(pid);
      setDetected(detected);
      if (detected > 0) {
        // Read back the review queue so this step can list AND select the companies,
        // like onboarding's discover step. A failure here degrades to the count alone,
        // which is still true — the Discovery page then does the selecting.
        const res = await api.listCandidates("new", pid).catch(() => null);
        if (res) {
          const ranked = [...res.candidates].sort(
            (a, b) => (b.overlapScore ?? 0) - (a.overlapScore ?? 0),
          );
          setCandidates(ranked);
          setSeats(res.seats);
          // Pre-check the strong matches up to the free seats — same rule as
          // onboarding, so the common case is one click.
          const free = Math.max(0, res.seats.limit - res.seats.used);
          const picks = new Set<string>();
          for (const c of ranked) {
            if (picks.size >= free) break;
            if ((c.overlapScore ?? 0) > 60) picks.add(c.id);
          }
          setSelected(picks);
        }
      }
    } catch (e) {
      // Each refusal reads differently (a client timeout is not a failure at all, a
      // monthly quota is not a rate limit, a 500 is neither), and none of them means
      // the product wasn't created. discoverOutcome() keeps that copy in one place.
      setDiscoverError(discoverOutcome(e));
    } finally {
      setDiscoverPhase("done");
    }
  }

  // Re-run discovery for the product this wizard already created. Only offered for the
  // refusals another attempt can actually clear (a 500, a dropped connection, the short
  // cooldown), never for a spent quota.
  function retryDiscover() {
    if (!productId || discoverPhase === "searching") return;
    void runDiscover(productId);
  }

  const seatsFree = seats ? Math.max(0, seats.limit - seats.used) : null;
  const atSeatLimit = seatsFree !== null && selected.size >= seatsFree;

  function toggleCandidate(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Track the checked candidates for this product. Sequential on purpose: the seat
  // quota is re-checked server-side on every add, so a parallel burst would race it
  // and overshoot the plan cap. A refusal stops the loop and keeps the modal open on
  // what is left, rather than silently dropping the rest.
  async function trackSelected() {
    const ids = candidates.filter((c) => selected.has(c.id)).map((c) => c.id);
    if (ids.length === 0) return;
    setTracking(true);
    let added = 0;
    let stopped = false;
    try {
      for (const id of ids) {
        try {
          await api.addCandidate(id);
        } catch (e) {
          if (e instanceof ApiError && e.code === "plan_limit_competitors") {
            toast.error(`You've reached your plan's competitor limit (${e.data.limit}).`, {
              description: "The others stay in Discovery, ready when you upgrade.",
            });
          } else {
            toastApiError(e, { title: "Couldn't track every competitor" });
          }
          stopped = true;
          break;
        }
        added += 1;
        setCandidates((prev) => prev.filter((c) => c.id !== id));
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setSeats((prev) => (prev ? { ...prev, used: prev.used + 1 } : prev));
      }
    } finally {
      setTracking(false);
    }
    if (added > 0) {
      void queryClient.invalidateQueries({ queryKey: ["competitors"] });
      void queryClient.invalidateQueries({ queryKey: ["candidates"] });
      toast.success(
        `${added} competitor${added > 1 ? "s" : ""} now tracked for ${name.trim() || "this product"}`,
        { description: "Their homepage, pricing and blog are being captured now." },
      );
    }
    if (!stopped) finish("dashboard");
  }

  // Finish: switch the active scope to the new product and navigate.
  function finish(target: "dashboard" | "discovery") {
    const pid = productId;
    onOpenChange(false);
    if (pid) setScope(pid);
    router.push(
      target === "discovery" && pid
        ? `/dashboard/discovery?product=${pid}`
        : "/dashboard",
    );
    setTimeout(reset, 150);
  }

  // Validate the URL / repo shape client-side so an obviously-bad value is caught in
  // the form (inline hint + disabled Analyze) instead of bouncing back as a raw
  // "Invalid body" 400 from the backend validator. The repo gate is the stricter
  // GitHub rule, same as onboarding: any other host passes `url()` server-side but
  // yields a `github_repo` monitor that silently never resolves.
  const urlInvalid = stage === "live" && url.trim().length > 0 && !isValidHttpUrl(url);
  const repoInvalid =
    stage === "developing" && repoUrl.trim().length > 0 && !isGitHubRepoUrl(repoUrl);

  const canAnalyze =
    !!name.trim() &&
    ((stage === "live" && isValidHttpUrl(url)) ||
      (stage === "developing" && isGitHubRepoUrl(repoUrl)) ||
      (stage === "document" && !!file) ||
      (stage === "idea" && description.trim().length >= 10));

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-2xl">
        {screen === "stage" && (
          <>
            <DialogHeader>
              <DialogTitle>Add a product</DialogTitle>
              <DialogDescription>
                We&apos;ll analyze it, build a profile, and find its competitors, like onboarding but for this SKU.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-2 sm:grid-cols-2">
              {STAGES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => pickStage(s.key)}
                  className="group flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <s.icon size={18} className="text-muted-foreground group-hover:text-foreground" />
                  <span className="font-medium">{s.label}</span>
                  <span className="text-sm text-muted-foreground">{s.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {screen === "input" && stage && (
          <>
            <DialogHeader>
              <DialogTitle>
                {STAGES.find((s) => s.key === stage)?.label ?? "Product"} details
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wiz-name">Product name</Label>
                <Input
                  id="wiz-name"
                  placeholder="Marketing Hub"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              {stage === "live" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wiz-url">Site URL</Label>
                  <Input
                    id="wiz-url"
                    type="url"
                    placeholder="https://example.com/marketing"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-invalid={urlInvalid}
                    aria-describedby={urlInvalid ? "wiz-url-error" : undefined}
                  />
                  {urlInvalid && (
                    <p id="wiz-url-error" className="text-xs text-destructive">
                      Enter a full URL starting with http:// or https://.
                    </p>
                  )}
                </div>
              )}

              {stage === "developing" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wiz-repo">Public GitHub repo</Label>
                  <Input
                    id="wiz-repo"
                    type="url"
                    placeholder="https://github.com/owner/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    aria-invalid={repoInvalid}
                    aria-describedby={repoInvalid ? "wiz-repo-error" : undefined}
                  />
                  {repoInvalid && (
                    <p id="wiz-repo-error" className="text-xs text-destructive">
                      Enter a full repo URL, e.g. https://github.com/owner/repo.
                    </p>
                  )}
                </div>
              )}

              {stage === "idea" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wiz-desc">What is it?</Label>
                    <Textarea
                      id="wiz-desc"
                      placeholder="A tool that helps marketing teams plan and schedule campaigns across channels…"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wiz-cat">Category (optional)</Label>
                    <Input
                      id="wiz-cat"
                      placeholder="Marketing automation"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    />
                  </div>
                </>
              )}

              {stage === "document" && (
                <div className="flex flex-col gap-1.5">
                  <Label>Spec or deck</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.md,.docx"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="justify-start font-normal"
                  >
                    <UploadSimpleIcon size={16} className="mr-2" />
                    {file ? file.name : "Choose a file (PDF, DOCX, TXT, MD, max 10MB)"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Read in memory to build the profile, never stored.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => setScreen("stage")} disabled={!!busy}>
                <ArrowLeftIcon size={16} className="mr-1" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={fillManually} disabled={!!busy || !name.trim()}>
                  Fill manually
                </Button>
                <Button onClick={analyze} disabled={!!busy || !canAnalyze}>
                  {busy === "analyze" ? (
                    <SpinnerIcon size={16} className="mr-1 animate-spin" />
                  ) : (
                    <SparkleIcon size={16} className="mr-1" />
                  )}
                  Analyze
                </Button>
              </div>
            </DialogFooter>
          </>
        )}

        {screen === "profile" && (
          <>
            <DialogHeader>
              <DialogTitle>Review the profile</DialogTitle>
              <DialogDescription>
                This drives competitor discovery. Edit anything that&apos;s off.
              </DialogDescription>
            </DialogHeader>
            {/* Onboarding's full field set, so the modal can outgrow the viewport. */}
            <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto py-2 pr-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <SparkleIcon size={14} className="text-primary" /> Extracted by AI
              </div>
              {PROFILE_FIELDS.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`wiz-p-${f.key}`}>{f.label}</Label>
                  {f.multiline ? (
                    <Textarea
                      id={`wiz-p-${f.key}`}
                      placeholder={f.placeholder}
                      value={profile[f.key] ?? ""}
                      onChange={(e) => setProfile((p) => ({ ...p, [f.key]: e.target.value }))}
                      rows={3}
                    />
                  ) : (
                    <Input
                      id={`wiz-p-${f.key}`}
                      placeholder={f.placeholder}
                      value={profile[f.key] ?? ""}
                      onChange={(e) => setProfile((p) => ({ ...p, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
              {(profile.keywords?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label>Search keywords</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.keywords!.map((k) => (
                      <span
                        key={k}
                        className="rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    We use these to find competitors that do the same thing.
                  </p>
                </div>
              )}
              {!profileReady && (
                <p className="text-xs text-muted-foreground">
                  Add at least a category or a value proposition to enable discovery.
                </p>
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => setScreen("input")} disabled={!!busy}>
                <ArrowLeftIcon size={16} className="mr-1" />
                Back
              </Button>
              <Button onClick={createAndDiscover} disabled={!!busy || !name.trim() || !profileReady}>
                {busy === "create" && <SpinnerIcon size={16} className="mr-1 animate-spin" />}
                Create & find competitors
              </Button>
            </DialogFooter>
          </>
        )}

        {screen === "discover" && (
          <>
            <DialogHeader>
              <DialogTitle>{name.trim() || "Product"} is set up</DialogTitle>
              <DialogDescription>
                {discoverPhase !== "done"
                  ? "It's being monitored. We're looking for its competitors now."
                  : discoverError
                    ? discoverError.tone === "pending"
                      ? "It's created and being monitored. The competitor search is still running."
                      : "It's created and being monitored. The competitor search is what didn't go through."
                    : "It's being monitored. Here's what discovery came back with."}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {discoverPhase !== "done" ? (
                <DiscoverProgress />
              ) : discoverError ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-border px-4 py-6 text-center">
                  {discoverError.tone === "pending" ? (
                    <ClockIcon size={24} className="text-muted-foreground" />
                  ) : (
                    <WarningCircleIcon size={24} className="text-critical" />
                  )}
                  <p className="text-content font-medium">{discoverError.title}</p>
                  <p className="text-sm text-muted-foreground">{discoverError.description}</p>
                  {discoverError.canRetry && (
                    <Button variant="secondary" size="sm" onClick={retryDiscover}>
                      <ArrowClockwiseIcon size={16} />
                      Try discovery again
                    </Button>
                  )}
                </div>
              ) : detected && detected > 0 ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-content font-medium">
                      Found {detected} competitor{detected > 1 ? "s" : ""}
                    </p>
                    {candidates.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <span className="tabular-nums text-foreground">{selected.size}</span>
                        {seatsFree !== null && (
                          <>
                            {" / "}
                            <span className="tabular-nums text-foreground">{seatsFree}</span>
                          </>
                        )}{" "}
                        selected
                      </p>
                    )}
                  </div>
                  {candidates.length > 0 ? (
                    <>
                      <ul className="flex max-h-[42vh] flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
                        {candidates.map((c) => (
                          <CandidateRow
                            key={c.id}
                            candidate={c}
                            checked={selected.has(c.id)}
                            disabled={tracking || (atSeatLimit && !selected.has(c.id))}
                            onToggle={() => toggleCandidate(c.id)}
                          />
                        ))}
                      </ul>
                      <p className="text-sm text-muted-foreground">
                        {seatsFree === 0
                          ? `Your plan's ${seats!.limit} competitor seats are all in use. These stay in Discovery until you upgrade.`
                          : atSeatLimit
                            ? `That's every free seat of your plan's ${seats!.limit}. The rest stay in Discovery.`
                            : "Checked ones start being monitored for this product. The rest stay in Discovery."}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Review them on the Discovery page and add the ones that matter to this
                      product.
                    </p>
                  )}
                </div>
              ) : (
                // Only reachable once the search actually resolved with zero rows. A
                // zero here can also mean "everything we found, you already track" —
                // detection dedupes against the org's existing competitors — so don't
                // assert the market is empty.
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <SparkleIcon size={24} className="text-primary" />
                  <p className="text-content font-medium">Nothing new to review yet</p>
                  <p className="text-sm text-muted-foreground">
                    We found no competitor for this product that you aren&apos;t already
                    tracking. We keep looking every week, and you can search again from the
                    Discovery page.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => finish("dashboard")} disabled={tracking}>
                Go to dashboard
              </Button>
              {candidates.length > 0 ? (
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => finish("discovery")} disabled={tracking}>
                    Review in Discovery
                  </Button>
                  <Button onClick={trackSelected} disabled={tracking || selected.size === 0}>
                    {tracking && <SpinnerIcon size={16} className="mr-1 animate-spin" />}
                    {selected.size > 0
                      ? `Track ${selected.size} competitor${selected.size > 1 ? "s" : ""}`
                      : "Track competitors"}
                  </Button>
                </div>
              ) : (
                <Button onClick={() => finish("discovery")}>
                  {detected && detected > 0 ? "Review competitors" : "Open Discovery"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
