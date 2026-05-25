"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, Save, Sparkles, X } from "lucide-react";
import { api, type BattleCard, type BattleCardContent } from "@/lib/api";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";

const EMPTY_CONTENT: BattleCardContent = {
  their_strengths: [],
  our_strengths: [],
  their_weaknesses: [],
  common_objections: [],
  when_we_win: [],
  when_we_lose: [],
};

type Status = "loading" | "absent" | "ready" | "generating" | "saving" | "error";

interface Props {
  competitorId: string;
}

export function BattleCardTab({ competitorId }: Props) {
  const [card, setCard] = useState<BattleCard | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BattleCardContent>(EMPTY_CONTENT);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load(silent = false) {
    if (!silent) setStatus("loading");
    try {
      const res = await api.getBattleCard(competitorId);
      setCard(res.battleCard);
      setDraft(res.battleCard.content);
      setStatus("ready");
      return res.battleCard;
    } catch (e) {
      if (String(e).includes("404")) {
        setStatus("absent");
        return null;
      }
      setError(String(e));
      setStatus("error");
      return null;
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [competitorId]);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const prevR2 = card?.pdfR2Key ?? null;
      const fresh = await load(true);
      if (fresh && fresh.pdfR2Key && fresh.pdfR2Key !== prevR2) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setStatus("ready");
      }
    }, 3000);
  }

  async function onGenerate() {
    setStatus("generating");
    setError(null);
    try {
      await api.generateBattleCard(competitorId);
      startPolling();
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
        setStatus(card ? "ready" : "absent");
      } else {
        setError(String(e));
        setStatus("error");
      }
    }
  }

  async function onSave() {
    if (!card) return;
    setStatus("saving");
    try {
      const res = await api.patchBattleCard(competitorId, draft);
      setCard(res.battleCard);
      setDraft(res.battleCard.content);
      setEditing(false);
      setStatus("ready");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  const paywallNode = (
    <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
  );

  if (status === "loading") return <Note text="Chargement…" />;
  if (status === "error") return <Note text={`Erreur : ${error}`} />;
  if (status === "absent") {
    return (
      <>
        <div
          className="p-6 text-center flex flex-col items-center gap-3"
          style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}
        >
          <Sparkles size={20} style={{ color: "var(--accent)" }} />
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Aucune battle card pour ce concurrent. Générez-en une avec l&apos;IA en quelques secondes.
          </p>
          <button
            onClick={onGenerate}
            style={{ background: "var(--accent)", color: "#000", borderRadius: "var(--radius)" }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            <Sparkles size={14} /> Générer la battle card
          </button>
        </div>
        {paywallNode}
      </>
    );
  }

  if (status === "generating") {
    return (
      <div
        className="p-6 text-center flex flex-col items-center gap-2"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
      >
        <RefreshCw size={18} className="animate-spin" style={{ color: "var(--accent)" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Génération en cours… (~10-20s)
        </p>
      </div>
    );
  }

  if (!card) return null;
  const showContent = editing ? draft : card.content;
  const canDownload = !editing && Boolean(card.pdfR2Key);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-2">
        {editing ? (
          <>
            <button
              onClick={() => {
                setDraft(card.content);
                setEditing(false);
              }}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs hover:opacity-90"
            >
              <X size={12} /> Annuler
            </button>
            <button
              disabled={status === "saving"}
              onClick={onSave}
              style={{ background: "var(--accent)", color: "#000", borderRadius: "var(--radius)" }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Save size={12} /> {status === "saving" ? "Enregistrement…" : "Enregistrer"}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs hover:opacity-90"
            >
              Éditer
            </button>
            <button
              onClick={onGenerate}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs hover:opacity-90"
            >
              <RefreshCw size={12} /> Régénérer
            </button>
            <a
              href={canDownload ? api.battleCardPdfUrl(competitorId) : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!canDownload}
              style={{
                background: "var(--accent)",
                color: "#000",
                borderRadius: "var(--radius)",
                pointerEvents: canDownload ? "auto" : "none",
                opacity: canDownload ? 1 : 0.5,
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:opacity-90"
            >
              <Download size={12} /> Télécharger PDF
            </a>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Section
          title="Leurs forces"
          accent="#ef4444"
          items={showContent.their_strengths}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, their_strengths: items })}
        />
        <Section
          title="Nos forces"
          accent="#10b981"
          items={showContent.our_strengths}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, our_strengths: items })}
        />
      </div>

      <Section
        title="Leurs faiblesses"
        accent="var(--accent)"
        items={showContent.their_weaknesses}
        editing={editing}
        onChange={(items) => setDraft({ ...draft, their_weaknesses: items })}
      />

      <ObjectionsSection
        items={showContent.common_objections}
        editing={editing}
        onChange={(items) => setDraft({ ...draft, common_objections: items })}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Section
          title="Quand on gagne"
          accent="#10b981"
          items={showContent.when_we_win}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, when_we_win: items })}
        />
        <Section
          title="Quand on perd"
          accent="#ef4444"
          items={showContent.when_we_lose}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, when_we_lose: items })}
        />
      </div>

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Généré le {new Date(card.generatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
        {!card.pdfR2Key && " · PDF en attente de génération"}
      </p>
      {paywallNode}
    </div>
  );
}

function Section({
  title,
  accent,
  items,
  editing,
  onChange,
}: {
  title: string;
  accent: string;
  items: string[];
  editing: boolean;
  onChange: (items: string[]) => void;
}) {
  return (
    <div
      style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
      className="p-3"
    >
      <p className="text-xs uppercase tracking-wide mb-2" style={{ color: accent }}>
        {title}
      </p>
      {editing ? (
        <EditableList items={items} onChange={onChange} max={5} />
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>—</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {items.map((it, i) => (
            <li key={i}>· {it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ObjectionsSection({
  items,
  editing,
  onChange,
}: {
  items: Array<{ objection: string; response: string }>;
  editing: boolean;
  onChange: (items: Array<{ objection: string; response: string }>) => void;
}) {
  return (
    <div
      style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
      className="p-3"
    >
      <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--accent)" }}>
        Objections fréquentes
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          {items.map((o, i) => (
            <div key={i} className="flex flex-col gap-1 p-2" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
              <input
                value={o.objection}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...o, objection: e.target.value };
                  onChange(next);
                }}
                placeholder="Objection..."
                style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
                className="text-sm px-2 py-1.5 outline-none focus:border-[var(--accent)]"
              />
              <textarea
                value={o.response}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...o, response: e.target.value };
                  onChange(next);
                }}
                placeholder="Réponse..."
                rows={2}
                style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
                className="text-sm px-2 py-1.5 outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="text-xs self-start"
                style={{ color: "var(--muted)" }}
              >
                Supprimer
              </button>
            </div>
          ))}
          {items.length < 5 && (
            <button
              onClick={() => onChange([...items, { objection: "", response: "" }])}
              className="text-xs self-start"
              style={{ color: "var(--accent)" }}
            >
              + Ajouter une objection
            </button>
          )}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>—</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((o, i) => (
            <div key={i}>
              <p className="text-sm font-medium">«&nbsp;{o.objection}&nbsp;»</p>
              <p
                className="text-sm pl-3 mt-1"
                style={{ color: "var(--muted)", borderLeft: "2px solid var(--accent)" }}
              >
                {o.response}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditableList({
  items,
  onChange,
  max,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  max: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={it}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
            className="flex-1 text-sm px-2 py-1.5 outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="text-xs"
            style={{ color: "var(--muted)" }}
            aria-label="Supprimer"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {items.length < max && (
        <button
          onClick={() => onChange([...items, ""])}
          className="text-xs self-start"
          style={{ color: "var(--accent)" }}
        >
          + Ajouter
        </button>
      )}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p
      className="text-sm p-6 text-center"
      style={{ color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}
    >
      {text}
    </p>
  );
}
