"use client";

import { Loader2, Clock, Sparkles, AlertTriangle } from "lucide-react";
import type { AnalysisStage, AnalysisStatus } from "@outrival/shared";
import { cn } from "@/lib/utils";

// Visible "where is the first AI analysis at?" affordance. Backs the gap between
// adding a competitor (or self-product) and its AI summary landing: instead of a
// static "not generated yet", the user sees the live pipeline stage. Stage is
// derived server-/client-side by deriveAnalysisStatus (@outrival/shared); this
// module is purely how each stage reads on screen.

type StageMeta = {
  // Full sentence for a detail surface (AnalysisNotice).
  label: string;
  // Terse variant for dense rows (AnalysisBadge).
  short: string;
  Icon: typeof Loader2;
  spin: boolean;
  tone: string; // text colour token
};

// `ready` / `idle` have no affordance — the caller renders the real content. Only
// the in-flight + stuck stages get an entry.
const STAGE_META: Partial<Record<AnalysisStage, StageMeta>> = {
  queued: {
    label: "Queued — first scan starts soon",
    short: "Queued",
    Icon: Clock,
    spin: false,
    tone: "text-muted-foreground",
  },
  scraping: {
    label: "Scraping the site…",
    short: "Scraping…",
    Icon: Loader2,
    spin: true,
    tone: "text-muted-foreground",
  },
  summarizing: {
    label: "Summarizing with AI…",
    short: "Analyzing…",
    Icon: Sparkles,
    spin: false,
    tone: "text-muted-foreground",
  },
  needs_attention: {
    label: "Insights need attention",
    short: "Needs attention",
    Icon: AlertTriangle,
    spin: false,
    tone: "text-medium",
  },
};

export function analysisStageMeta(stage: AnalysisStage): StageMeta | null {
  return STAGE_META[stage] ?? null;
}

/**
 * Compact inline pill for dense rows (competitor list). Renders nothing for
 * ready/idle so settled competitors stay clean.
 */
export function AnalysisBadge({
  analysis,
  className,
}: {
  analysis: AnalysisStatus | null | undefined;
  className?: string;
}) {
  const meta = analysis ? analysisStageMeta(analysis.stage) : null;
  if (!meta) return null;
  const { label, short, Icon, spin, tone } = meta;
  return (
    <span
      className={cn(
        "flex w-fit items-center gap-1 text-meta font-medium whitespace-nowrap",
        tone,
        className,
      )}
      title={label}
    >
      <Icon size={11} className={cn("shrink-0", spin && "animate-spin")} />
      {short}
    </span>
  );
}

/**
 * Inline notice line for a detail surface (competitor summary card, My Product
 * profile). Renders nothing for ready/idle.
 */
export function AnalysisNotice({
  analysis,
  className,
}: {
  analysis: AnalysisStatus | null | undefined;
  className?: string;
}) {
  const meta = analysis ? analysisStageMeta(analysis.stage) : null;
  if (!meta) return null;
  const { label, Icon, spin, tone } = meta;
  return (
    <div className={cn("flex items-center gap-2 text-sm", tone, className)}>
      <Icon size={14} className={cn("shrink-0", spin && "animate-spin")} />
      <span>{label}</span>
    </div>
  );
}
