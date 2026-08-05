"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { SpinnerIcon, SparkleIcon, XIcon } from "@/components/icons";
import { toast } from "@/lib/toast";
import { PLAN_LABELS } from "@outrival/shared";
import { api } from "@/lib/api";
import { sourceDefaultsQuery } from "@/lib/queries";
import { SOURCE_SHORT_LABELS } from "@/lib/source-labels";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "outrival.source-gaps-dismissed";

/**
 * Dashboard banner for sources the workspace is entitled to but isn't collecting —
 * the plan just unlocked them, or the competitors predate the monitoring defaults.
 *
 * Buying a plan used to be silent: the new sources appeared in a per-competitor menu
 * and nowhere else, so an upgrade bought capability the user had to go and claim by
 * hand, competitor by competitor. One click here claims all of it.
 *
 * Dismissal is keyed on plan + the exact gap set, so closing it hides THIS gap while
 * a later upgrade (a different plan, or new sources missing) surfaces a new one.
 */
export function NewSourcesBanner() {
  const qc = useQueryClient();
  const q = useQuery(sourceDefaultsQuery());
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setDismissedKey(localStorage.getItem(DISMISS_KEY));
  }, []);

  const data = q.data;
  const gaps = data?.gaps ?? [];
  const key = data ? `${data.plan}:${gaps.map((g) => g.sourceType).sort().join(",")}` : null;

  const dismiss = useCallback(() => {
    if (!key) return;
    localStorage.setItem(DISMISS_KEY, key);
    setDismissedKey(key);
  }, [key]);

  async function applyToExisting() {
    setApplying(true);
    try {
      const res = await api.applySourceDefaults();
      await qc.invalidateQueries({ queryKey: sourceDefaultsQuery().queryKey });
      toast.success(
        `Now collecting ${res.sources.map((s) => SOURCE_SHORT_LABELS[s]).join(", ")} on ${res.competitorsTouched} competitor${res.competitorsTouched === 1 ? "" : "s"}. First scans are queued.`,
      );
    } catch {
      toast.error("Couldn't enable them. Try again from Settings → General.");
    } finally {
      setApplying(false);
    }
  }

  if (!data || gaps.length === 0 || data.competitorCount === 0) return null;
  if (key && dismissedKey === key) return null;

  const names = gaps.map((g) => SOURCE_SHORT_LABELS[g.sourceType]);
  const affected = gaps.reduce((n, g) => Math.max(n, g.missingOn), 0);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/25 bg-primary/8 px-4 py-3">
      <SparkleIcon className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-sm text-foreground">
        Your {PLAN_LABELS[data.plan]} plan covers{" "}
        {names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}
        , and {affected} of your competitors {affected === 1 ? "isn't" : "aren't"} watching{" "}
        {names.length === 1 ? "it" : "them"} yet.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" onClick={applyToExisting} disabled={applying}>
          {applying && <SpinnerIcon className="size-4 animate-spin" />}
          {applying ? "Enabling…" : "Enable on all competitors"}
        </Button>
        <Button asChild type="button" size="sm" variant="ghost">
          <Link href="/dashboard/settings/general">Choose</Link>
        </Button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md p-1 text-muted-foreground hover:bg-primary/15 hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
