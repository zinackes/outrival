"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowLeft, Play, ExternalLink } from "lucide-react";
import { api, type Competitor, type Monitor, type ChangeRow } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

export default function CompetitorDetailPage({ params }: Props) {
  const { id } = use(params);
  const [data, setData] = useState<{
    competitor: Competitor;
    monitors: Monitor[];
    recentChanges: ChangeRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  async function refresh() {
    try {
      setData(await api.getCompetitor(id));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, [id]);

  async function runMonitor(monitorId: string) {
    setRunningId(monitorId);
    try {
      await api.runMonitor(monitorId);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunningId(null);
    }
  }

  if (error)
    return (
      <p style={{ color: "var(--muted)" }} className="text-sm">
        Erreur : {error}
      </p>
    );
  if (!data)
    return (
      <p style={{ color: "var(--muted)" }} className="text-sm">
        Chargement…
      </p>
    );

  return (
    <div>
      <Link
        href="/dashboard/competitors"
        style={{ color: "var(--muted)" }}
        className="text-sm flex items-center gap-1 mb-4 hover:opacity-80"
      >
        <ArrowLeft size={14} /> Retour
      </Link>

      <div className="mb-6">
        <h1 style={{ fontFamily: "var(--font-syne)" }} className="text-2xl font-bold mb-1">
          {data.competitor.name}
        </h1>
        <a
          href={data.competitor.url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--muted)" }}
          className="text-sm flex items-center gap-1 hover:opacity-80"
        >
          {data.competitor.url} <ExternalLink size={12} />
        </a>
      </div>

      <h2 style={{ fontFamily: "var(--font-syne)" }} className="text-lg font-bold mb-3">
        Monitors
      </h2>
      <ul className="flex flex-col gap-2 mb-8">
        {data.monitors.map((m) => (
          <li
            key={m.id}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
            className="p-3 flex items-center justify-between"
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium uppercase tracking-wide">
                {m.sourceType} <span style={{ color: "var(--muted)" }}>· {m.frequency}</span>
              </span>
              <span style={{ color: "var(--muted)" }} className="text-xs">
                {m.lastRunAt
                  ? `dernier scrape il y a ${formatDistanceToNow(new Date(m.lastRunAt), { locale: fr })}`
                  : "jamais scrapé"}
              </span>
            </div>
            <button
              onClick={() => runMonitor(m.id)}
              disabled={runningId === m.id}
              style={{
                background: "var(--accent)",
                color: "#000",
                borderRadius: "var(--radius)",
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              <Play size={12} /> {runningId === m.id ? "Lancé…" : "Scraper maintenant"}
            </button>
          </li>
        ))}
      </ul>

      <h2 style={{ fontFamily: "var(--font-syne)" }} className="text-lg font-bold mb-3">
        Changements récents
      </h2>
      {data.recentChanges.length === 0 ? (
        <p style={{ color: "var(--muted)" }} className="text-sm">
          Aucun changement détecté.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.recentChanges.map((c) => (
            <li
              key={c.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
              }}
              className="p-3"
            >
              <p style={{ color: "var(--muted)" }} className="text-xs mb-1">
                il y a {formatDistanceToNow(new Date(c.detectedAt), { locale: fr })} · {c.sourceType}
              </p>
              {c.diffText && (
                <pre
                  style={{ color: "var(--muted)" }}
                  className="text-xs whitespace-pre-wrap font-mono"
                >
                  {c.diffText.slice(0, 400)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
