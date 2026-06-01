"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Sparkles, Check } from "lucide-react";
import { api, type Signal } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListError } from "@/components/outrival/list-error";

const SEVERITY_STYLE: Record<
  Signal["severity"],
  { bg: string; color: string; label: string }
> = {
  critical: { bg: "#7f1d1d", color: "#fca5a5", label: "Critical" },
  high: { bg: "#7c2d12", color: "#fdba74", label: "High" },
  medium: { bg: "#713f12", color: "#fde68a", label: "Medium" },
  low: { bg: "#1e3a8a", color: "#93c5fd", label: "Low" },
};

export function ActivityFeed() {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .listSignals({ limit: 50 })
      .then((r) => setSignals(r.signals))
      .catch((e) => setError(e));
  }, []);

  async function markRead(id: string) {
    await api.markSignalRead(id);
    setSignals((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, isRead: true } : s)) : prev,
    );
  }

  if (error && signals === null) return <ListError error={error} />;
  if (signals === null)
    return (
      <ul className="flex flex-col gap-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
            className="p-4 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16 ml-auto" />
            </div>
            <Skeleton className="h-3 w-[90%]" />
            <Skeleton className="h-3 w-[70%]" />
          </li>
        ))}
      </ul>
    );
  if (signals.length === 0)
    return (
      <div
        style={{
          color: "var(--muted)",
          border: "1px dashed var(--border)",
          borderRadius: "var(--radius)",
        }}
        className="p-6 text-sm text-center"
      >
        No signals yet. Detected changes will appear here once classified by the AI.
      </div>
    );

  return (
    <ul className="flex flex-col gap-3">
      {signals.map((s) => {
        const sev = SEVERITY_STYLE[s.severity];
        return (
          <li
            key={s.id}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              opacity: s.isRead ? 0.6 : 1,
            }}
            className="p-4"
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                style={{ background: sev.bg, color: sev.color }}
                className="text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
              >
                {sev.label}
              </span>
              <span
                style={{ color: "var(--accent)" }}
                className="text-xs font-medium uppercase tracking-wide"
              >
                {s.category}
              </span>
              <Sparkles size={12} style={{ color: "var(--muted)" }} />
              <span className="text-sm font-medium">{s.competitorName}</span>
              <span style={{ color: "var(--muted)" }} className="text-xs ml-auto">
                {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm mb-2">{s.insight}</p>
            {s.soWhat && (
              <p style={{ color: "var(--accent)" }} className="text-sm mb-2">
                → {s.soWhat}
              </p>
            )}
            {s.recommendedAction && (
              <p style={{ color: "var(--muted)" }} className="text-xs mb-2">
                Action: {s.recommendedAction}
              </p>
            )}
            {!s.isRead && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markRead(s.id)}
                className="h-7 px-2 text-xs"
              >
                <Check size={12} /> Mark as read
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
