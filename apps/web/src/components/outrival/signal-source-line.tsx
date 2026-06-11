"use client";

import { useState } from "react";
import { format } from "date-fns";
import { sourceLabel } from "@/lib/source-labels";
import { WhyInsightPanel } from "./why-insight-panel";

interface SignalSourceLineProps {
  signalId: string;
  sourceType: string | null | undefined;
  detectedAt: string;
  // Feed cards already show the timestamp in the header (patch-29); hide the
  // duplicate date here. The competitor page keeps it (no header time there).
  showDetected?: boolean;
}

// Progressive disclosure level 1 (patch-14): a sober, always-visible footer line
// under a signal card. Reassures at a glance (where it came from, when), and
// opens the level-2 "Why this insight?" panel on click. Never intrusive.
export function SignalSourceLine({
  signalId,
  sourceType,
  detectedAt,
  showDetected = true,
}: SignalSourceLineProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        <span>Source: {sourceLabel(sourceType)}</span>
        {showDetected && (
          <>
            <span aria-hidden>·</span>
            <span>Detected {format(new Date(detectedAt), "MMM d")}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          Why this insight?
        </button>
      </div>
      <WhyInsightPanel signalId={signalId} open={open} onOpenChange={setOpen} />
    </>
  );
}
