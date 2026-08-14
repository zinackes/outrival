"use client";

import { format } from "date-fns";
// The measured interval between the two captures, never a theoretical delay — and
// phrased in @outrival/shared so the dialog, the weekly digest and the Slack alert
// cannot round one gap three ways.
import { verificationGapLabel as formatGap } from "@outrival/shared";
import { ArrowsDownUpIcon, ChecksIcon, CircleIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sourceLabel } from "@/lib/source-labels";
import type { SignalDetail } from "@/lib/api";

// Véracité Intelligence v2 P4 — the proof the pipeline already collected, made
// visible. Every piece here is READ from the detail payload: no fetch, no AI, no
// derivation beyond formatting. Each part renders null when its field is absent,
// which is what lets a pre-P1/P2/P3 signal read exactly as it did before.
//
// One grammar, two densities: the dialog spells the check out ("2 captures 47 min
// apart"), the feed's evidence panel keeps the same badge minus the count. Nothing
// here reserves space, draws a placeholder, or names a check that didn't run — an
// unverified signal is not a suspect one, it is one we couldn't get to twice.

/** How a capture was taken, said the way a person would say it. */
const CAPTURE_METHOD = {
  static: { via: "fetch", full: "direct fetch" },
  rendered: { via: "browser", full: "rendered browser" },
  feed: { via: "feed", full: "the site's own feed" },
  api: { via: "API", full: "the page's own API" },
} as const;

function methodOf(method: string | null | undefined) {
  if (!method) return null;
  return CAPTURE_METHOD[method as keyof typeof CAPTURE_METHOD] ?? null;
}

function at(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "MMM d, HH:mm");
}

function onDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "MMM d");
}

/** host + path, the way the provenance line prints a URL. */
function hostPath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
    return u.hostname.replace(/^www\./, "") + path;
  } catch {
    return null;
  }
}

const Dot = () => (
  <span aria-hidden className="px-1.5">
    ·
  </span>
);

// Exported so the "as of" chip on the dated tabs speaks the same panel grammar as
// the proof badges instead of a second one that drifts from it.
export function PanelHead({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 font-semibold text-popover-foreground">{children}</p>;
}

export function PanelRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="whitespace-nowrap tabular-nums text-popover-foreground">{value}</span>
    </div>
  );
}

export const PANEL = "max-w-[320px] space-y-1 text-left text-meta";

/**
 * "We saw it twice." The badge carries the measured gap, the panel carries the two
 * timestamps and how the page was read. Only ever rendered on `confirmed`:
 * `pending`, `not_reproduced` and `skipped` are states of OUR pipeline, and none of
 * them is a claim about the competitor worth putting on screen.
 */
function VerifiedBadge({
  verification,
  provenance,
  dense,
}: {
  verification: NonNullable<SignalDetail["verification"]>;
  provenance: SignalDetail["provenance"];
  dense: boolean;
}) {
  const gap = formatGap(verification.gapMinutes);
  const method = methodOf(provenance?.captureMethod);
  const region = provenance?.observedRegion ?? null;
  const label = gap
    ? dense
      ? `Verified · ${gap} apart`
      : `Verified · 2 captures ${gap} apart`
    : "Verified";

  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default">
        <Badge
          variant="outline"
          className="rounded-sm border-positive/40 bg-positive/10 text-meta font-semibold text-positive"
        >
          <ChecksIcon size={14} aria-hidden />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className={PANEL}>
        <PanelHead>How we checked</PanelHead>
        {at(verification.quickCheckAt) && (
          <PanelRow label="Quick check" value={at(verification.quickCheckAt)} />
        )}
        {at(verification.independentCheckAt) && (
          <PanelRow
            label="Independent capture"
            value={at(verification.independentCheckAt)}
          />
        )}
        {method && (
          <PanelRow
            label="Method"
            value={dense && region ? `${method.full} · ${region}` : method.full}
          />
        )}
        {!dense && region && <PanelRow label="Egress" value={region} />}
        <p className="pt-1.5 text-muted-foreground">
          The same wording came back on a second, independent capture.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * What the prose left out. P3 WITHHELD the sentence carrying an unsupported figure
 * at write time, so this is the record of a removal, not a warning about what is on
 * screen. Grey and lower-case on purpose: nothing here is the reader's fault.
 */
function OmissionNote({
  items,
}: {
  items: NonNullable<SignalDetail["grounding"]>["unverified"];
}) {
  const shown = items.slice(0, 5);
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex cursor-help items-center gap-1.5 text-meta text-muted-foreground">
        <CircleIcon size={14} aria-hidden className="text-medium" />
        <span className="border-b border-dotted border-stroke">
          Partial analysis · unverifiable figures left out
        </span>
      </TooltipTrigger>
      <TooltipContent className={PANEL}>
        <PanelHead>Left out of the analysis</PanelHead>
        {shown.map((item, i) => (
          <PanelRow
            key={`${item.text}-${i}`}
            label={<span className="font-mono">&quot;{item.text}&quot;</span>}
            value={item.field ?? item.kind}
          />
        ))}
        {items.length > shown.length && (
          <p className="text-muted-foreground">
            and {items.length - shown.length} more
          </p>
        )}
        <p className="pt-1.5 text-muted-foreground">
          These figures were not found in the captured page, so we removed the
          sentences that carried them rather than rewrite them.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The page served two readings inside one run and neither is wrong. Amber, not red:
 * the finding is that there is nothing to decide yet, which is itself worth saying.
 */
function AbTestBadge({
  abTest,
  sourceType,
}: {
  abTest: NonNullable<SignalDetail["abTest"]>;
  sourceType: string | null;
}) {
  const first = abTest.firstCaptureAt ? new Date(abTest.firstCaptureAt) : null;
  const second = abTest.secondCaptureAt ? new Date(abTest.secondCaptureAt) : null;
  const gap =
    first && second && !Number.isNaN(first.getTime()) && !Number.isNaN(second.getTime())
      ? formatGap(Math.abs(second.getTime() - first.getTime()) / 60_000)
      : null;

  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default">
        <Badge
          variant="outline"
          className="rounded-sm border-medium/40 bg-medium/10 text-meta font-semibold text-medium"
        >
          <ArrowsDownUpIcon size={14} aria-hidden className="rotate-90" />
          A/B test suspected ·{" "}
          {sourceType === "pricing" ? "not a price change" : "not a change"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className={PANEL}>
        <PanelHead>Why we are not calling this a change</PanelHead>
        {at(abTest.firstCaptureAt) && (
          <PanelRow label="First capture" value={at(abTest.firstCaptureAt)} />
        )}
        {at(abTest.secondCaptureAt) && (
          <PanelRow label="Second capture" value={at(abTest.secondCaptureAt)} />
        )}
        <p className="pt-1.5 text-muted-foreground">
          The second capture served the earlier wording back.{" "}
          {gap
            ? `Two variants in ${gap} reads as a test, not as a decision.`
            : "Two variants inside the same run read as a test, not as a decision."}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * How the quoted capture was taken, in one line. Gated on `captureMethod`: without
 * it we don't know how the page was read, and a line that only prints a date and a
 * URL would be a P4 addition on a signal P1 never touched.
 */
function ProvenanceLine({ detail }: { detail: SignalDetail }) {
  const method = methodOf(detail.provenance?.captureMethod);
  if (!method) return null;

  const capturedAt = at(detail.screenshots?.afterCapturedAt ?? detail.detectedAt);
  const source = hostPath(detail.sourceUrl);
  // Only when the page really redirected. Reserved from P1: final_url carries the
  // same value as resolved_url today, so the arrow stays hidden until they differ.
  const final = hostPath(detail.provenance?.finalUrl);
  const redirected = Boolean(source && final && final !== source);

  return (
    <span className="inline-flex flex-wrap items-center text-meta text-muted-foreground">
      Captured via {method.via}
      {detail.provenance?.observedRegion && (
        <>
          <Dot />
          {detail.provenance.observedRegion}
        </>
      )}
      {capturedAt && (
        <>
          <Dot />
          <span className="tabular-nums">{capturedAt}</span>
        </>
      )}
      {source && (
        <>
          <Dot />
          <span className="font-mono">{source}</span>
        </>
      )}
      {redirected && (
        <>
          <span aria-hidden className="px-1.5">
            →
          </span>
          <span className="font-mono">{final}</span>
        </>
      )}
    </span>
  );
}

/**
 * The proof strip: what we checked, what we left out, and how the page was read.
 * Renders null when the signal carries none of it — the whole point of P4 is that
 * silence means "nothing was checked", never "the check failed".
 */
export function SignalProof({
  detail,
  dense = false,
  className,
}: {
  detail: SignalDetail;
  /** The feed's evidence panel: same grammar, one line, no capture count. */
  dense?: boolean;
  className?: string;
}) {
  const verification =
    detail.verification?.outcome === "confirmed" ? detail.verification : null;
  const omissions =
    detail.grounding?.status === "unverified" ? detail.grounding.unverified : [];
  const abTest = detail.abTest?.variantA && detail.abTest.variantB ? detail.abTest : null;
  const hasProvenance = Boolean(methodOf(detail.provenance?.captureMethod));

  if (!verification && omissions.length === 0 && !abTest && !hasProvenance) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1.5", className)}>
      {verification && (
        <VerifiedBadge
          verification={verification}
          provenance={detail.provenance}
          dense={dense}
        />
      )}
      {abTest && <AbTestBadge abTest={abTest} sourceType={detail.sourceType} />}
      {omissions.length > 0 && <OmissionNote items={omissions} />}
      <ProvenanceLine detail={detail} />
    </div>
  );
}

/**
 * The two readings the page served, side by side. The pair IS the subject of a
 * variance anchor, so it sits with the strip rather than in the evidence column.
 */
export function AbVariants({ detail }: { detail: SignalDetail }) {
  const abTest = detail.abTest;
  if (!abTest?.variantA || !abTest.variantB) return null;

  const variants = [
    { label: "Variant A", body: abTest.variantA, at: at(abTest.firstCaptureAt) },
    { label: "Variant B", body: abTest.variantB, at: at(abTest.secondCaptureAt) },
  ];

  return (
    <div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {variants.map((v) => (
          <div key={v.label} className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <div className="flex justify-between gap-2 text-meta text-muted-foreground">
              <span>{v.label}</span>
              {v.at && <span className="tabular-nums">{v.at}</span>}
            </div>
            <p className="mt-1.5 font-mono text-xs text-foreground">{v.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-meta text-muted-foreground">
        We keep watching this page. If one variant sticks, it becomes a signal.
      </p>
    </div>
  );
}

/**
 * The surfaces the corroboration sub-score actually counted, named and dated.
 * A score of 2/3 with nothing behind it asks the reader to trust an integer; this
 * says which pages moved. Persisted at classification time, so it is what the
 * classifier really saw, not a window replayed against today.
 */
export function CorroborationSources({
  sources,
}: {
  sources: NonNullable<SignalDetail["corroboration"]>;
}) {
  if (sources.length === 0) return null;
  return (
    <span className="mt-1 block text-meta text-muted-foreground">
      {sources.map((s, i) => (
        <span key={`${s.signalId}-${i}`}>
          {i > 0 && <Dot />}
          {sourceLabel(s.sourceType)}
          {onDay(s.at) ? `, ${onDay(s.at)}` : ""}
        </span>
      ))}
    </span>
  );
}

/**
 * The insight, with the figures the capture really prints underlined in place.
 *
 * The offsets come from replaying the deterministic grounder against the same
 * evidence shown below, so an underline can only ever point at a line the reader can
 * check. Any citation whose offsets no longer match the prose is dropped rather than
 * shifted — a misplaced underline is a false claim, an absent one is just silence.
 */
export function CitedInsight({
  text,
  citations,
  className,
}: {
  text: string;
  citations: NonNullable<SignalDetail["citations"]>;
  className?: string;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const c of [...citations].sort((a, b) => a.start - b.start)) {
    if (c.start < cursor || c.end > text.length || c.end <= c.start) continue;
    if (text.slice(c.start, c.end) !== c.text) continue;
    if (c.start > cursor) parts.push(text.slice(cursor, c.start));
    parts.push(
      <Tooltip key={`${c.start}-${c.end}`}>
        <TooltipTrigger className="cursor-help border-b border-dotted border-stroke hover:border-link hover:text-link">
          {c.text}
        </TooltipTrigger>
        <TooltipContent className={PANEL}>
          <PanelHead>Verbatim from the anchored capture</PanelHead>
          <span className="my-1 block rounded-sm bg-surface-2 px-2 py-1.5 font-mono text-meta text-popover-foreground">
            {c.sourceLine}
          </span>
          {c.side && <PanelRow label="Position" value={c.side} />}
        </TooltipContent>
      </Tooltip>,
    );
    cursor = c.end;
  }

  if (parts.length === 0) return <span className={className}>{text}</span>;
  parts.push(text.slice(cursor));
  return <span className={className}>{parts}</span>;
}
