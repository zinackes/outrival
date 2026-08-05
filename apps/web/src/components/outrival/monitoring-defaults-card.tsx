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
import { Skeleton } from "@/components/ui/skeleton";

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

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
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

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium tracking-tight">Monitoring defaults</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          What every competitor you add starts watching. Status pages, changelogs and
          App Store reviews are added on their own whenever we detect one.
        </p>
      </div>

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
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  {SOURCE_SHORT_LABELS[source]}
                  {required && (
                    <span className="text-xs font-normal text-muted-foreground">Required</span>
                  )}
                  {locked && (
                    <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <LockIcon className="size-3.5" />
                      {PLAN_LABELS[minPlanForSource(source)]}
                    </span>
                  )}
                  {saving === source && (
                    <SpinnerIcon className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </label>
                {SOURCE_HINTS[source] && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{SOURCE_HINTS[source]}</p>
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
    </section>
  );
}
