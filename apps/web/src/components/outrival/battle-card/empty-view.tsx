"use client";

import { SparkleIcon } from "@/components/icons";
import type { BattleCardEvidence } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { TabCard } from "@/components/outrival/tab-shell";
import { cn } from "@/lib/utils";
import { EvidenceLine } from "./evidence";
import { SECTION_META } from "./sections";

// A hint of the lines each section will hold. Fixed per section so the wireframe is
// stable across renders (a random width would shimmer on every paint) and roughly
// matches how full each section usually comes back.
const WIREFRAME: Record<string, number[]> = {
  their_strengths: [92, 74, 84],
  our_strengths: [86, 70, 80],
  their_weaknesses: [78, 64],
  common_objections: [56, 88],
  when_we_win: [90, 72],
  when_we_lose: [84, 66],
};

/**
 * The empty state, laid out across the width rather than down the page. Three bands:
 * what this is and the action, the card's own geography in wireframe, and the evidence
 * it will be written from. The middle band uses the same three-column grid as the real
 * card, so the reader learns where things sit before they exist.
 */
export function BattleCardEmpty({
  competitorId,
  competitorName,
  evidence,
  onGenerate,
}: {
  competitorId: string;
  competitorName: string;
  evidence: BattleCardEvidence | null;
  onGenerate: () => void;
}) {
  return (
    <TabCard>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 p-5">
        <div className="flex min-w-0 flex-1 basis-[26rem] gap-3.5">
          <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted-foreground"
            aria-hidden
          >
            <SparkleIcon size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              No battle card for {competitorName} yet
            </h2>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
              One page for the calls where {competitorName} comes up: what they are strong
              at, where you are stronger, where they are weak, and the line to say for each
              objection. Written from what we have verified, and editable afterwards.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
          <Button size="sm" onClick={onGenerate}>
            <SparkleIcon size={16} /> Generate battle card
          </Button>
          <span className="text-meta text-muted-foreground">about 30 seconds</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {SECTION_META.map(({ key, title, icon: Icon, color, from }) => (
          <div key={key} className="flex flex-col gap-2.5">
            <h3
              className={cn(
                "flex items-center gap-2 text-sm font-semibold tracking-tight leading-tight",
                color,
              )}
            >
              <Icon size={16} className={cn("shrink-0", !color && "text-muted-foreground")} />
              {title}
            </h3>
            <div className="flex flex-col gap-1.5" aria-hidden>
              {(WIREFRAME[key] ?? [88, 70]).map((w, i) => (
                <span
                  key={i}
                  className="block h-1.5 rounded-sm bg-border"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
            <p className="text-meta text-muted-foreground">from {from}</p>
          </div>
        ))}
      </div>

      {evidence && (
        <div className="px-5 py-3.5">
          <EvidenceLine
            evidence={evidence}
            competitorName={competitorName}
            competitorId={competitorId}
          />
        </div>
      )}
    </TabCard>
  );
}
