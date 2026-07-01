"use client";

import {
  Loader2,
  Clock,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Circle,
} from "lucide-react";
import type { AnalysisStage, AnalysisStatus } from "@outrival/shared";
import { Button } from "@/components/ui/button";
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

// The first analysis collapses into three coarse phases the user can follow: pull
// the site down, summarize it, done. Both in-flight stages (queued/scraping) map
// to "scan" so the stepper reads as one moving pipeline rather than four states.
type Phase = "scan" | "summary" | "ready";
const PHASES: { key: Phase; label: string }[] = [
  { key: "scan", label: "Scan site" },
  { key: "summary", label: "AI summary" },
  { key: "ready", label: "Ready" },
];
const PHASE_ORDER: Phase[] = ["scan", "summary", "ready"];

// One line under the headline describing what's happening right now.
const PROGRESS_SUB: Partial<Record<AnalysisStage, string>> = {
  queued: "Queued — the first scan starts in a moment.",
  scraping: "Scanning the site for positioning, pricing, hiring and more.",
  summarizing: "Site scanned. Writing the AI summary now.",
};

function phaseState(stage: AnalysisStage, phase: Phase): "done" | "active" | "pending" {
  const active: Phase = stage === "summarizing" ? "summary" : "scan";
  const ai = PHASE_ORDER.indexOf(active);
  const pi = PHASE_ORDER.indexOf(phase);
  if (pi < ai) return "done";
  if (pi === ai) return "active";
  return "pending";
}

/**
 * Prominent top-of-page banner for a freshly added competitor (or self-product):
 * a stepper that shows exactly where the first analysis is — scanning the site,
 * summarizing, or ready — so the user isn't left staring at empty tabs wondering
 * if anything started. Renders nothing once settled (ready/idle). The
 * `needs_attention` stage turns it into an actionable warning instead.
 */
export function AnalysisProgress({
  analysis,
  onRetry,
  className,
}: {
  analysis: AnalysisStatus | null | undefined;
  onRetry?: () => void;
  className?: string;
}) {
  if (!analysis) return null;
  const { stage } = analysis;

  if (stage === "needs_attention") {
    return (
      <div className={cn("rounded-lg border border-medium/40 bg-medium/5 p-4", className)}>
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-medium" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              This competitor needs attention
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              We couldn&apos;t finish the first analysis — the site may be blocking scans
              or the summary stalled. Retry, or check the sources below.
            </p>
            {onRetry && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 h-7 text-xs"
                onClick={onRetry}
              >
                <Loader2 size={11} /> Retry analysis
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!analysis.pending) return null; // ready / idle → the real content is shown

  return (
    <div className={cn("rounded-lg border border-border bg-muted/30 p-4", className)}>
      <div className="flex items-start gap-2.5">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-link" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Setting up this competitor</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {PROGRESS_SUB[stage] ?? "Analyzing…"} This page updates on its own — no need
            to refresh.
          </p>
          <ol className="mt-3 flex flex-wrap items-center gap-y-2">
            {PHASES.map((p, i) => {
              const st = phaseState(stage, p.key);
              const Icon = st === "done" ? CheckCircle2 : st === "active" ? Loader2 : Circle;
              return (
                <li key={p.key} className="flex items-center">
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-dense font-medium",
                      st === "pending" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    <Icon
                      size={13}
                      className={cn(
                        "shrink-0",
                        st === "active" && "animate-spin text-link",
                        st === "done" && "text-link",
                        st === "pending" && "text-muted-foreground/50",
                      )}
                    />
                    {p.label}
                  </span>
                  {i < PHASES.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        "mx-2 h-px w-6 sm:w-10",
                        st === "done" ? "bg-link/50" : "bg-border",
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
