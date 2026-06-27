"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  X,
  Sparkles,
  TrendingUp,
  DollarSign,
  Target,
  Sprout,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { api, type SectoralSignal, type SectoralCategory } from "@/lib/api";
import { sectoralTeaserQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { SectionHead } from "./section-head";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const CATEGORY_META: Record<SectoralCategory, { icon: LucideIcon; label: string }> = {
  feature_trend: { icon: Sparkles, label: "Features" },
  hiring_trend: { icon: TrendingUp, label: "Hiring" },
  pricing_trend: { icon: DollarSign, label: "Pricing" },
  positioning_shift: { icon: Target, label: "Positioning" },
  category_emergence: { icon: Sprout, label: "Emerging" },
};

export function confidencePct(raw: string): number {
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

export function EvidenceModal({
  signal,
  onClose,
}: {
  signal: SectoralSignal | null;
  onClose: () => void;
}) {
  const open = signal !== null;
  const Icon = signal ? CATEGORY_META[signal.category].icon : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {signal && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-content">
                {Icon && <Icon size={15} className="text-muted-foreground" aria-hidden />}
                {signal.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-dense">
              <p className="text-muted-foreground leading-snug">{signal.insight}</p>

              <div>
                <div className="text-meta text-muted-foreground mb-1.5">
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
                  <div className="text-meta text-muted-foreground mb-1.5">
                    Data points
                  </div>
                  <ul className="space-y-1">
                    {signal.evidence.dataPoints.map((dp, i) => (
                      <li
                        key={i}
                        className="text-meta text-muted-foreground leading-snug"
                      >
                        {renderDataPoint(dp)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-3 border-t border-border pt-3 text-meta text-muted-foreground">
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

export function SectoralRow({
  signal,
  onOpen,
  onDismiss,
}: {
  signal: SectoralSignal;
  onOpen: () => void;
  // Omitted in the Dismissed view — there is nothing left to dismiss there.
  onDismiss?: () => void;
}) {
  const meta = CATEGORY_META[signal.category];
  const Icon = meta.icon;
  const unread = signal.readAt === null;
  return (
    <div className="px-1.5 py-3.5 border-b border-border last:border-b-0">
      <div className="flex items-start gap-3">
        <Icon
          size={15}
          className="text-muted-foreground mt-0.5 shrink-0"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-meta text-muted-foreground">
              {meta.label}
            </span>
            {unread && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-primary"
                aria-label="Unread"
              />
            )}
          </div>
          <div className="text-content font-semibold tracking-tight mt-0.5 leading-snug">
            {signal.title}
          </div>
          <div className="text-muted-foreground text-sm mt-1 leading-snug max-w-[78ch]">
            {signal.insight}
          </div>
          <div className="mt-2 flex items-center gap-2.5">
            <Button variant="outline" size="sm" onClick={onOpen}>
              View detail <ArrowRight size={11} />
            </Button>
            <span className="text-meta text-muted-foreground">
              Confidence {confidencePct(signal.confidence)}%
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-meta text-muted-foreground">
              {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground transition-colors mt-0.5"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function SectoralSignalsSection() {
  // Overview teaser — the top few; the full feed lives on /dashboard/sector.
  const queryClient = useQueryClient();
  const sectoralQ = useQuery(sectoralTeaserQuery());
  const signals = sectoralQ.data ?? null;
  const [active, setActive] = useState<SectoralSignal | null>(null);

  // Optimistic write-through for the read / dismiss mutations below.
  function setSignals(updater: (prev: SectoralSignal[] | null) => SectoralSignal[] | null) {
    queryClient.setQueryData<SectoralSignal[]>(sectoralTeaserQuery().queryKey, (prev) =>
      updater(prev ?? null) ?? undefined,
    );
  }

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
    <section>
      <SectionHead
        title="Sector trends"
        icon={<Globe size={14} />}
        sub="patterns across your competitors · not single-competitor signals"
      />
      <div>
        {signals.map((s) => (
          <SectoralRow
            key={s.id}
            signal={s}
            onOpen={() => openDetail(s)}
            onDismiss={() => dismiss(s.id)}
          />
        ))}
      </div>
      <div className="pt-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/sector">
            View all sector trends <ArrowRight size={11} />
          </Link>
        </Button>
      </div>
      <EvidenceModal signal={active} onClose={() => setActive(null)} />
    </section>
  );
}
