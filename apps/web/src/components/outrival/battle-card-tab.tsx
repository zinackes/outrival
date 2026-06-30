"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import {
  CircleCheck,
  CircleX,
  Download,
  HelpCircle,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { api, type BattleCard, type BattleCardContent } from "@/lib/api";
import { track } from "@/lib/posthog/events";
import {
  PaywallDialog,
  paywallFromError,
  tierLimitFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedbackButtons } from "@/components/outrival/feedback-buttons";
import { TabCard } from "@/components/outrival/tab-shell";
import { cn } from "@/lib/utils";

const EMPTY_CONTENT: BattleCardContent = {
  their_strengths: [],
  our_strengths: [],
  their_weaknesses: [],
  common_objections: [],
  when_we_win: [],
  when_we_lose: [],
};

type Status = "loading" | "absent" | "ready" | "generating" | "saving" | "error";

type Staleness = Awaited<ReturnType<typeof api.getBattleCardStaleness>> | null;

type IconType = ComponentType<{ size?: number; className?: string }>;

interface Props {
  competitorId: string;
}

export function BattleCardTab({ competitorId }: Props) {
  // patch-28 — scope the card to the active product (cookie-backed switcher, URL
  // ?product= overrides); omitted = the org's primary product (the API default).
  const productId = useProductScope() ?? undefined;
  const [card, setCard] = useState<BattleCard | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BattleCardContent>(EMPTY_CONTENT);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [staleness, setStaleness] = useState<Staleness>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refreshStaleness() {
    try {
      setStaleness(await api.getBattleCardStaleness(competitorId, productId));
    } catch {
      setStaleness(null); // best-effort — fall back to always-enabled regenerate
    }
  }

  async function load(silent = false) {
    if (!silent) setStatus("loading");
    try {
      const res = await api.getBattleCard(competitorId, productId);
      setCard(res.battleCard);
      setDraft(res.battleCard.content);
      // While polling, the poll loop owns the status (it keeps the "generating"
      // spinner up until fresh content lands) — don't pre-empt it here.
      if (!silent) setStatus("ready");
      return res.battleCard;
    } catch (e) {
      if (String(e).includes("404")) {
        // A 404 mid-generation just means the row isn't written yet — keep the
        // spinner instead of flashing the empty "Generate" state.
        if (!silent) setStatus("absent");
        return null;
      }
      if (!silent) {
        setError(String(e));
        setStatus("error");
      }
      return null;
    }
  }

  useEffect(() => {
    (async () => {
      const loaded = await load();
      if (loaded) await refreshStaleness();
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [competitorId, productId]);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function startPolling() {
    stopPolling();
    // Snapshot the pre-generation state. The job writes the card content first
    // (~10-20s of AI) and only then renders + uploads the PDF (slower). Reveal the
    // card the moment new content lands — don't make the user stare at a spinner
    // through the extra PDF step — and keep polling silently to enable Download.
    const prevGeneratedAt = card?.generatedAt ?? null;
    const prevR2 = card?.pdfR2Key ?? null;
    let polls = 0;
    let revealed = false;
    pollRef.current = setInterval(async () => {
      polls += 1;
      const fresh = await load(true);
      if (fresh && fresh.generatedAt !== prevGeneratedAt) {
        setStatus("ready");
        revealed = true;
      }
      if (fresh && fresh.pdfR2Key && fresh.pdfR2Key !== prevR2) {
        stopPolling();
        void refreshStaleness(); // regenerated → should now read "fresh"
        return;
      }
      // Safety net: a failed/stuck job must not spin forever (~3 min cap).
      if (polls >= 60) {
        stopPolling();
        if (!revealed) setStatus(card ? "ready" : "absent");
      }
    }, 3000);
  }

  async function onGenerate() {
    setConfirmingRegen(false);
    setStatus("generating");
    setError(null);
    try {
      await api.generateBattleCard(competitorId, productId);
      track("battle_card_generated", { competitorId });
      startPolling();
    } catch (e) {
      // 403 plan_* feature locks → paywallFromError; the 429 daily-cap quota →
      // tierLimitFromError. Both render the same dialog with quota-aware copy.
      const reason = paywallFromError(e) ?? tierLimitFromError(e);
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
      const res = await api.patchBattleCard(competitorId, draft, productId);
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
        <EmptyState
          icon={Sparkles}
          title="No battle card for this competitor yet"
          description="Generate one with AI in a few seconds."
          actions={
            <Button onClick={onGenerate}>
              <Sparkles size={14} /> Generate battle card
            </Button>
          }
        />
        {paywallNode}
      </>
    );
  }

  if (status === "generating") {
    return (
      <Card className="p-6 text-center flex flex-col items-center gap-2">
        <RefreshCw size={18} className="animate-spin text-primary" />
        <p className="text-dense text-muted-foreground">Generating… (~10-20s)</p>
      </Card>
    );
  }

  if (!card) return null;
  const showContent = editing ? draft : card.content;
  const canDownload = !editing && Boolean(card.pdfR2Key);

  return (
    <TabCard>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <h2 className="flex items-center gap-2 text-content font-semibold tracking-tight leading-tight">
          <Swords size={14} className="text-muted-foreground shrink-0" />
          Battle card
        </h2>
        <div className="flex items-center gap-2">
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
            <Button size="sm" disabled={status === "saving"} onClick={onSave}>
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
            {staleness && !staleness.needsRegeneration ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setConfirmingRegen(true)}
                  >
                    <RefreshCw size={12} /> Regenerate · up to date
                  </Button>
                </TooltipTrigger>
                <TooltipContent>No changes since the last generation.</TooltipContent>
              </Tooltip>
            ) : (
              <Button size="sm" onClick={onGenerate}>
                <RefreshCw size={12} /> Regenerate
              </Button>
            )}
            <Button asChild={canDownload} size="sm" disabled={!canDownload}>
              {canDownload ? (
                <a
                  href={api.battleCardPdfUrl(competitorId, productId)}
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
      </div>

      {!editing && confirmingRegen && (
        <div className="flex flex-col gap-2 bg-muted/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            This battle card is already up to date
            {staleness?.lastGeneratedAt &&
              ` (generated ${new Date(staleness.lastGeneratedAt).toLocaleDateString("en-US", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })})`}
            . Regenerating now will likely produce similar content.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={onGenerate}>
              Regenerate anyway
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingRegen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Positioning triad on one row — their strengths / our strengths / their
          weaknesses read as a single "where we stand" unit and save vertical space. */}
      <section className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <ListBlock
          title="Their strengths"
          icon={Shield}
          color="text-destructive"
          items={showContent.their_strengths}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, their_strengths: items })}
        />
        <ListBlock
          title="Our strengths"
          icon={ShieldCheck}
          color="text-positive"
          items={showContent.our_strengths}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, our_strengths: items })}
        />
        <ListBlock
          title="Their weaknesses"
          icon={Target}
          color="text-primary"
          items={showContent.their_weaknesses}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, their_weaknesses: items })}
        />
      </section>

      <ObjectionsSection
        items={showContent.common_objections}
        editing={editing}
        onChange={(items) => setDraft({ ...draft, common_objections: items })}
      />

      <section className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:grid-cols-2">
        <ListBlock
          title="When we win"
          icon={CircleCheck}
          color="text-positive"
          items={showContent.when_we_win}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, when_we_win: items })}
        />
        <ListBlock
          title="When we lose"
          icon={CircleX}
          color="text-destructive"
          items={showContent.when_we_lose}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, when_we_lose: items })}
        />
      </section>

      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <p className="text-xs text-muted-foreground">
          Generated{" "}
          {new Date(card.generatedAt).toLocaleDateString("en-US", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
          {!card.pdfR2Key && " · PDF pending"}
        </p>
        {/* Quality feedback (patch-21): "not useful" flags the card for regeneration. */}
        {!editing && <FeedbackButtons targetType="battle_card" targetId={card.id} />}
      </div>
      {paywallNode}
    </TabCard>
  );
}

// Section heading matching the shared TabSection title (sentence case + icon),
// so every block reads like the other competitor tabs — but carrying a semantic
// color (icon + label) so our/their edge reads at a glance. `action` rides on
// the right (e.g. the objections help tooltip).
function Heading({
  icon: Icon,
  color,
  action,
  children,
}: {
  icon: IconType;
  color?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3
        className={cn(
          "flex items-center gap-2 text-content font-semibold tracking-tight leading-tight",
          color,
        )}
      >
        <Icon size={14} className={cn("shrink-0", !color && "text-muted-foreground")} />
        {children}
      </h3>
      {action}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0)
    return <p className="text-content text-muted-foreground">—</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-content leading-relaxed">
          <span className="mt-px shrink-0 text-primary">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function ListBlock({
  title,
  icon,
  color,
  items,
  editing,
  onChange,
}: {
  title: string;
  icon: IconType;
  color?: string;
  items: string[];
  editing: boolean;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Heading icon={icon} color={color}>
        {title}
      </Heading>
      {editing ? (
        <EditableList items={items} onChange={onChange} max={5} />
      ) : (
        <BulletList items={items} />
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
    <section className="flex flex-col gap-3 p-5">
      <Heading
        icon={MessageSquare}
        color="text-primary"
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle size={13} className="text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Objections a prospect might raise to pick this competitor over you —
              each paired with a sales response to counter it.
            </TooltipContent>
          </Tooltip>
        }
      >
        Common objections
      </Heading>
      {editing ? (
        <div className="flex flex-col gap-2">
          {items.map((o, i) => (
            <div
              key={i}
              className="flex flex-col gap-1 rounded-md border border-border p-2"
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
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="h-7 self-start px-2 text-xs"
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
              className="h-7 self-start px-2 text-xs text-primary"
            >
              + Add an objection
            </Button>
          )}
        </div>
      ) : items.length === 0 ? (
        <p className="text-content text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((o, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <p className="text-content font-medium leading-relaxed">
                “{o.objection}”
              </p>
              <p className="border-l border-border pl-3.5 text-content leading-relaxed text-muted-foreground">
                {o.response}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
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
          className="h-7 self-start px-2 text-xs text-primary"
        >
          + Add
        </Button>
      )}
    </div>
  );
}

function SkeletonColumn() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="h-3 w-[90%]" />
      <Skeleton className="h-3 w-[70%]" />
      <Skeleton className="h-3 w-[80%]" />
    </div>
  );
}

function BattleCardSkeleton() {
  return (
    <TabCard>
      <div className="flex items-center justify-end gap-2 px-5 py-4">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="grid grid-cols-1 gap-8 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonColumn />
        <SkeletonColumn />
        <SkeletonColumn />
      </div>
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-12 w-full" />
      </div>
      <div className="grid grid-cols-1 gap-8 p-5 sm:grid-cols-2">
        <SkeletonColumn />
        <SkeletonColumn />
      </div>
    </TabCard>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p className="text-sm p-6 text-center text-muted-foreground border border-dashed border-border rounded-md">
      {text}
    </p>
  );
}
