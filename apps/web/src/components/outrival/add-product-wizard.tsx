"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileText,
  GitBranch,
  Globe,
  Lightbulb,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type ProductProfile, type ProjectStage } from "@/lib/api";
import { PLAN_LABELS, type Plan } from "@outrival/shared";
import { useSetProductScope } from "@/components/dashboard/product-scope-provider";
import { toastApiError } from "@/lib/error-helpers";
import { isValidHttpUrl } from "@/lib/utils";

// "Add product" as a mini-onboarding (patch-28 multi-SKU). Adding a 2nd+ product used
// to be a bare name+URL insert, so the SKU landed unanalysed and Discovery was blocked
// ("missing profile"). This wizard mirrors onboarding: pick a stage → derive a profile
// (URL / description / repo / document) → edit it → create the product with the profile
// seeded synchronously → kick off discovery for it → switch scope to it.

type Screen = "stage" | "input" | "profile" | "discover";

const STAGES: {
  key: ProjectStage;
  label: string;
  hint: string;
  icon: typeof Globe;
}[] = [
  { key: "live", label: "Live site", hint: "It has a public website — we'll analyze and monitor it.", icon: Globe },
  { key: "developing", label: "In development", hint: "A public GitHub repo we can read for a profile.", icon: GitBranch },
  { key: "idea", label: "Idea", hint: "Describe it in a few words — no site yet.", icon: Lightbulb },
  { key: "document", label: "Document", hint: "Upload a spec or deck — read in memory, never stored.", icon: FileText },
];

function blankProfile(seedCategory = ""): ProductProfile {
  return { category: seedCategory, audience: "", valueProp: "", pricingModel: "" };
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
  const [busy, setBusy] = useState<null | "analyze" | "create" | "discover">(null);

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
  const [discoverError, setDiscoverError] = useState<string | null>(null);

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
  }

  function close() {
    if (busy) return;
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
        toast.info("Automatic analysis didn't work — fill the profile in manually.", {
          description: reason,
        });
        setProfile(blankProfile(category.trim()));
        setScreen("profile");
      } else if (e instanceof ApiError && e.status === 429) {
        toast.error("Analysis is rate-limited — try again in a moment.");
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

  const profileReady = profile.category.trim() !== "" || profile.valueProp.trim() !== "";

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
    setBusy("discover");
    setDiscoverError(null);
    try {
      const { detected } = await api.detectCandidates(pid);
      setDetected(detected);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setDiscoverError("Discovery is rate-limited right now — you can run it later from the Discovery page.");
      } else {
        setDiscoverError("Couldn't run discovery now — you can run it later from the Discovery page.");
      }
    } finally {
      setBusy(null);
    }
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
  // "Invalid body" 400 from the backend validator.
  const urlInvalid = stage === "live" && url.trim().length > 0 && !isValidHttpUrl(url);
  const repoInvalid =
    stage === "developing" && repoUrl.trim().length > 0 && !isValidHttpUrl(repoUrl);

  const canAnalyze =
    !!name.trim() &&
    ((stage === "live" && isValidHttpUrl(url)) ||
      (stage === "developing" && isValidHttpUrl(repoUrl)) ||
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
                We&apos;ll analyze it, build a profile, and find its competitors — like onboarding, for this SKU.
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
                    <Upload size={14} className="mr-2" />
                    {file ? file.name : "Choose a file (PDF, DOCX, TXT, MD — max 10MB)"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Read in memory to build the profile, never stored.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => setScreen("stage")} disabled={!!busy}>
                <ArrowLeft size={14} className="mr-1" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={fillManually} disabled={!!busy || !name.trim()}>
                  Fill manually
                </Button>
                <Button onClick={analyze} disabled={!!busy || !canAnalyze}>
                  {busy === "analyze" ? (
                    <Loader2 size={14} className="mr-1 animate-spin" />
                  ) : (
                    <Sparkles size={14} className="mr-1" />
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
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wiz-p-cat">Category</Label>
                <Input
                  id="wiz-p-cat"
                  placeholder="Marketing automation"
                  value={profile.category}
                  onChange={(e) => setProfile((p) => ({ ...p, category: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wiz-p-aud">Audience</Label>
                <Input
                  id="wiz-p-aud"
                  placeholder="Mid-market marketing teams"
                  value={profile.audience}
                  onChange={(e) => setProfile((p) => ({ ...p, audience: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wiz-p-vp">Value proposition</Label>
                <Textarea
                  id="wiz-p-vp"
                  placeholder="Plan, schedule and measure campaigns across every channel from one place."
                  value={profile.valueProp}
                  onChange={(e) => setProfile((p) => ({ ...p, valueProp: e.target.value }))}
                  rows={3}
                />
              </div>
              {!profileReady && (
                <p className="text-xs text-muted-foreground">
                  Add at least a category or a value proposition to enable discovery.
                </p>
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => setScreen("input")} disabled={!!busy}>
                <ArrowLeft size={14} className="mr-1" />
                Back
              </Button>
              <Button onClick={createAndDiscover} disabled={!!busy || !name.trim() || !profileReady}>
                {busy === "create" && <Loader2 size={14} className="mr-1 animate-spin" />}
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
                We&apos;re monitoring it and looking for competitors.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              {busy === "discover" ? (
                <>
                  <Loader2 size={28} className="animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Finding competitors…</p>
                </>
              ) : discoverError ? (
                <p className="text-sm text-muted-foreground">{discoverError}</p>
              ) : (
                <>
                  <Sparkles size={28} className="text-primary" />
                  <p className="text-content font-medium">
                    {detected && detected > 0
                      ? `Found ${detected} competitor${detected > 1 ? "s" : ""} to review`
                      : "No new competitors found yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {detected && detected > 0
                      ? "Review and add the ones that matter to this product."
                      : "We'll keep looking — you can run discovery again anytime."}
                  </p>
                </>
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => finish("dashboard")} disabled={!!busy}>
                Go to dashboard
              </Button>
              <Button onClick={() => finish("discovery")} disabled={!!busy}>
                Review competitors
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
