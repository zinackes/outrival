"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Sparkles,
  Globe,
  GitBranch,
  FileText,
  Lightbulb,
  Upload,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
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

const EMPTY: ProductProfile = { category: "", audience: "", valueProp: "", pricingModel: "" };

const STAGES: { key: ProjectStage; label: string; icon: typeof Globe }[] = [
  { key: "idea", label: "Idea", icon: Lightbulb },
  { key: "document", label: "Pitch / brief", icon: FileText },
  { key: "developing", label: "Building", icon: GitBranch },
  { key: "live", label: "Live", icon: Globe },
];

const PROFILE_FIELDS: Array<{
  key: keyof ProductProfile;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: "category", label: "Category", placeholder: "e.g. B2B SaaS CRM" },
  { key: "audience", label: "Target audience", placeholder: "e.g. Sales teams of 10–200" },
  {
    key: "valueProp",
    label: "Value proposition",
    placeholder: "What makes your product unique",
    multiline: true,
  },
  { key: "pricingModel", label: "Pricing model", placeholder: "e.g. Freemium + Pro at $20/mo" },
];

// Fields mirrored to the My Product self-profile (pricingModel stays org-only).
const SHARED_FIELDS = ["category", "audience", "valueProp"] as const;
type SharedField = (typeof SHARED_FIELDS)[number];
const isShared = (k: keyof ProductProfile): k is SharedField =>
  (SHARED_FIELDS as readonly string[]).includes(k);

function changedKeys(before: ProductProfile, after: ProductProfile): Array<keyof ProductProfile> {
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
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<ProjectStage | null>(null);
  const [baseStage, setBaseStage] = useState<ProjectStage | null>(null);

  // Working (editable) profile + the originally-loaded baseline for dirty detection.
  const [working, setWorking] = useState<ProductProfile>(EMPTY);
  const [baseline, setBaseline] = useState<ProductProfile>(EMPTY);

  // Source inputs per stage.
  const [productUrl, setProductUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
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

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setReanalysis(null);
    setManual(new Set());
    setFile(null);
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
      setReanalysis({ before: { ...working }, after: res.profile });
      setWorking(res.profile);
      setManual(new Set());
      toast.success("Re-analyzed — review the changes below");
    } catch (e) {
      toastApiError(e, { title: "Re-analysis failed" });
    } finally {
      setAnalyzing(false);
    }
  }

  const emptyField = PROFILE_FIELDS.some((f) => !(working[f.key] ?? "").trim());
  const dirty =
    reanalysis !== null ||
    stage !== baseStage ||
    PROFILE_FIELDS.some((f) => (working[f.key] ?? "").trim() !== (baseline[f.key] ?? "").trim());

  async function save() {
    if (emptyField) {
      toast.error("All profile fields are required");
      return;
    }
    setSaving(true);
    try {
      const manualShared = [...manual].filter(isShared);
      await api.patchProductProfile(working, manualShared);
      toast.success(mode === "setup" ? "Profile saved" : "Profile updated");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "setup" ? "Complete your product profile" : "Update product profile"}
          </DialogTitle>
          <DialogDescription>
            Edit the profile directly, or re-analyze your source when it has changed —
            we&apos;ll show you exactly what moved.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Stage */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Stage
              </Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
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
                        "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-meta transition-all",
                        active
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40 text-foreground"
                          : "border-border hover:border-border-strong hover:bg-surface-2 text-muted-foreground",
                      )}
                    >
                      <Icon size={15} className={active ? "text-primary" : undefined} />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

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
                  <Upload size={14} className="text-muted-foreground" />
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
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  Re-analyze
                </Button>
              </div>
            </div>

            {/* Diff rows (only after a re-analysis, only for changed fields) */}
            {reanalysis && diffRows.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-3">
                <div className="flex items-center gap-1.5 text-meta font-medium text-primary">
                  <Sparkles size={12} /> Re-analysis · review {diffRows.length} change
                  {diffRows.length > 1 ? "s" : ""}
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
                        <ArrowRight className="mx-1.5 inline size-3 text-muted-foreground" />
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
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || loading || !dirty || emptyField}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            {mode === "setup" ? "Save & find competitors" : "Save changes"}
          </Button>
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
