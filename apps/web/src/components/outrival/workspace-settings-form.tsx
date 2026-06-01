"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api, type ProjectStage, type WorkspaceSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSkeleton } from "@/components/dashboard/skeletons";

const STAGE_LABELS: Record<ProjectStage, string> = {
  idea: "Idea to explore",
  document: "Pitch / brief",
  developing: "In development (repo)",
  live: "Live product",
};

interface Draft {
  name: string;
  productUrl: string;
  category: string;
  audience: string;
  valueProp: string;
  pricingModel: string;
}

function toDraft(s: WorkspaceSettings): Draft {
  return {
    name: s.name,
    productUrl: s.productUrl ?? "",
    category: s.productProfile?.category ?? "",
    audience: s.productProfile?.audience ?? "",
    valueProp: s.productProfile?.valueProp ?? "",
    pricingModel: s.productProfile?.pricingModel ?? "",
  };
}

function isEqual(a: Draft, b: Draft) {
  return (
    a.name === b.name &&
    a.productUrl === b.productUrl &&
    a.category === b.category &&
    a.audience === b.audience &&
    a.valueProp === b.valueProp &&
    a.pricingModel === b.pricingModel
  );
}

export function WorkspaceSettingsForm() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pristine, setPristine] = useState<Draft | null>(null);
  const [slug, setSlug] = useState("");
  const [stage, setStage] = useState<ProjectStage | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [reonboarding, setReonboarding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getWorkspaceSettings()
      .then((s) => {
        const d = toDraft(s);
        setDraft(d);
        setPristine(d);
        setSlug(s.slug);
        setStage(s.projectStage);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Re-run the onboarding flow to refine the profile / change stage. Existing
  // competitors are preserved — /complete only ever inserts.
  async function reonboard() {
    setReonboarding(true);
    setError(null);
    try {
      await api.patchOnboardingProgress("stage");
      router.push("/onboarding");
    } catch (e) {
      setError(String(e));
      setReonboarding(false);
    }
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Workspace name is required");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const body: {
        name: string;
        productUrl?: string;
        productProfile?: {
          category: string;
          audience: string;
          valueProp: string;
          pricingModel: string;
        };
      } = { name: draft.name.trim() };
      if (draft.productUrl.trim()) body.productUrl = draft.productUrl.trim();
      const anyProfile = [
        draft.category,
        draft.audience,
        draft.valueProp,
        draft.pricingModel,
      ].some((v) => v.trim());
      if (anyProfile) {
        body.productProfile = {
          category: draft.category.trim(),
          audience: draft.audience.trim(),
          valueProp: draft.valueProp.trim(),
          pricingModel: draft.pricingModel.trim(),
        };
      }
      await api.updateWorkspaceSettings(body);
      setPristine(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function reanalyze() {
    if (!draft) return;
    const url = draft.productUrl.trim();
    if (!url) {
      setError("Enter a product URL first");
      return;
    }
    setAnalyzing(true);
    setError(null);
    try {
      // analyze persists productUrl + productProfile server-side.
      const { profile } = await api.analyzeUrl(url);
      const patch = {
        productUrl: url,
        category: profile.category,
        audience: profile.audience,
        valueProp: profile.valueProp,
        pricingModel: profile.pricingModel,
      };
      setDraft((d) => (d ? { ...d, ...patch } : d));
      // url + profile are now persisted; keep any unsaved name change dirty.
      setPristine((p) => (p ? { ...p, ...patch } : p));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  function handleCancel() {
    if (pristine) setDraft(pristine);
    setError(null);
  }

  if (error && !draft)
    return <p className="text-sm text-muted-foreground">Error: {error}</p>;
  if (!draft || !pristine) return <FormSkeleton fields={3} />;

  const dirty = !isEqual(draft, pristine);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-xl">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ws-name">Workspace name</Label>
        <Input
          id="ws-name"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Acme Inc."
        />
        {slug && (
          <p className="text-xs text-muted-foreground">
            Slug: <span className="font-mono">{slug}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ws-url">Product URL</Label>
        <div className="flex gap-2">
          <Input
            id="ws-url"
            type="url"
            value={draft.productUrl}
            onChange={(e) => set("productUrl", e.target.value)}
            placeholder="https://yourproduct.com"
          />
          <Button
            type="button"
            variant="outline"
            onClick={reanalyze}
            disabled={analyzing || !draft.productUrl.trim()}
            title="Re-analyze the profile from this URL"
          >
            {analyzing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {analyzing ? "Analyzing…" : "Re-analyze"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Used as the reference for competitor discovery. Re-analyze to refresh
          the profile below from a new URL.
        </p>
      </div>

      <div className="flex flex-col gap-4 pt-1">
        <h3 className="text-sm font-medium tracking-tight">Product profile</h3>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-category">Category</Label>
          <Input
            id="ws-category"
            value={draft.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder="Competitive intelligence SaaS"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-audience">Audience</Label>
          <Input
            id="ws-audience"
            value={draft.audience}
            onChange={(e) => set("audience", e.target.value)}
            placeholder="Product & marketing teams at B2B startups"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-value">Value proposition</Label>
          <Textarea
            id="ws-value"
            value={draft.valueProp}
            onChange={(e) => set("valueProp", e.target.value)}
            placeholder="Automatically monitor competitors and surface strategic insights."
            rows={3}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-pricing">Pricing model</Label>
          <Input
            id="ws-pricing"
            value={draft.pricingModel}
            onChange={(e) => set("pricingModel", e.target.value)}
            placeholder="Subscription, tiered per seat"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-4 border-t border-border">
        <h3 className="text-sm font-medium tracking-tight">Project stage</h3>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            {stage ? STAGE_LABELS[stage] : "Not set"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reonboard}
            disabled={reonboarding}
            title="Re-run onboarding to refine your profile — your competitors stay"
          >
            {reonboarding ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Update my product profile
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Re-running onboarding doesn&apos;t remove the competitors you track.
        </p>
      </div>

      {saved && !dirty && <p className="text-sm text-positive">✓ Saved</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 px-4 py-2.5 rounded-md border border-border-strong bg-surface/95 backdrop-blur-sm shadow-lg">
          <span className="text-xs text-muted-foreground">
            You have unsaved changes.
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 size={12} className="animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
