"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { api, type SignalDetail } from "@/lib/api";
import { sourceLabel } from "@/lib/source-labels";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface WhyInsightPanelProps {
  signalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/80">
    {children}
  </div>
);

// Readable label per structured change kind (patch-16). Falls back to the raw
// kind if a new kind ships before this map is updated.
const KIND_LABELS: Record<string, string> = {
  hero_headline_changed: "Hero headline",
  hero_subheadline_changed: "Hero subheadline",
  hero_cta_changed: "Hero CTA",
  section_added: "New section",
  section_removed: "Removed section",
  section_renamed: "Renamed section",
  section_body_changed: "Section content",
  section_reordered: "Reordered sections",
  navigation_changed: "Navigation",
  meta_changed: "Page metadata",
  social_proof_changed: "Social proof",
  // patch-17 enrichments
  visual_redesign: "Visual redesign",
  numeric_claim_changed: "Business claim",
  customer_logo_added: "New customer logo",
  customer_logo_removed: "Removed customer logo",
  testimonial_added: "New testimonial",
  testimonial_removed: "Removed testimonial",
};

// patch-17: a signed percentage badge for a numeric-claim change ("+233%").
function variationLabel(metadata: Record<string, unknown> | null): string | null {
  const v = metadata?.variation;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const pct = Math.round(v * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

// Progressive disclosure level 2 (patch-14): the user gets, in five seconds,
// WHAT changed, WHERE it was seen, and WHEN. No raw HTML, no diff, no AI
// classification — that lives in admin tooling. Falls back gracefully when the
// before/after couldn't be extracted (pre-patch signals or a failed extraction).
export function WhyInsightPanel({ signalId, open, onOpenChange }: WhyInsightPanelProps) {
  const [detail, setDetail] = useState<SignalDetail | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState("loading");
    api
      .getSignalDetail(signalId)
      .then((res) => {
        if (cancelled) return;
        setDetail(res.signal);
        setState("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, signalId]);

  const hasChange = Boolean(detail?.humanChangeBefore || detail?.humanChangeAfter);
  const host = hostOf(detail?.sourceUrl ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base text-primary">Why this insight?</DialogTitle>
          <DialogDescription className="sr-only">
            Where this signal came from and what changed.
          </DialogDescription>
        </DialogHeader>

        {state === "loading" && (
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        )}

        {state === "error" && (
          <p className="text-[13px] text-muted-foreground">
            We couldn&apos;t load the details right now. Close this and try again
            in a moment.
          </p>
        )}

        {state === "idle" && detail && (
          <div className="space-y-5">
            {/* Strategic narrative (patch-16) — shown first when present. */}
            {detail.narrative && (
              <p className="border-l-2 border-primary/40 pl-3 text-[13px] italic leading-relaxed text-primary/90">
                {detail.narrative}
              </p>
            )}

            <section className="space-y-2.5">
              <SectionLabel>Detected change</SectionLabel>
              {hasChange ? (
                <div className="grid grid-cols-[64px_1fr] gap-x-4 gap-y-2 items-baseline">
                  <span className="text-[11px] text-muted-foreground/70 uppercase tracking-wide">
                    Before
                  </span>
                  <span className="font-mono text-[13px] text-white/85">
                    {detail.humanChangeBefore ?? "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground/70 uppercase tracking-wide">
                    After
                  </span>
                  <span className="font-mono text-[13px] text-white">
                    {detail.humanChangeAfter ?? "—"}
                  </span>
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  Detail unavailable for this signal — open the live page to see
                  the current state.
                </p>
              )}
            </section>

            {/* Per-change breakdown (patch-16): the typed structured changes with
                their significance. Empty for lexical / pre-patch signals. */}
            {detail.changes.length > 0 && (
              <>
                <Separator />
                <section className="space-y-3">
                  <SectionLabel>Changes detected</SectionLabel>
                  <ul className="space-y-3">
                    {detail.changes.map((ch, i) => (
                      <li key={i} className="grid grid-cols-[56px_1fr] gap-x-3 items-baseline">
                        <span
                          className={cn(
                            "font-mono text-[10px] uppercase tracking-wide",
                            ch.significance === "major" ? "text-primary" : "text-muted-foreground/70",
                          )}
                        >
                          {ch.significance ?? "—"}
                        </span>
                        <div className="space-y-0.5">
                          <div className="text-[13px] text-white/85">
                            {KIND_LABELS[ch.kind] ?? ch.kind}
                            {ch.kind === "numeric_claim_changed" &&
                              variationLabel(ch.metadata) && (
                                <span className="ml-2 font-mono text-[11px] text-primary">
                                  {variationLabel(ch.metadata)}
                                </span>
                              )}
                          </div>
                          {(ch.before || ch.after) && (
                            <div className="font-mono text-[12px] text-muted-foreground/80">
                              {ch.before ?? "∅"}{" "}
                              <span className="text-muted-foreground/50">→</span>{" "}
                              <span className="text-white/80">{ch.after ?? "∅"}</span>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}

            <Separator />

            <section className="space-y-1.5">
              <SectionLabel>Source</SectionLabel>
              <p className="text-[13px] text-white/85">
                {sourceLabel(detail.sourceType)} of {detail.competitor.name}
                {host && (
                  <span className="text-muted-foreground/70"> · {host}</span>
                )}
              </p>
              {detail.sourceUrl && (
                <a
                  href={detail.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
                >
                  View live page <ExternalLink size={12} />
                </a>
              )}
            </section>

            <Separator />

            <section className="space-y-1.5">
              <SectionLabel>Detection</SectionLabel>
              <p className="text-[13px] text-white/85 font-mono">
                Detected on {format(new Date(detail.detectedAt), "MMM d, yyyy 'at' HH:mm")}
              </p>
              {/* Relevance score (patch-17) — discreet; mostly for beta calibration. */}
              {typeof detail.relevanceScore === "number" && (
                <p className="text-[11px] text-muted-foreground/60 font-mono">
                  Relevance score: {detail.relevanceScore.toFixed(2)}
                </p>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
