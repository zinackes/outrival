"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Sparkles, Check } from "lucide-react";
import { api, type Signal } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSignals({ limit: 50 })
      .then((r) => setSignals(r.signals))
      .catch((e) => setError(String(e)));
  }, []);

  async function markRead(id: string) {
    await api.markSignalRead(id);
    setSignals((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, isRead: true } : s)) : prev,
    );
  }

  if (error)
    return (
      <p style={{ color: "var(--muted)" }} className="text-sm">
        Erreur : {error}
      </p>
    );
  if (signals === null)
    return (
      <p style={{ color: "var(--muted)" }} className="text-sm">
        Chargement…
      </p>
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
        Aucun signal pour l'instant. Les changements détectés apparaîtront ici une fois classifiés par l'IA.
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
                il y a {formatDistanceToNow(new Date(s.createdAt), { locale: fr, addSuffix: false })}
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
                Action : {s.recommendedAction}
              </p>
            )}
            {!s.isRead && (
              <button
                onClick={() => markRead(s.id)}
                style={{ color: "var(--muted)" }}
                className="text-xs flex items-center gap-1 hover:text-white transition-colors"
              >
                <Check size={12} /> Marquer comme lu
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
