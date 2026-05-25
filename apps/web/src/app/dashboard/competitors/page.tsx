"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Plus, Play, ExternalLink } from "lucide-react";
import { api, type Competitor } from "@/lib/api";

export default function CompetitorsPage() {
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  async function refresh() {
    try {
      const r = await api.listCompetitors();
      setCompetitors(r.competitors);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontFamily: "var(--font-syne)" }} className="text-2xl font-bold">
          Competitors
        </h1>
        <button
          onClick={() => setShowDialog(true)}
          style={{
            background: "var(--accent)",
            color: "#000",
            borderRadius: "var(--radius)",
          }}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} /> Ajouter
        </button>
      </div>

      {error && (
        <p style={{ color: "var(--muted)" }} className="text-sm mb-4">
          Erreur : {error}
        </p>
      )}

      {competitors === null && (
        <p style={{ color: "var(--muted)" }} className="text-sm">
          Chargement…
        </p>
      )}

      {competitors && competitors.length === 0 && (
        <div
          style={{ color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}
          className="p-8 text-sm text-center"
        >
          Aucun concurrent. Ajoutez-en un pour commencer.
        </div>
      )}

      {competitors && competitors.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {competitors.map((c) => (
            <li
              key={c.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
              }}
              className="p-4 flex flex-col gap-2"
            >
              <Link
                href={`/dashboard/competitors/${c.id}`}
                className="text-base font-semibold hover:underline"
              >
                {c.name}
              </Link>
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--muted)" }}
                className="text-xs flex items-center gap-1 truncate hover:opacity-80"
              >
                {c.url} <ExternalLink size={12} />
              </a>
              <p style={{ color: "var(--muted)" }} className="text-xs">
                ajouté il y a{" "}
                {formatDistanceToNow(new Date(c.createdAt), { locale: fr, addSuffix: false })}
              </p>
            </li>
          ))}
        </ul>
      )}

      {showDialog && <AddCompetitorDialog onClose={() => setShowDialog(false)} onAdded={refresh} />}
    </div>
  );
}

function AddCompetitorDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.createCompetitor({ name, url });
      await onAdded();
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
        className="w-full max-w-md p-6 flex flex-col gap-4"
      >
        <h2 style={{ fontFamily: "var(--font-syne)" }} className="text-xl font-bold">
          Ajouter un concurrent
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "inherit",
            }}
            className="px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          URL
          <input
            required
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "inherit",
            }}
            className="px-3 py-2"
          />
        </label>
        {err && (
          <p style={{ color: "var(--muted)" }} className="text-xs">
            {err}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
            className="px-3 py-2 text-sm"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              background: "var(--accent)",
              color: "#000",
              borderRadius: "var(--radius)",
            }}
            className="px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Ajout…" : "Ajouter"}
          </button>
        </div>
      </form>
    </div>
  );
}
