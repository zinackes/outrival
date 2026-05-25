"use client";

import { useEffect, useState } from "react";
import { api, type Digest, type DigestSection } from "@/lib/api";

const URGENCY_META: Record<
  DigestSection["urgency"],
  { emoji: string; label: string; color: string }
> = {
  action_required: { emoji: "🔴", label: "Action requise", color: "#ef4444" },
  watch: { emoji: "🟡", label: "À surveiller", color: "#f59e0b" },
  fyi: { emoji: "🟢", label: "Pour info", color: "#22c55e" },
};

export function DigestsList() {
  const [digests, setDigests] = useState<Digest[] | null>(null);
  const [active, setActive] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listDigests()
      .then((r) => setDigests(r.digests))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p style={{ color: "var(--muted)" }} className="text-sm">Erreur : {error}</p>;
  if (digests === null) return <p style={{ color: "var(--muted)" }} className="text-sm">Chargement…</p>;
  if (digests.length === 0)
    return (
      <div
        style={{ color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}
        className="p-6 text-sm text-center"
      >
        Aucun digest pour l'instant. Le prochain est généré chaque lundi matin.
      </div>
    );

  if (active) {
    const content = active.content;
    return (
      <div>
        <button
          onClick={() => setActive(null)}
          style={{ color: "var(--muted)" }}
          className="text-sm mb-4 hover:text-white"
        >
          ← Retour
        </button>
        <h2 style={{ fontFamily: "var(--font-syne)" }} className="text-xl font-bold mb-1">
          Semaine du {active.weekStart} au {active.weekEnd}
        </h2>
        <p style={{ color: "var(--muted)" }} className="text-sm mb-6">
          Température · {content.temperature}
        </p>

        <div
          style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
          className="p-4 mb-6"
        >
          <h3 className="text-sm font-semibold mb-2">TL;DR</h3>
          <ul className="text-sm list-disc pl-5">
            {content.tldr.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>

        {(["action_required", "watch", "fyi"] as const).map((urgency) => {
          const items = content.sections.filter((s) => s.urgency === urgency);
          if (items.length === 0) return null;
          const meta = URGENCY_META[urgency];
          return (
            <div key={urgency} className="mb-6">
              <h3
                style={{ fontFamily: "var(--font-syne)", color: meta.color }}
                className="text-base font-bold mb-2"
              >
                {meta.emoji} {meta.label}
              </h3>
              <ul className="flex flex-col gap-2">
                {items.map((s, i) => (
                  <li
                    key={i}
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
                    className="p-3"
                  >
                    <div style={{ color: "var(--muted)" }} className="text-xs uppercase tracking-wide mb-1">
                      {s.competitor} · {s.category}
                    </div>
                    <p className="text-sm mb-1">{s.insight}</p>
                    <p style={{ color: "var(--accent)" }} className="text-sm">→ {s.so_what}</p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {digests.map((d) => (
        <li key={d.id}>
          <button
            onClick={() => setActive(d)}
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
            className="w-full text-left p-4 hover:border-white/30 transition-colors"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium text-sm">Semaine du {d.weekStart}</div>
                <div style={{ color: "var(--muted)" }} className="text-xs mt-1">
                  Température · {d.content.temperature} · {d.content.sections.length} signaux
                </div>
              </div>
              <div style={{ color: "var(--muted)" }} className="text-xs">
                {d.sentAt ? "✓ envoyé" : "non envoyé"}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
