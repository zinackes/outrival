"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, SpinnerIcon, ArrowsClockwiseIcon, PencilIcon } from "@/components/icons";
import { api, type ProjectStage, type WorkspaceSettings } from "@/lib/api";
import { productsListQuery, workspaceSettingsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton } from "@/components/dashboard/skeletons";
import { ProductTile } from "@/components/dashboard/product-tile";
import { ChangeProductUrlDialog } from "@/components/outrival/change-product-url-dialog";
import { UpdateProfileDialog } from "@/components/outrival/update-profile-dialog";
import { errorMessage } from "@/lib/error-helpers";

const STAGE_LABELS: Record<ProjectStage, string> = {
  idea: "Idea to explore",
  document: "Pitch / brief",
  developing: "In development (repo)",
  live: "Live product",
};

interface Draft {
  name: string;
  productUrl: string;
}

function toDraft(s: WorkspaceSettings): Draft {
  return { name: s.name, productUrl: s.productUrl ?? "" };
}

function isEqual(a: Draft, b: Draft) {
  return a.name === b.name && a.productUrl === b.productUrl;
}

export function WorkspaceSettingsForm() {
  // Server-seeded on first paint (settings/general/page.tsx). draft/pristine/slug/
  // stage lazy-init from the hydrated cache; a sync effect fills them in when the
  // seed was missing and the query resolves client-side.
  const settingsQ = useQuery(workspaceSettingsQuery());
  const [draft, setDraft] = useState<Draft | null>(() =>
    settingsQ.data ? toDraft(settingsQ.data) : null,
  );
  const [pristine, setPristine] = useState<Draft | null>(() =>
    settingsQ.data ? toDraft(settingsQ.data) : null,
  );
  const [slug, setSlug] = useState(settingsQ.data?.slug ?? "");
  const [stage, setStage] = useState<ProjectStage | null>(
    settingsQ.data?.projectStage ?? null,
  );
  const initializedRef = useRef(settingsQ.data != null);
  const [saving, setSaving] = useState(false);
  const [changeUrlOpen, setChangeUrlOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the form once the settings are available (covers the non-seeded path);
  // guarded so a later refetch can't clobber the user's in-progress edits.
  useEffect(() => {
    if (initializedRef.current || !settingsQ.data) return;
    initializedRef.current = true;
    const d = toDraft(settingsQ.data);
    setDraft(d);
    setPristine(d);
    setSlug(settingsQ.data.slug);
    setStage(settingsQ.data.projectStage);
  }, [settingsQ.data]);

  // Re-sync the form from the server (the profile dialog calls this after saving).
  async function load() {
    const { data } = await settingsQ.refetch();
    if (data) {
      const d = toDraft(data);
      setDraft(d);
      setPristine(d);
      setSlug(data.slug);
      setStage(data.projectStage);
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
      await api.updateWorkspaceSettings({ name: draft.name.trim() });
      setPristine(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (pristine) setDraft(pristine);
    setError(null);
  }

  if ((error || settingsQ.error) && !draft)
    return (
      <p className="text-sm text-muted-foreground">
        {error ?? errorMessage(settingsQ.error)}
      </p>
    );
  if (!draft || !pristine) return <FormSkeleton fields={3} />;

  const dirty = !isEqual(draft, pristine);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
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
            placeholder="No product URL set"
            readOnly
            className="bg-muted/40"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setChangeUrlOpen(true)}
            title="Change the monitored product URL"
          >
            <PencilIcon size={16} />
            Change URL
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The site we monitor for your product, and the reference for competitor
          discovery. Changing it re-scans the site and refreshes the profile.
        </p>
      </div>

      <div className="flex flex-col gap-3 pt-1">
        <div>
          <h3 className="text-sm font-medium tracking-tight">Product profiles</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Each product carries its own: what it is, who it is for, what it
            promises. Open one to edit it.
          </p>
        </div>
        <ProductProfileList />
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
            onClick={() => setUpdateOpen(true)}
            title="Re-analyze your source or change the stage. Your competitors stay"
          >
            <ArrowsClockwiseIcon size={16} />
            Re-analyze my product
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Where your primary product stands, and the source we read to profile it.
          Re-analyzing keeps your tracked competitors.
        </p>
      </div>

      {saved && !dirty && (
        <p className="flex items-center gap-1.5 text-sm text-positive">
          <CheckIcon className="size-3.5" /> Saved
        </p>
      )}
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
              {saving && <SpinnerIcon size={16} className="animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}

      <ChangeProductUrlDialog
        open={changeUrlOpen}
        onOpenChange={setChangeUrlOpen}
        currentUrl={draft.productUrl || null}
        onSaved={(url) => {
          setDraft((d) => (d ? { ...d, productUrl: url } : d));
          setPristine((p) => (p ? { ...p, productUrl: url } : p));
        }}
      />

      <UpdateProfileDialog open={updateOpen} onOpenChange={setUpdateOpen} onSaved={load} />
    </form>
  );
}

/**
 * One read-only row per product, each linking to the profile editor that owns it.
 *
 * Settings used to edit a profile inline, but the field it wrote (the org's
 * `productProfile`) is workspace-wide and predates multi-SKU: a workspace with three
 * products showed one profile and silently applied every edit to a single anchor. The
 * per-product profile already has an editor with everything this form lacked
 * (stickiness against re-scans, features, tech stack, pricing tiers), so this names
 * the products and sends the user there instead of keeping a second, thinner one.
 */
function ProductProfileList() {
  // Warm: the shell fetches this roster for the product switcher on every navigation.
  const productsQ = useQuery(productsListQuery());
  const products = (productsQ.data ?? []).filter((p) => p.status !== "archived");

  if (productsQ.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No product yet.{" "}
        <Link
          href="/dashboard/settings/products"
          className="text-link underline-offset-2 hover:underline"
        >
          Add one
        </Link>{" "}
        to give discovery something to compare against.
      </p>
    );
  }

  return (
    <Card className="divide-y divide-border p-0">
      {products.map((p) => {
        // Category and audience are the two lines that answer "is this profile still
        // right", which is the only question this list exists to let the user ask.
        const lines = [p.profile?.category, p.profile?.audience].filter(Boolean);
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <ProductTile
              name={p.name}
              url={p.url}
              repoUrl={p.repoUrl}
              position={p.position}
              size={26}
              ring
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{p.name}</span>
                {p.isPrimary && (
                  <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                    Primary
                  </span>
                )}
              </div>
              <span className="truncate text-meta text-muted-foreground">
                {lines.length > 0 ? lines.join(" · ") : "No profile yet"}
              </span>
            </div>
            <Button asChild variant="ghost" size="sm" className="ml-auto shrink-0">
              <Link href={`/dashboard/products/${p.id}?tab=positioning`}>
                <PencilIcon size={16} />
                Edit profile
              </Link>
            </Button>
          </div>
        );
      })}
    </Card>
  );
}
