"use client";

import { useEffect, useState } from "react";
import { Check, X, ExternalLink, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { api, type CompetitorCandidate } from "@/lib/api";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";

export default function CandidatesPage() {
  const [items, setItems] = useState<CompetitorCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  async function load() {
    try {
      const { candidates } = await api.listCandidates("new");
      setItems(candidates);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(id: string) {
    setActingId(id);
    try {
      await api.addCandidate(id);
      setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
      } else {
        setError(String(e));
      }
    } finally {
      setActingId(null);
    }
  }

  async function dismiss(id: string) {
    setActingId(id);
    try {
      await api.dismissCandidate(id);
      setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setActingId(null);
    }
  }

  if (error) return <p className="text-sm" style={{ color: "var(--muted)" }}>Erreur : {error}</p>;
  if (items === null) return <p className="text-sm" style={{ color: "var(--muted)" }}>Chargement…</p>;

  return (
    <div>
      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      <header className="mb-6">
        <h1 style={{ fontFamily: "var(--font-syne)" }} className="text-2xl font-bold mb-1">
          Concurrents détectés
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Nouveaux concurrents repérés par l&apos;IA dans votre espace. Ajoutez-les à votre veille ou ignorez-les.
        </p>
      </header>

      {items.length === 0 ? (
        <div
          className="p-8 text-center flex flex-col items-center gap-3"
          style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}
        >
          <Sparkles size={20} style={{ color: "var(--accent)" }} />
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Aucun nouveau concurrent à examiner. La détection tourne tous les dimanches soir.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li
              key={c.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
              }}
              className="p-4 flex items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 mb-1">
                  <h2 className="text-sm font-bold truncate">{c.title ?? c.url}</h2>
                  {c.overlapScore !== null && (
                    <span
                      style={{ background: "var(--accent)", color: "#000" }}
                      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded font-semibold"
                    >
                      overlap {Math.round(c.overlapScore)}%
                    </span>
                  )}
                </div>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs flex items-center gap-1 hover:opacity-80 mb-2"
                  style={{ color: "var(--muted)" }}
                >
                  {c.url} <ExternalLink size={11} />
                </a>
                {c.reason && (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {c.reason}
                  </p>
                )}
                <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                  détecté il y a {formatDistanceToNow(new Date(c.firstSeenAt), { locale: fr })}
                </p>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button
                  disabled={actingId === c.id}
                  onClick={() => add(c.id)}
                  style={{ background: "var(--accent)", color: "#000", borderRadius: "var(--radius)" }}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  <Check size={12} /> Ajouter
                </button>
                <button
                  disabled={actingId === c.id}
                  onClick={() => dismiss(c.id)}
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:opacity-90 disabled:opacity-50"
                >
                  <X size={12} /> Ignorer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
