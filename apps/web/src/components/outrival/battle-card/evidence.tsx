"use client";

import Link from "next/link";
import { ShieldCheckIcon } from "@/components/icons";
import type { BattleCardEvidence, BattleCardEvidenceKind } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const EVIDENCE_LABELS: Record<BattleCardEvidenceKind, string> = {
  pricing: "Pricing",
  reviews: "Reviews",
  techStack: "Tech stack",
  homepage: "Homepage",
};

export function confidenceColor(confidence: BattleCardEvidence["confidence"]) {
  return confidence === "high"
    ? "text-positive"
    : confidence === "medium"
      ? "text-medium"
      : confidence === "low"
        ? "text-critical"
        : "text-muted-foreground";
}

function shortDate(iso: string) {
  return formatDate(iso, { day: "2-digit", month: "short" });
}

/**
 * The confidence pill, opening the per-source breakdown that makes the card
 * auditable rather than taken on faith. Kept as a click target (not a tooltip): the
 * breakdown is data to read, not a hint.
 */
export function ConfidenceBadge({
  evidence,
  competitorId,
}: {
  evidence: BattleCardEvidence;
  competitorId: string;
}) {
  const color = confidenceColor(evidence.confidence);
  const label = evidence.confidence
    ? `Confidence: ${evidence.confidence}`
    : "Confidence: not scored";
  const present = evidence.sources.filter((s) => s.present);
  const missingReviews = evidence.sources.some((s) => s.kind === "reviews" && !s.present);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <ShieldCheckIcon size={16} className={cn("shrink-0", color)} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-2.5 text-dense">
          <ShieldCheckIcon size={16} className={cn("shrink-0", color)} />
          <span className="font-medium">{label}</span>
          <span className="ml-auto font-mono text-meta tabular-nums text-muted-foreground">
            {present.length}/{evidence.sources.length} sources
          </span>
        </div>
        <ul className="flex flex-col px-3.5 py-2 text-dense">
          {evidence.sources.map((s) => (
            <li key={s.kind} className="flex items-center gap-2 py-1">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  s.present ? "bg-positive" : "bg-border-strong",
                )}
                aria-hidden
              />
              <span className={s.present ? "text-foreground" : "text-muted-foreground"}>
                {EVIDENCE_LABELS[s.kind]}
              </span>
              <span className="ml-auto font-mono text-meta text-muted-foreground">
                {s.present && s.lastVerifiedAt
                  ? `verified ${shortDate(s.lastVerifiedAt)}`
                  : "not tracked"}
              </span>
            </li>
          ))}
        </ul>
        {missingReviews && (
          <div className="border-t border-border px-3.5 py-2.5 text-dense text-muted-foreground">
            No review source is tracked, so nothing here rests on customer feedback.{" "}
            <Link
              href={`/dashboard/competitors/${competitorId}/sources`}
              className="text-link hover:underline"
            >
              Add one
            </Link>
            .
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The same readiness, on one line, for the states with no card yet. Says what we hold
 * before asking the user to spend one of their daily cards on it.
 */
export function EvidenceLine({
  evidence,
  competitorName,
  competitorId,
}: {
  evidence: BattleCardEvidence;
  competitorName: string;
  competitorId: string;
}) {
  const present = evidence.sources.filter((s) => s.present).length;
  const missingReviews = evidence.sources.some((s) => s.kind === "reviews" && !s.present);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-dense text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">
          {present} of {evidence.sources.length}
        </span>{" "}
        sources have data on {competitorName}
      </span>
      {evidence.sources.map((s) => (
        <span
          key={s.kind}
          className={cn(
            "inline-flex items-center gap-1.5",
            s.present ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              s.present ? "bg-positive" : "bg-border-strong",
            )}
            aria-hidden
          />
          {EVIDENCE_LABELS[s.kind]}
          <span className="font-mono text-meta text-muted-foreground">
            {s.present && s.lastVerifiedAt ? shortDate(s.lastVerifiedAt) : "not tracked"}
          </span>
        </span>
      ))}
      {missingReviews && (
        <Link
          href={`/dashboard/competitors/${competitorId}/sources`}
          className="text-link hover:underline"
        >
          Add a review source
        </Link>
      )}
    </div>
  );
}
