"use client";

import { formatDistanceToNow } from "date-fns";
import { ArrowRight } from "lucide-react";
import type { CompetitorSignal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SeverityScale } from "@/components/outrival/severity-scale";
import type { TabKey } from "./types";

type Severity = "low" | "medium" | "high" | "critical";
const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * What landed since you last opened this competitor.
 *
 * The page used to open on a description of what the competitor IS: a static AI
 * paragraph and a source strip, with the signal feed one tab away and below the
 * fold. For a monitoring product that inverts the value: the first thing on
 * screen should be what they DID. This band is the hook, and it is the only
 * place on the default view where the severity scale appears at all.
 *
 * Purely client state (`useLastVisit`, localStorage), so it costs no query and
 * no migration. On a first ever visit there is no "since", and the band renders
 * the most material recent signal instead of nothing.
 */
export function WhatChanged({
  signals,
  lastVisit,
  onOpenActivity,
}: {
  signals: CompetitorSignal[];
  /** Epoch ms of the previous visit, or null on a first ever visit. */
  lastVisit: number | null;
  onOpenActivity: (tab: TabKey) => void;
}) {
  if (signals.length === 0) return null;

  const fresh =
    lastVisit === null
      ? []
      : signals.filter((s) => new Date(s.createdAt).getTime() > lastVisit);

  // With nothing new, fall back to the most material signal of the batch so the
  // band still answers "what is going on with them", rather than disappearing
  // and leaving the page opening on a static fact sheet again.
  const pool = fresh.length > 0 ? fresh : signals;
  const lead = [...pool].sort(
    (a, b) =>
      RANK[b.severity] - RANK[a.severity] ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  if (!lead) return null;

  const worst = pool.reduce<Severity>(
    (acc, s) => (RANK[s.severity] > RANK[acc] ? s.severity : acc),
    "low",
  );
  const isNew = fresh.length > 0;

  return (
    <button
      type="button"
      onClick={() => onOpenActivity("activity")}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-lg border px-4 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isNew
          ? "border-border-strong bg-surface hover:bg-surface-2"
          : "border-border bg-surface hover:bg-surface-2",
      )}
    >
      <SeverityScale severity={worst} />
      <span className="shrink-0 text-sm font-medium">
        {isNew
          ? `${fresh.length} new since your last visit`
          : `Last movement ${formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}`}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {lead.insight}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-link">
        Review all
        <ArrowRight size={13} aria-hidden />
      </span>
    </button>
  );
}
