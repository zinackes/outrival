"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, X } from "lucide-react";
import { api, type SectoralSignal, type SectoralCategory } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CATEGORY_META: Record<SectoralCategory, { icon: string; label: string }> = {
  feature_trend: { icon: "✨", label: "Features" },
  hiring_trend: { icon: "📈", label: "Hiring" },
  pricing_trend: { icon: "💰", label: "Pricing" },
  positioning_shift: { icon: "🎯", label: "Positioning" },
  category_emergence: { icon: "🌱", label: "Emerging" },
};

function confidencePct(raw: string): number {
  return Math.round((Number(raw) || 0) * 100);
}

function renderDataPoint(dp: unknown): string {
  if (dp && typeof dp === "object") {
    return Object.entries(dp as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .join(" · ");
  }
  return String(dp);
}

function EvidenceModal({
  signal,
  onClose,
}: {
  signal: SectoralSignal | null;
  onClose: () => void;
}) {
  const open = signal !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {signal && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[15px]">
                <span>{CATEGORY_META[signal.category].icon}</span>
                {signal.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-[13px]">
              <p className="text-muted-foreground leading-snug">{signal.insight}</p>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                  Competitors ({signal.evidence.competitors.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {signal.evidence.competitors.map((c) => (
                    <span
                      key={c.id}
                      className="rounded border border-border bg-background px-2 py-0.5 text-xs"
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>

              {signal.evidence.dataPoints.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                    Data points
                  </div>
                  <ul className="space-y-1">
                    {signal.evidence.dataPoints.map((dp, i) => (
                      <li
                        key={i}
                        className="font-mono text-[11px] text-muted-foreground/90 leading-snug"
                      >
                        {renderDataPoint(dp)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-3 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
                <span>Confidence {confidencePct(signal.confidence)}%</span>
                <span className="text-muted-foreground/40">·</span>
                <span>{signal.evidence.metric}</span>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectoralCard({
  signal,
  onOpen,
  onDismiss,
}: {
  signal: SectoralSignal;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const meta = CATEGORY_META[signal.category];
  const unread = signal.readAt === null;
  return (
    <div className="px-4 py-3.5 border-b border-border last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="text-base leading-none mt-0.5" aria-hidden>
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {meta.label}
            </span>
            {unread && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-primary"
                aria-label="Unread"
              />
            )}
          </div>
          <div className="text-[13px] font-semibold tracking-tight mt-0.5 leading-snug">
            {signal.title}
          </div>
          <div className="text-muted-foreground text-xs mt-1 leading-snug">
            {signal.insight}
          </div>
          <div className="mt-2 flex items-center gap-2.5">
            <Button variant="outline" size="sm" onClick={onOpen}>
              View detail <ArrowRight size={11} />
            </Button>
            <span className="font-mono text-[11px] text-muted-foreground/80">
              Confidence {confidencePct(signal.confidence)}%
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="font-mono text-[11px] text-muted-foreground/80">
              {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-muted-foreground/60 hover:text-foreground transition-colors mt-0.5"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function SectoralSignalsSection() {
  const [signals, setSignals] = useState<SectoralSignal[] | null>(null);
  const [active, setActive] = useState<SectoralSignal | null>(null);

  useEffect(() => {
    api
      .listSectoral({ limit: 50 })
      .then((r) => setSignals(r.signals))
      .catch(() => setSignals([]));
  }, []);

  // Hide the whole section while loading or when there is nothing to show — no
  // empty placeholder, the section simply does not exist for the user.
  if (!signals || signals.length === 0) return null;

  function openDetail(s: SectoralSignal) {
    setActive(s);
    if (s.readAt === null) {
      api.markSectoralRead(s.id).catch(() => {});
      setSignals((prev) =>
        prev
          ? prev.map((x) => (x.id === s.id ? { ...x, readAt: new Date().toISOString() } : x))
          : prev,
      );
    }
  }

  function dismiss(id: string) {
    setSignals((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    api.dismissSectoral(id).catch(() => {});
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
          <div>
            <div className="font-semibold text-[13px] tracking-tight flex items-center gap-1.5">
              🌍 Sector trends
            </div>
            <div className="text-muted-foreground/80 text-[11px] font-mono">
              patterns across your competitors · not single-competitor signals
            </div>
          </div>
        </div>
        <div>
          {signals.map((s) => (
            <SectoralCard
              key={s.id}
              signal={s}
              onOpen={() => openDetail(s)}
              onDismiss={() => dismiss(s.id)}
            />
          ))}
        </div>
      </Card>
      <EvidenceModal signal={active} onClose={() => setActive(null)} />
    </>
  );
}
