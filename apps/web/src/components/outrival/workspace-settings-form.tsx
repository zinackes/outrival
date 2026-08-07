"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowsClockwiseIcon, CopyIcon, PencilIcon } from "@/components/icons";
import { toast } from "@/lib/toast";
import { api, type ProjectStage, type WorkspaceSettings } from "@/lib/api";
import { productsListQuery, workspaceSettingsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SettingRow } from "@/components/dashboard/settings-page";
import {
  SettingCardRowsSkeleton,
  SettingRowsSkeleton,
} from "@/components/dashboard/skeletons";
import { useSettingsSaveBar } from "@/components/dashboard/settings-save-bar";
import { SettingsError } from "@/components/outrival/list-error";
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
  const [changeUrlOpen, setChangeUrlOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  // No saving/saved state here any more: the page's save bar owns both.
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

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Workspace name is required");
      throw new Error("Workspace name is required");
    }
    setError(null);
    try {
      await api.updateWorkspaceSettings({ name: draft.name.trim() });
      setPristine(draft);
    } catch (e) {
      setError(errorMessage(e));
      // Rethrow so the page's save bar stops before claiming "Saved"; the inline
      // message below the field is the user-facing surface.
      throw e;
    }
  }

  function handleCancel() {
    if (pristine) setDraft(pristine);
    setError(null);
  }

  // The page owns the save bar (settings layout); this section reports to it.
  const dirty = draft != null && pristine != null && !isEqual(draft, pristine);
  useSettingsSaveBar({
    id: "workspace",
    label: "Workspace",
    dirty,
    save: handleSave,
    reset: handleCancel,
  });

  if ((error || settingsQ.error) && !draft)
    return (
      <SettingsError
        title="Workspace settings didn't load"
        error={settingsQ.error ?? new Error(error ?? "")}
        onRetry={() => void settingsQ.refetch()}
      />
    );
  if (!draft || !pristine) return <SettingRowsSkeleton rows={3} />;

  return (
    // No <form> and no sticky bar of its own: the page owns both. Enter in a field
    // no longer submits, which is why the save bar is always reachable instead.
    <div className="flex flex-col">
      <SettingRow
        htmlFor="ws-name"
        label="Workspace name"
        control={
          <Input
            id="ws-name"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Acme Inc."
            className="h-9 w-64 text-dense"
          />
        }
      />

      {/* The slug used to be a hint line under the name. It is an identifier you
          paste into links and exports, so it is a field. */}
      {slug && (
        <SettingRow
          label="Workspace address"
          hint="Used in links and exports. Fixed once set."
          control={
            <>
              <Input
                readOnly
                value={slug}
                aria-label="Workspace address"
                className="h-9 w-48 bg-surface-2 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(slug);
                  toast.success("Address copied");
                }}
              >
                <CopyIcon size={16} />
                Copy
              </Button>
            </>
          }
        />
      )}

      <SettingRow
        htmlFor="ws-url"
        label="Product URL"
        hint="The site we scan for your product, and the reference for competitor discovery. Changing it re-scans the site and refreshes the profile."
        control={
          <>
            <Input
              id="ws-url"
              type="url"
              value={draft.productUrl}
              placeholder="No product URL set"
              readOnly
              className="h-9 w-56 bg-surface-2 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setChangeUrlOpen(true)}
            >
              <PencilIcon size={16} />
              Change
            </Button>
          </>
        }
      />

      <SettingRow
        label="Project stage"
        hint="Where your primary product stands, and the source we read to profile it. Re-analyzing keeps your tracked competitors."
        control={
          <>
            <span className="text-dense text-muted-foreground">
              {stage ? STAGE_LABELS[stage] : "Not set"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setUpdateOpen(true)}
            >
              <ArrowsClockwiseIcon size={16} />
              Re-analyze
            </Button>
          </>
        }
      />

      {error && (
        <p role="alert" className="pt-3 text-dense text-destructive">
          {error}
        </p>
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
    </div>
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
export function ProductProfileList() {
  // Warm: the shell fetches this roster for the product switcher on every navigation.
  const productsQ = useQuery(productsListQuery());
  const products = (productsQ.data ?? []).filter((p) => p.status !== "archived");

  if (productsQ.isLoading) return <SettingCardRowsSkeleton rows={2} />;

  if (products.length === 0) {
    return (
      <p className="text-dense text-muted-foreground">
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
