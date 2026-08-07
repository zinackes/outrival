"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SpinnerIcon, LockIcon } from "@/components/icons";
import { toast } from "@/lib/toast";
import {
  PLAN_LABELS,
  minPlanForSource,
  REQUIRED_SEED_SOURCE,
  type SourceType,
} from "@outrival/shared";
import { api } from "@/lib/api";
import { sourceDefaultsQuery } from "@/lib/queries";
import { SOURCE_SHORT_LABELS } from "@/lib/source-labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingRowsSkeleton } from "@/components/dashboard/skeletons";

/**
 * What a new competitor starts monitoring — and the one control that fixes the
 * chore this replaces: enabling hiring, docs and roadmap by hand on every
 * competitor, one at a time.
 */
const SOURCE_HINTS: Partial<Record<SourceType, string>> = {
  homepage: "Positioning, messaging and the visual diff. Always on.",
  pricing: "Plans, prices and free-trial terms.",
  blog: "Editorial and announcements.",
  jobs: "Open roles from their ATS: the earliest read on where they're investing.",
  docs: "Their developer docs: a new endpoint ships before the changelog says so.",
  roadmap: "Their public Canny / ProductBoard portal: what they committed to build.",
  appstore_reviews:
    "Ratings, praises and complaints — only on competitors whose site links an App Store app.",
};

export function MonitoringDefaultsCard() {
  const qc = useQueryClient();
  const q = useQuery(sourceDefaultsQuery());
  const [saving, setSaving] = useState<SourceType | null>(null);
  const [applying, setApplying] = useState(false);

  if (q.isLoading) return <SettingRowsSkeleton rows={4} />;
  if (!q.data) return null;

  const { intendedSources, availableSources, selectableSources, gaps, competitorCount, plan } =
    q.data;
  // The INTENDED set, not the plan-narrowed one: a source above the plan is checked
  // (with its lock badge) and, more importantly, survives a save — narrowing the
  // payload to what the plan allows would erase it every time a neighbour is toggled.
  const selected = new Set(intendedSources);
  const missingTotal = gaps.reduce((n, g) => Math.max(n, g.missingOn), 0);

  async function toggle(source: SourceType, next: boolean) {
    const current = new Set(intendedSources);
    if (next) current.add(source);
    else current.delete(source);
    setSaving(source);
    try {
      await api.updateSourceDefaults([...current]);
      await qc.invalidateQueries({ queryKey: sourceDefaultsQuery().queryKey });
    } catch {
      toast.error("Couldn't save that. Try again.");
    } finally {
      setSaving(null);
    }
  }

  async function applyToExisting() {
    setApplying(true);
    try {
      const res = await api.applySourceDefaults();
      await qc.invalidateQueries({ queryKey: sourceDefaultsQuery().queryKey });
      toast.success(
        res.created === 0
          ? "Every competitor already has these sources."
          : `Added ${res.created} source${res.created === 1 ? "" : "s"} across ${res.competitorsTouched} competitor${res.competitorsTouched === 1 ? "" : "s"}. First scans are queued.`,
      );
    } catch {
      toast.error("Couldn't apply the defaults. Try again.");
    } finally {
      setApplying(false);
    }
  }

  // OUT-38 — the heading moved to the page's SettingsSection: this rendered its
  // own `h3` at a rank nothing else on General used, under a page that had no
  // `h1` at all. Every control here is unchanged.
  return (
    <div className="flex flex-col gap-4">
      {/* Checkbox, not Switch: these ARE a set — which sources a new competitor
          starts with — so the multi-select affordance is the right one. */}
      <ul className="flex flex-col">
        {selectableSources.map((source) => {
          const locked = !availableSources.includes(source);
          const required = source === REQUIRED_SEED_SOURCE;
          const checked = selected.has(source) || required;
          return (
            <li
              key={source}
              className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
            >
              <Checkbox
                id={`default-source-${source}`}
                checked={checked}
                disabled={locked || required || saving === source}
                onCheckedChange={(v) => toggle(source, v === true)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`default-source-${source}`}
                  className="flex flex-wrap items-center gap-2 text-dense font-medium"
                >
                  {SOURCE_SHORT_LABELS[source]}
                  {required && (
                    <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                      Required
                    </span>
                  )}
                  {locked && (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                      <LockIcon size={12} />
                      {PLAN_LABELS[minPlanForSource(source)]}
                    </span>
                  )}
                  {saving === source && (
                    <SpinnerIcon className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </label>
                {SOURCE_HINTS[source] && (
                  <p className="mt-1 max-w-[52ch] text-xs text-muted-foreground">
                    {SOURCE_HINTS[source]}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* The retroactive half. Existing competitors predate the setting, and an
          upgrade widens what the plan allows without touching anything already
          created — so the list above is only half the answer without this. */}
      {missingTotal > 0 && competitorCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-strong bg-surface px-4 py-3">
          <p className="text-sm">
            {missingTotal} of your {competitorCount} competitor
            {competitorCount === 1 ? "" : "s"} {missingTotal === 1 ? "is" : "are"} missing{" "}
            {gaps.map((g) => SOURCE_SHORT_LABELS[g.sourceType]).join(", ")}.
          </p>
          <Button type="button" size="sm" onClick={applyToExisting} disabled={applying}>
            {applying && <SpinnerIcon className="size-4 animate-spin" />}
            {applying ? "Applying…" : "Apply to existing competitors"}
          </Button>
        </div>
      )}

      {availableSources.length < selectableSources.length && (
        <p className="text-xs text-muted-foreground">
          Your {PLAN_LABELS[plan]} plan covers {availableSources.length} of{" "}
          {selectableSources.length} of these sources.
        </p>
      )}
    </div>
  );
}
