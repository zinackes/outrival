"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  SpinnerIcon,
  SparkleIcon,
  GlobeIcon,
  GitBranchIcon,
  FileTextIcon,
  LightbulbIcon,
  UploadSimpleIcon,
  ArrowsClockwiseIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
} from "@/components/icons";
import { toast } from "sonner";
import { api, type ProductProfile, type ProjectStage } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Diff-aware update modal — replaces the full-page re-onboarding for profile
// updates. Default path is a pure edit (no AI). Re-analyze is opt-in: it re-runs
// the matching analyze-* for the current source/stage, then shows a field-level
// diff so the user keeps or adopts each new value. Saving syncs the org product
// profile AND the My Product self-profile (shared fields), with stickiness driven
// by which fields the user typed by hand vs accepted from the re-analysis.

type ModalMode = "update" | "setup";

const EMPTY: ProductProfile = {
  category: "",
  audience: "",
  valueProp: "",
  pricingModel: "",
  whatItDoes: "",
};

// The editable text fields (excludes `keywords`, which is a string[] fed to
// discovery, not a typed field). Narrowed so `working[key]` is always a string.
type ProfileTextKey = "category" | "audience" | "whatItDoes" | "valueProp" | "pricingModel";

// Required to save — `whatItDoes` is encouraged but never blocks (the AI fills it,
// and legacy profiles predate it). `pricingModel` is optional too: a free /
// open-source product legitimately has no pricing, and the AI leaves it blank.
const REQUIRED_FIELDS: ProfileTextKey[] = ["category", "audience", "valueProp"];

const STAGES: { key: ProjectStage; label: string; hint: string; icon: typeof GlobeIcon }[] = [
  { key: "idea", label: "Idea", hint: "Describe it in a few words, no site yet.", icon: LightbulbIcon },
  { key: "document", label: "Pitch / brief", hint: "A spec or deck, read in memory and never stored.", icon: FileTextIcon },
  { key: "developing", label: "Building", hint: "A public GitHub repo we can read for a profile.", icon: GitBranchIcon },
  { key: "live", label: "Live", hint: "It has a public website. We analyze and monitor it.", icon: GlobeIcon },
];

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

// Fields mirrored to the My Product self-profile (pricingModel/whatItDoes stay
// org-only — the self-profile schema doesn't carry them).
const SHARED_FIELDS = ["category", "audience", "valueProp"] as const;
type SharedField = (typeof SHARED_FIELDS)[number];
const isShared = (k: keyof ProductProfile): k is SharedField =>
  (SHARED_FIELDS as readonly string[]).includes(k);

function changedKeys(before: ProductProfile, after: ProductProfile): ProfileTextKey[] {
  return PROFILE_FIELDS.map((f) => f.key).filter(
    (k) => (before[k] ?? "").trim() !== (after[k] ?? "").trim(),
  );
}

export function UpdateProfileDialog({
  open,
  onOpenChange,
  mode = "update",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: ModalMode;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<ProjectStage | null>(null);
  const [baseStage, setBaseStage] = useState<ProjectStage | null>(null);

  // Working (editable) profile + the originally-loaded baseline for dirty detection.
  const [working, setWorking] = useState<ProductProfile>(EMPTY);
  const [baseline, setBaseline] = useState<ProductProfile>(EMPTY);

  // Source inputs per stage + the originally-loaded source values (dirty / change
  // detection — a new live URL or repo must be persisted, not just the profile text).
  const [productUrl, setProductUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [baseProductUrl, setBaseProductUrl] = useState("");
  const [baseRepoUrl, setBaseRepoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [ideaCategory, setIdeaCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // The before/after snapshot of the last re-analysis (drives the diff rows).
  const [reanalysis, setReanalysis] = useState<{
    before: ProductProfile;
    after: ProductProfile;
  } | null>(null);
  // Fields the user typed by hand (vs accepted from a re-analysis) → sticky on sync.
  const [manual, setManual] = useState<Set<keyof ProductProfile>>(new Set());

  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Two-step flow: pick the lifecycle stage first, then edit source + profile.
  const [step, setStep] = useState<"stage" | "details">("stage");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setReanalysis(null);
    setManual(new Set());
    setFile(null);
    setStep("stage");
    Promise.all([api.onboardingStatus(), api.getMyProduct().catch(() => ({ product: null }))])
      .then(([status, my]) => {
        if (!active) return;
        const profile = status.profile ?? EMPTY;
        setWorking(profile);
        setBaseline(profile);
        setStage(status.projectStage);
        setBaseStage(status.projectStage);
        setProductUrl(status.productUrl ?? "");
        setRepoUrl(my.product?.repoUrl ?? "");
        setBaseProductUrl(status.productUrl ?? "");
        setBaseRepoUrl(my.product?.repoUrl ?? "");
        setDescription("");
        setIdeaCategory(profile.category ?? "");
      })
      .catch((e) => toastApiError(e, { title: "Couldn't load your profile" }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open]);

  function setField(key: keyof ProductProfile, value: string) {
    setWorking((w) => ({ ...w, [key]: value }));
    setManual((m) => new Set(m).add(key));
  }

  function pickDiff(key: keyof ProductProfile, which: "keep" | "new") {
    if (!reanalysis) return;
    setWorking((w) => ({
      ...w,
      [key]: which === "new" ? reanalysis.after[key] : reanalysis.before[key],
    }));
    // Either choice is analysis-derived, not a hand edit → drop stickiness.
    setManual((m) => {
      const next = new Set(m);
      next.delete(key);
      return next;
    });
  }

  const sourceValid =
    stage === "live"
      ? isValidUrl(productUrl)
      : stage === "developing"
        ? isGitHubRepoUrl(repoUrl)
        : stage === "document"
          ? file !== null
          : stage === "idea"
            ? description.trim().length >= 10
            : false;

  async function reanalyze() {
    if (!stage || !sourceValid) return;
    setAnalyzing(true);
    try {
      let res: { profile: ProductProfile };
      if (stage === "live") {
        res = await api.analyzeUrl(productUrl.trim());
      } else if (stage === "developing") {
        res = await api.analyzeRepo(repoUrl.trim());
      } else if (stage === "document") {
        if (!file) return;
        res = await api.analyzeDocument(file);
      } else {
        const insp = ideaCategory; // category hint reused; inspirations omitted in the modal
        res = await api.analyzeDescription({
          description: description.trim(),
          category: insp.trim() || undefined,
        });
      }
      // Keep the current values in the form; the diff rows below let the user adopt
      // each new value one by one (a visible field update) rather than silently
      // overwriting everything — so "Use new" actually shows the change happening.
      setReanalysis({ before: { ...working }, after: res.profile });
      // keywords have no diff row — adopt the fresh set silently so a re-analysis
      // still refreshes what discovery searches on.
      setWorking((w) => ({ ...w, keywords: res.profile.keywords ?? w.keywords }));
      setManual(new Set());
      toast.success("Re-analyzed. Review the proposed changes below");
    } catch (e) {
      toastApiError(e, { title: "Re-analysis failed" });
    } finally {
      setAnalyzing(false);
    }
  }

  const emptyField = REQUIRED_FIELDS.some((k) => !(working[k] ?? "").trim());
  // A new live URL / repo is a real change even when the stage and profile text are
  // unchanged — it must enable Save and be persisted (wires up monitoring).
  const liveSourceChanged =
    stage === "live" && isValidUrl(productUrl) && productUrl.trim() !== baseProductUrl.trim();
  const repoSourceChanged =
    stage === "developing" && isGitHubRepoUrl(repoUrl) && repoUrl.trim() !== baseRepoUrl.trim();
  const dirty =
    reanalysis !== null ||
    stage !== baseStage ||
    liveSourceChanged ||
    repoSourceChanged ||
    PROFILE_FIELDS.some((f) => (working[f.key] ?? "").trim() !== (baseline[f.key] ?? "").trim());

  async function save() {
    // Save is gated on `emptyField` (footer button + the inline hint below the
    // fields), so this only runs once the required fields are filled.
    if (emptyField) return;
    setSaving(true);
    try {
      const manualShared = [...manual].filter(isShared);
      await api.patchProductProfile(working, manualShared);

      // patchProductProfile only saves the profile text. A source change (going live,
      // or attaching a repo) must also be persisted — this is what actually sets the
      // product URL, seeds the site monitors and kicks off the first scrape. Skipped
      // during first-time setup (the self-product is created later, at /complete).
      let wentLive = false;
      if (mode !== "setup") {
        if (liveSourceChanged) {
          await api.setMyProductSite(productUrl.trim());
          wentLive = true;
        } else if (repoSourceChanged) {
          await api.setMyProductRepo(repoUrl.trim());
        }
        if (liveSourceChanged || repoSourceChanged) {
          // Going live renames the product row from its URL and gives it a favicon
          // — refresh every ["products"] cache (switcher roster, detail title,
          // settings list) so the new identity shows without a hard reload.
          void queryClient.invalidateQueries({ queryKey: ["products"] });
        }
      }

      toast.success(
        wentLive
          ? "Saved, scanning your site now…"
          : mode === "setup"
            ? "Profile saved"
            : "Profile updated",
      );
      onSaved?.();
      onOpenChange(false);
      if (mode === "setup") {
        // First-time setup still needs competitors — drop the user straight onto
        // the discovery step rather than re-walking the profile screens.
        await api.patchOnboardingProgress("discover").catch(() => {});
        router.push("/onboarding");
      }
    } catch (e) {
      toastApiError(e, { title: "Couldn't save the profile" });
    } finally {
      setSaving(false);
    }
  }

  const diffRows = reanalysis ? changedKeys(reanalysis.before, reanalysis.after) : [];
  const activeStage = STAGES.find((s) => s.key === stage) ?? null;
  const ActiveStageIcon = activeStage?.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "setup" ? "Complete your product profile" : "Update product profile"}
          </DialogTitle>
          <DialogDescription>
            {step === "stage"
              ? "First, tell us where your product is in its lifecycle."
              : "Edit the profile directly, or re-analyze your source when it has changed, and we'll show you exactly what moved."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground">
            <SpinnerIcon size={16} className="animate-spin" />
          </div>
        ) : step === "stage" ? (
          /* Step 1 — pick the product's lifecycle stage (mirrors the add-product wizard) */
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {STAGES.map((s) => {
                const Icon = s.icon;
                const active = stage === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStage(s.key)}
                    aria-pressed={active}
                    className={cn(
                      "group flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/[0.06] ring-1 ring-primary/40"
                        : "border-border bg-card hover:border-primary/50 hover:bg-accent",
                    )}
                  >
                    <Icon
                      size={20}
                      className={cn(
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    />
                    <span className="font-medium">{s.label}</span>
                    <span className="text-sm text-muted-foreground">{s.hint}</span>
                  </button>
                );
              })}
            </div>
            {stage && stage !== baseStage && (
              <p className="text-meta text-muted-foreground">
                Changing the stage updates which source we monitor next.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Selected stage recap — change it via Back */}
            {activeStage && ActiveStageIcon && (
              <div className="flex items-center gap-2 text-dense">
                <ActiveStageIcon size={14} className="text-primary" />
                <span className="font-medium text-foreground">{activeStage.label}</span>
                <span className="text-muted-foreground">stage</span>
              </div>
            )}

            {/* Source + re-analyze */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Source
              </Label>
              {stage === "live" && (
                <Input
                  type="url"
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  placeholder="https://yourproduct.com"
                />
              )}
              {stage === "developing" && (
                <Input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                />
              )}
              {stage === "idea" && (
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your concept in a few words to re-extract the profile…"
                  rows={3}
                />
              )}
              {stage === "document" && (
                <label className="flex items-center gap-2 rounded-md border border-dashed border-border-strong px-3 py-2.5 cursor-pointer hover:bg-surface-2 text-sm">
                  <UploadSimpleIcon size={16} className="text-muted-foreground" />
                  <span className={file ? "text-foreground" : "text-muted-foreground"}>
                    {file ? file.name : "Select a pitch / brief (PDF, DOCX, MD, TXT)"}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.docx,.md,.markdown,.txt"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
              {!stage && (
                <p className="text-xs text-muted-foreground">Pick a stage to set a source.</p>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-meta text-muted-foreground">
                  Re-analyze re-extracts the profile and updates your source.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reanalyze}
                  disabled={!sourceValid || analyzing}
                >
                  {analyzing ? (
                    <SpinnerIcon size={16} className="animate-spin" />
                  ) : (
                    <ArrowsClockwiseIcon size={16} />
                  )}
                  Re-analyze
                </Button>
              </div>
            </div>

            {/* Diff rows (only after a re-analysis, only for changed fields) */}
            {reanalysis && diffRows.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-meta font-medium text-primary">
                    <SparkleIcon size={14} /> Re-analysis · review {diffRows.length} change
                    {diffRows.length > 1 ? "s" : ""}
                  </div>
                  <button
                    type="button"
                    className="text-meta font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => diffRows.forEach((key) => pickDiff(key, "new"))}
                  >
                    Use all new
                  </button>
                </div>
                {diffRows.map((key) => {
                  const label = PROFILE_FIELDS.find((f) => f.key === key)?.label ?? key;
                  const before = (reanalysis.before[key] ?? "").trim();
                  const after = (reanalysis.after[key] ?? "").trim();
                  const cur = (working[key] ?? "").trim();
                  return (
                    <div key={key} className="flex flex-col gap-1 border-t border-border/50 pt-2 first:border-t-0 first:pt-0">
                      <span className="text-meta font-medium text-muted-foreground">
                        {label}
                      </span>
                      <div className="text-xs leading-relaxed">
                        <span className="text-muted-foreground line-through">
                          {before || "—"}
                        </span>
                        <ArrowRightIcon className="mx-1.5 inline size-3.5 text-muted-foreground" />
                        <span className="text-foreground">{after || "—"}</span>
                      </div>
                      <div className="flex gap-1.5 mt-0.5">
                        <Button
                          type="button"
                          size="sm"
                          variant={cur === before ? "default" : "outline"}
                          className="h-6 text-meta"
                          onClick={() => pickDiff(key, "keep")}
                        >
                          Keep old
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={cur === after ? "default" : "outline"}
                          className="h-6 text-meta"
                          onClick={() => pickDiff(key, "new")}
                        >
                          Use new
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Editable profile fields */}
            <div className="flex flex-col gap-4">
              {PROFILE_FIELDS.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`upd-${f.key}`} className="text-sm">
                    {f.label}
                  </Label>
                  {f.multiline ? (
                    <Textarea
                      id={`upd-${f.key}`}
                      value={working[f.key] ?? ""}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      rows={3}
                    />
                  ) : (
                    <Input
                      id={`upd-${f.key}`}
                      value={working[f.key] ?? ""}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  )}
                </div>
              ))}
            </div>

            {emptyField && (
              <p className="text-xs text-critical">
                Category, target audience and value proposition are required.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "stage" ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => setStep("details")}
                disabled={loading || !stage}
              >
                Continue
                <ArrowRightIcon size={16} />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("stage")}
                disabled={saving}
              >
                <ArrowLeftIcon size={16} />
                Back
              </Button>
              <Button size="sm" onClick={save} disabled={saving || loading || !dirty || emptyField}>
                {saving && <SpinnerIcon size={16} className="animate-spin" />}
                {mode === "setup" ? "Save & find competitors" : "Save changes"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isGitHubRepoUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return false;
    return u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}
