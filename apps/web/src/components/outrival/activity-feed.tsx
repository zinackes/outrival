"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Activity } from "lucide-react";
import { api, type ChangeRow } from "@/lib/api";

export function ActivityFeed() {
  const [changes, setChanges] = useState<ChangeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listChanges({ limit: 50 })
      .then((r) => setChanges(r.changes))
      .catch((e) => setError(String(e)));
  }, []);

  if (error)
    return (
      <p style={{ color: "var(--muted)" }} className="text-sm">
        Erreur : {error}
      </p>
    );
  if (changes === null)
    return (
      <p style={{ color: "var(--muted)" }} className="text-sm">
        Chargement…
      </p>
    );
  if (changes.length === 0)
    return (
      <div
        style={{ color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}
        className="p-6 text-sm text-center"
      >
        Aucun changement détecté pour l'instant.
      </div>
    );

  return (
    <ul className="flex flex-col gap-3">
      {changes.map((c) => (
        <li
          key={c.id}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          className="p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <Activity size={14} style={{ color: "var(--accent)" }} />
            <span style={{ color: "var(--muted)" }} className="text-xs">
              il y a{" "}
              {formatDistanceToNow(new Date(c.detectedAt), { locale: fr, addSuffix: false })}
            </span>
            <span
              style={{ color: "var(--accent)" }}
              className="text-xs font-medium uppercase tracking-wide"
            >
              {c.sourceType}
            </span>
            <span className="text-sm font-medium">{c.competitorName}</span>
          </div>
          {c.diffText && (
            <pre
              style={{ color: "var(--muted)" }}
              className="text-xs whitespace-pre-wrap line-clamp-4 font-mono"
            >
              {c.diffText.slice(0, 500)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}
