"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { api, type SignalDetail } from "@/lib/api";
import { sourceLabel } from "@/lib/source-labels";
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
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
