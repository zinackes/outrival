"use client";

import { useEffect, useRef, useState } from "react";
import { Download, HelpCircle, Loader2, RefreshCw, Save, Sparkles, X } from "lucide-react";
import { api, type BattleCard, type BattleCardContent } from "@/lib/api";
import { track } from "@/lib/posthog/events";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

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
      track("battle_card_generated", { competitorId });
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

  if (status === "loading") return <BattleCardSkeleton />;
  if (status === "error") return <Note text={`Error: ${error}`} />;
  if (status === "absent") {
    return (
      <>
        <Card className="p-6 text-center flex flex-col items-center gap-3 border-dashed">
          <Sparkles size={20} className="text-primary" />
          <p className="text-sm text-muted-foreground">
            No battle card for this competitor yet. Generate one with AI in a
            few seconds.
          </p>
          <Button onClick={onGenerate}>
            <Sparkles size={14} /> Generate battle card
          </Button>
        </Card>
        {paywallNode}
      </>
    );
  }

  if (status === "generating") {
    return (
      <Card className="p-6 text-center flex flex-col items-center gap-2">
        <RefreshCw size={18} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Generating… (~10-20s)
        </p>
      </Card>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(card.content);
                setEditing(false);
              }}
            >
              <X size={12} /> Cancel
            </Button>
            <Button
              size="sm"
              disabled={status === "saving"}
              onClick={onSave}
            >
              {status === "saving" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              {status === "saving" ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={onGenerate}>
              <RefreshCw size={12} /> Regenerate
            </Button>
            <Button
              asChild={canDownload}
              size="sm"
              disabled={!canDownload}
            >
              {canDownload ? (
                <a
                  href={api.battleCardPdfUrl(competitorId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={12} /> Download PDF
                </a>
              ) : (
                <span className="opacity-50">
                  <Download size={12} /> Download PDF
                </span>
              )}
            </Button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Section
          title="Their strengths"
          accent="text-destructive"
          items={showContent.their_strengths}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, their_strengths: items })}
        />
        <Section
          title="Our strengths"
          accent="text-emerald-400"
          items={showContent.our_strengths}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, our_strengths: items })}
        />
      </div>

      <Section
        title="Their weaknesses"
        accent="text-primary"
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
          title="When we win"
          accent="text-emerald-400"
          items={showContent.when_we_win}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, when_we_win: items })}
        />
        <Section
          title="When we lose"
          accent="text-destructive"
          items={showContent.when_we_lose}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, when_we_lose: items })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Generated on{" "}
        {new Date(card.generatedAt).toLocaleDateString("en-US", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}
        {!card.pdfR2Key && " · PDF pending generation"}
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
    <Card className="p-3">
      <p className={`text-xs uppercase tracking-wide mb-2 ${accent}`}>{title}</p>
      {editing ? (
        <EditableList items={items} onChange={onChange} max={5} />
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {items.map((it, i) => (
            <li key={i}>· {it}</li>
          ))}
        </ul>
      )}
    </Card>
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
    <Card className="p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-xs uppercase tracking-wide text-primary">
          Common objections
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle
              size={13}
              className="text-muted-foreground cursor-help"
            />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Objections a prospect might raise to pick this competitor over you —
            each paired with a sales response to counter it.
          </TooltipContent>
        </Tooltip>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          {items.map((o, i) => (
            <div
              key={i}
              className="flex flex-col gap-1 p-2 border border-border rounded-md"
            >
              <Input
                value={o.objection}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...o, objection: e.target.value };
                  onChange(next);
                }}
                placeholder="Objection..."
              />
              <Textarea
                value={o.response}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...o, response: e.target.value };
                  onChange(next);
                }}
                placeholder="Response..."
                rows={2}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange(items.filter((_, idx) => idx !== i))
                }
                className="self-start h-7 px-2 text-xs"
              >
                Remove
              </Button>
            </div>
          ))}
          {items.length < 5 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange([...items, { objection: "", response: "" }])}
              className="self-start h-7 px-2 text-xs text-primary"
            >
              + Add an objection
            </Button>
          )}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((o, i) => (
            <div key={i}>
              <p className="text-sm font-medium">«&nbsp;{o.objection}&nbsp;»</p>
              <p className="text-sm pl-3 mt-1 text-muted-foreground border-l-2 border-primary">
                {o.response}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
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
          <Input
            value={it}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            className="flex-1"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                aria-label="Remove"
                className="h-7 w-7"
              >
                <X size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove</TooltipContent>
          </Tooltip>
        </div>
      ))}
      {items.length < max && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...items, ""])}
          className="self-start h-7 px-2 text-xs text-primary"
        >
          + Add
        </Button>
      )}
    </div>
  );
}

function BattleCardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="p-3 flex flex-col gap-2">
            <Skeleton className="h-3 w-24 mb-1" />
            <Skeleton className="h-3 w-[90%]" />
            <Skeleton className="h-3 w-[70%]" />
            <Skeleton className="h-3 w-[80%]" />
          </Card>
        ))}
      </div>
      <Card className="p-3 flex flex-col gap-2">
        <Skeleton className="h-3 w-24 mb-1" />
        <Skeleton className="h-3 w-[90%]" />
        <Skeleton className="h-3 w-[75%]" />
      </Card>
      <Card className="p-3 flex flex-col gap-3">
        <Skeleton className="h-3 w-32 mb-1" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="p-3 flex flex-col gap-2">
            <Skeleton className="h-3 w-24 mb-1" />
            <Skeleton className="h-3 w-[80%]" />
            <Skeleton className="h-3 w-[60%]" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p className="text-sm p-6 text-center text-muted-foreground border border-dashed border-border rounded-md">
      {text}
    </p>
  );
}
