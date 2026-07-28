"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import {
  CheckCircleIcon,
  XCircleIcon,
  DownloadSimpleIcon,
  QuestionIcon,
  CircleNotchIcon,
  ChatIcon,
  ArrowsClockwiseIcon,
  FloppyDiskIcon,
  ShieldIcon,
  ShieldCheckIcon,
  SparkleIcon,
  SwordIcon,
  TargetIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  api,
  type BattleCard,
  type BattleCardContent,
  type BattleCardEvidence,
  type BattleCardEvidenceKind,
} from "@/lib/api";
import { formatDate } from "@/lib/format-date";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedbackButtons } from "@/components/outrival/feedback-buttons";
import { TabCard } from "@/components/outrival/tab-shell";
import { Reveal } from "@/components/outrival/reveal";
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

// A battle-card generation lives only in this component's state — the poll loop and
// the "generating" spinner die on unmount. Navigating away and back used to show the
// stale card (or the empty "Generate" state) with no hint a job was still running,
// because the worker writes the row only when it finishes. We drop a durable marker
// at generation start so a remount can resume the spinner + polling.
const GEN_MARKER_TTL_MS = 5 * 60 * 1000; // generation caps ~3 min; a little slack

type GenMarker = { prev: string | null; at: number };

function genMarkerKey(competitorId: string, productId: string | undefined) {
  return `outrival.bc-generating.${competitorId}.${productId ?? "default"}`;
}

function readGenMarker(competitorId: string, productId: string | undefined): GenMarker | null {
  try {
    const raw = localStorage.getItem(genMarkerKey(competitorId, productId));
    if (!raw) return null;
    const m = JSON.parse(raw) as GenMarker;
    return typeof m?.at === "number" ? m : null;
  } catch {
    return null;
  }
}

function writeGenMarker(competitorId: string, productId: string | undefined, prev: string | null) {
  try {
    localStorage.setItem(
      genMarkerKey(competitorId, productId),
      JSON.stringify({ prev, at: Date.now() } satisfies GenMarker),
    );
  } catch {
    // private mode / quota — the in-session spinner still works, just no resume.
  }
}

function clearGenMarker(competitorId: string, productId: string | undefined) {
  try {
    localStorage.removeItem(genMarkerKey(competitorId, productId));
  } catch {
    // ignore
  }
}

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
  const [evidence, setEvidence] = useState<BattleCardEvidence | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BattleCardContent>(EMPTY_CONTENT);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [staleness, setStaleness] = useState<Staleness>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  // Epoch ms the current generation started — drives the elapsed counter + staged
  // progress while status === "generating". Seeded from the resume marker so a wait
  // that began before we navigated away shows its true elapsed time.
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null);
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
      setEvidence(res.evidence ?? null);
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
      resumeGeneration(loaded);
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [competitorId, productId]);

  // On remount, pick up a generation started before we navigated away.
  function resumeGeneration(loaded: BattleCard | null) {
    const marker = readGenMarker(competitorId, productId);
    if (!marker) return;
    if (Date.now() - marker.at > GEN_MARKER_TTL_MS) {
      clearGenMarker(competitorId, productId); // stale — assume the job is long done
      return;
    }
    // The job already produced a fresh card while we were away → nothing to resume.
    if (loaded && loaded.generatedAt !== marker.prev) {
      clearGenMarker(competitorId, productId);
      return;
    }
    // Still in flight: show the spinner (matches the in-place regenerate UX) and
    // resume polling against the pre-generation snapshot the marker captured.
    setGenStartedAt(marker.at);
    setStatus("generating");
    startPolling(marker.prev, loaded?.pdfR2Key ?? null);
  }

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  // The pre-generation snapshot the poll compares against is passed in (not read from
  // `card`) so a resume after remount is deterministic and not tied to stale state.
  // The job writes the card content first (~10-20s of AI) and only then renders +
  // uploads the PDF (slower). Reveal the card the moment new content lands — don't
  // make the user stare at a spinner through the extra PDF step — and keep polling
  // silently to enable DownloadSimpleIcon.
  function startPolling(
    prevGeneratedAt: string | null = card?.generatedAt ?? null,
    prevR2: string | null = card?.pdfR2Key ?? null,
  ) {
    stopPolling();
    let polls = 0;
    let revealed = false;
    pollRef.current = setInterval(async () => {
      polls += 1;
      const fresh = await load(true);
      if (fresh && fresh.generatedAt !== prevGeneratedAt) {
        setStatus("ready");
        revealed = true;
        clearGenMarker(competitorId, productId); // content landed → nothing to resume
      }
      if (fresh && fresh.pdfR2Key && fresh.pdfR2Key !== prevR2) {
        stopPolling();
        void refreshStaleness(); // regenerated → should now read "fresh"
        return;
      }
      // Safety net: a failed/stuck job must not spin forever (~3 min cap).
      if (polls >= 60) {
        stopPolling();
        clearGenMarker(competitorId, productId);
        if (!revealed) setStatus(card ? "ready" : "absent");
      }
    }, 3000);
  }

  async function onGenerate() {
    setConfirmingRegen(false);
    setGenStartedAt(Date.now());
    setStatus("generating");
    setError(null);
    try {
      await api.generateBattleCard(competitorId, productId);
      track("battle_card_generated", { competitorId });
      // Persist a resume marker BEFORE polling: if the user navigates away mid-
      // generation, the remount reads this and re-shows the spinner + poll loop.
      writeGenMarker(competitorId, productId, card?.generatedAt ?? null);
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
          icon={SparkleIcon}
          title="No battle card for this competitor yet"
          description="Generate one with AI in a few seconds."
          actions={
            <Button size="sm" onClick={onGenerate}>
              <SparkleIcon size={12} /> Generate battle card
            </Button>
          }
        />
        {paywallNode}
      </>
    );
  }

  if (status === "generating") {
    return <GeneratingState startedAt={genStartedAt ?? Date.now()} firstTime={!card} />;
  }

  if (!card) return null;
  const showContent = editing ? draft : card.content;
  const canDownload = !editing && Boolean(card.pdfR2Key);

  // Ease the card in when it lands — a fresh generation swaps the spinner for this
  // subtree (a hard pop otherwise), and even a plain open reveals it behind the
  // skeleton. `token` replays it should a newer card land while we stay on the tab.
  return (
    <Reveal token={card.generatedAt}>
    <TabCard>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="flex items-center gap-2 text-content font-semibold tracking-tight leading-tight">
            <SwordIcon size={14} className="text-muted-foreground shrink-0" />
            Battle card
          </h2>
          {!editing && evidence && <BattleCardProvenance evidence={evidence} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              <XIcon size={12} /> Cancel
            </Button>
            <Button size="sm" disabled={status === "saving"} onClick={onSave}>
              {status === "saving" ? (
                <CircleNotchIcon size={12} className="animate-spin" />
              ) : (
                <FloppyDiskIcon size={12} />
              )}
              {status === "saving" ? "Saving…" : "FloppyDiskIcon"}
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
                    <ArrowsClockwiseIcon size={12} /> Regenerate · up to date
                  </Button>
                </TooltipTrigger>
                <TooltipContent>No changes since the last generation.</TooltipContent>
              </Tooltip>
            ) : (
              <Button size="sm" onClick={onGenerate}>
                <ArrowsClockwiseIcon size={12} /> Regenerate
              </Button>
            )}
            <Button asChild={canDownload} size="sm" disabled={!canDownload}>
              {canDownload ? (
                <a
                  href={api.battleCardPdfUrl(competitorId, productId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <DownloadSimpleIcon size={12} /> DownloadSimpleIcon PDF
                </a>
              ) : (
                <span className="opacity-50">
                  <DownloadSimpleIcon size={12} /> DownloadSimpleIcon PDF
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
              ` (generated ${formatDate(staleness.lastGeneratedAt, {
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
          icon={ShieldIcon}
          color="text-destructive"
          items={showContent.their_strengths}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, their_strengths: items })}
        />
        <ListBlock
          title="Our strengths"
          icon={ShieldCheckIcon}
          color="text-positive"
          items={showContent.our_strengths}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, our_strengths: items })}
        />
        <ListBlock
          title="Their weaknesses"
          icon={TargetIcon}
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
          icon={CheckCircleIcon}
          color="text-positive"
          items={showContent.when_we_win}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, when_we_win: items })}
        />
        <ListBlock
          title="When we lose"
          icon={XCircleIcon}
          color="text-destructive"
          items={showContent.when_we_lose}
          editing={editing}
          onChange={(items) => setDraft({ ...draft, when_we_lose: items })}
        />
      </section>

      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <p className="text-xs text-muted-foreground">
          Generated{" "}
          {formatDate(card.generatedAt, {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
          {!card.pdfR2Key && " · PDF pending"}
        </p>
        {/* Quality feedback (patch-21): "not useful" flags the card for regeneration.
            autoHydrate — a single card, so it self-fetches the existing verdict on
            mount rather than threading it through the battle-card payload. */}
        {!editing && (
          <FeedbackButtons targetType="battle_card" targetId={card.id} autoHydrate />
        )}
      </div>
      {paywallNode}
    </TabCard>
    </Reveal>
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

// Phase 2B — provenance/freshness: a compact confidence pill in the header that
// opens a popover breaking down which evidence sources backed the card and how
// fresh each is. Makes the card auditable (Klue/IndustryLens model) rather than a
// summary taken on faith — without spending a full-width strip on it.
const EVIDENCE_LABELS: Record<BattleCardEvidenceKind, string> = {
  pricing: "Pricing",
  reviews: "Reviews",
  techStack: "Tech stack",
  homepage: "Homepage",
};

function BattleCardProvenance({ evidence }: { evidence: BattleCardEvidence }) {
  const confColor =
    evidence.confidence === "high"
      ? "text-positive"
      : evidence.confidence === "medium"
        ? "text-primary"
        : evidence.confidence === "low"
          ? "text-destructive"
          : "text-muted-foreground";
  const label = evidence.confidence
    ? `Confidence: ${evidence.confidence}`
    : "Confidence: not scored";
  const verifiedCount = evidence.sources.filter((s) => s.present).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ShieldCheckIcon size={12} className={cn("shrink-0", confColor)} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-2.5 text-dense">
          <ShieldCheckIcon size={13} className={cn("shrink-0", confColor)} />
          <span className="font-medium">{label}</span>
          <span className="ml-auto text-meta text-muted-foreground tabular-nums">
            {verifiedCount}/{evidence.sources.length} sources
          </span>
        </div>
        <ul className="flex flex-col px-3.5 py-2 text-dense">
          {evidence.sources.map((s) => (
            <li key={s.kind} className="flex items-center gap-2 py-1">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  s.present ? "bg-positive" : "bg-muted-foreground/40",
                )}
              />
              <span className="text-foreground">{EVIDENCE_LABELS[s.kind]}</span>
              <span className="ml-auto text-muted-foreground">
                {s.present && s.lastVerifiedAt
                  ? `verified ${formatDate(s.lastVerifiedAt, { day: "2-digit", month: "short" })}`
                  : "not tracked"}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0)
    return (
      <p className="text-content text-muted-foreground">Not enough verified data yet.</p>
    );
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
        icon={ChatIcon}
        color="text-primary"
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <QuestionIcon size={13} className="text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Objections a prospect might raise to pick this competitor over you,
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
        <p className="text-content text-muted-foreground">Not enough verified data yet.</p>
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
                <XIcon size={12} />
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

// Staged wait for a generation in flight. The job has no DB-written progress (poll
// reveals the card the instant real content lands — see startPolling), so the steps
// are paced off elapsed time purely to fill the wait: they never claim "done" before
// the real card swaps in. First-time cards are far slower — they build the AI summary
// first (a serialized sub-job) on top of a cold Trigger machine — so the estimate
// stretches when there's no existing card, and a reassurance line explains the wait.
function GeneratingState({ startedAt, firstTime }: { startedAt: number; firstTime: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  const steps = firstTime
    ? [
        { label: "Gathering evidence", until: 10 },
        { label: "Analyzing the competitor", until: 28 },
        { label: "Writing the battle card", until: 50 },
        { label: "Rendering the PDF", until: Infinity },
      ]
    : [
        { label: "Gathering evidence", until: 4 },
        { label: "Analyzing the competitor", until: 10 },
        { label: "Writing the battle card", until: 20 },
        { label: "Rendering the PDF", until: Infinity },
      ];
  // Rest on the last "still working" step once past every estimate — never mark the
  // final step done here; the real card landing is what ends this view.
  const activeIndex = steps.findIndex((s) => elapsed < s.until);
  const active = activeIndex === -1 ? steps.length - 1 : activeIndex;
  const slow = elapsed > (firstTime ? 60 : 30);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SparkleIcon size={14} className="shrink-0 text-primary" />
          <span className="text-content font-medium">Generating battle card</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{elapsed}s</span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {steps.map((s, i) => {
          const done = i < active;
          const isActive = i === active;
          return (
            <li key={s.label} className="flex items-center gap-2.5 text-sm">
              <span className="flex w-4 shrink-0 justify-center">
                {done ? (
                  <CheckCircleIcon size={15} className="text-positive" />
                ) : isActive ? (
                  <CircleNotchIcon size={15} className="animate-spin text-primary" />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                )}
              </span>
              <span className={cn(isActive ? "text-foreground" : "text-muted-foreground")}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-sm text-muted-foreground">
        {slow
          ? "Still working. This one's taking a little longer than usual. You can leave this page; we'll drop a notification in the bell when it's ready."
          : firstTime
            ? "The first card for a competitor takes longer because it builds the AI summary first. You can safely leave this page and we'll notify you."
            : "You can leave this page and we'll notify you in the bell when it's ready."}
      </p>
    </Card>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p className="text-sm p-6 text-center text-muted-foreground border border-dashed border-border rounded-md">
      {text}
    </p>
  );
}
