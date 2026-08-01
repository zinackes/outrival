"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowsClockwiseIcon,
  SpinnerIcon,
  ClockIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  WarningCircleIcon,
  XIcon,
} from "@/components/icons";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { useCompetitorScopeGuard } from "@/hooks/use-competitor-scope-guard";
import {
  api,
  ApiError,
  type BattleCard,
  type BattleCardContent,
  type BattleCardJob,
  type BattleCardPartial,
  type BattleCardStaleness,
} from "@/lib/api";
import { errorConfig, toastApiError, type ErrorConfig } from "@/lib/error-helpers";
import {
  battleCardEvidenceQuery,
  competitorDetailQuery,
  productsListQuery,
} from "@/lib/queries";
import { formatDate } from "@/lib/format-date";
import { disclosureMotion } from "@/lib/motion";
import { track } from "@/lib/posthog/events";
import {
  PaywallDialog,
  paywallFromError,
  tierLimitFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FeedbackButtons } from "@/components/outrival/feedback-buttons";
import { TabCard } from "@/components/outrival/tab-shell";
import { Reveal } from "@/components/outrival/reveal";
import { BattleCardProgress, type BuildStage } from "./build-view";
import { BattleCardEmpty } from "./empty-view";
import { BattleCardHead, MetaDot } from "./head";
import { ConfidenceBadge } from "./evidence";
import { BattleCardSections, flattenCardLines } from "./sections";
import { useWriteIn } from "./write-in";
import { PackagingSection } from "./packaging";
import { TheirCustomersSection } from "./their-customers";
import { TopRequestedSection } from "./top-requested";

const EMPTY_CONTENT: BattleCardContent = {
  their_strengths: [],
  our_strengths: [],
  their_weaknesses: [],
  common_objections: [],
  when_we_win: [],
  when_we_lose: [],
};

type Status = "loading" | "absent" | "ready" | "generating" | "saving" | "error" | "failed";

// A battle-card generation lives only in this component's state — the poll loop and
// the build view die on unmount. Navigating away and back used to show the stale card
// (or the empty state) with no hint a job was still running, because the worker writes
// the row only when it finishes. We drop a durable marker at generation start so a
// remount can resume the build view + polling.
//
// The TTL used to be five minutes, on the assumption that a generation caps around
// three. It does not: the job can sit in the queue unclaimed for far longer (six
// hours, measured on prod 2026-07-29), and a marker that expires while the run is
// still real is how a resume silently turns back into "no card yet". Twenty minutes
// covers a normal queue wait; past that the job state, not the clock, is what says
// whether anything is still coming.
const GEN_MARKER_TTL_MS = 20 * 60 * 1000;

type GenMarker = { prev: string | null; at: number; runId?: string };

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

function writeGenMarker(
  competitorId: string,
  productId: string | undefined,
  prev: string | null,
  runId: string | undefined,
) {
  try {
    localStorage.setItem(
      genMarkerKey(competitorId, productId),
      JSON.stringify({ prev, at: Date.now(), runId } satisfies GenMarker),
    );
  } catch {
    // private mode / quota — the in-session build view still works, just no resume.
  }
}

function clearGenMarker(competitorId: string, productId: string | undefined) {
  try {
    localStorage.removeItem(genMarkerKey(competitorId, productId));
  } catch {
    // ignore
  }
}

const LONG_DATE = { day: "2-digit", month: "long", year: "numeric" } as const;

// Poll ceilings, in 3s ticks. A run we can read gets 20 minutes: a queue wait of
// several minutes is ordinary, and cutting the view off mid-wait is precisely the
// bug. With no run to read, keep the old ~3 minutes — there is nothing to learn by
// waiting longer, so say so sooner.
const MAX_WATCHED_POLLS = 400;
const MAX_BLIND_POLLS = 60;

// The loop ticks fast and does its heavy work every fourth tick, so a 3s cadence is
// preserved for the card row and for every ceiling above — `polls` still counts 3s
// units. The fast lane exists for ONE thing: while the model is actually writing, the
// run is read every tick, because the text it streams arrives in about a second and a
// 3s poll would show it as a single jump rather than as writing.
const TICK_MS = 750;
const TICKS_PER_POLL = 4;

export function BattleCardPage({ competitorId }: { competitorId: string }) {
  // patch-28 — scope the card to the active product (cookie-backed switcher, URL
  // ?product= overrides); omitted = the product this competitor is tracked for
  // (the API resolves it from product_competitors). Send it to the API, never read
  // it as "which product this card is about" — that is `resolvedProductId` below.
  const productId = useProductScope() ?? undefined;
  const queryClient = useQueryClient();

  const [card, setCard] = useState<BattleCard | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  // Why the PAGE couldn't be shown, already turned into user-facing copy. A refused
  // ACTION (rate limit, plan lock) never lands here — it toasts and leaves the page
  // standing, because destroying the card to report a refusal loses more than it says.
  const [error, setError] = useState<ErrorConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BattleCardContent>(EMPTY_CONTENT);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [staleness, setStaleness] = useState<BattleCardStaleness | null>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  // Epoch ms the current generation started — drives the elapsed counter while
  // status === "generating". Seeded from the resume marker so a wait that began
  // before we navigated away shows its true elapsed time. The STAGE no longer comes
  // from it: that is read from the run itself (see `job`).
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null);
  // The live run, polled alongside the card row. Null while we have no run id or the
  // queue could not be read — the build view then claims no stage at all.
  const [job, setJob] = useState<BattleCardJob | null>(null);
  // The same run, readable from inside the poll closure: it decides whether this tick
  // is a fast one (the model is writing) or an ordinary 3s one.
  const jobRef = useRef<BattleCardJob | null>(null);
  // Set when a run gave up, and the ONLY thing standing between the user and the
  // "no card yet" template they used to be dropped back into with no explanation.
  const [failure, setFailure] = useState<string | null>(null);
  // Write the card in only when it lands from a generation we watched, never when
  // reopening one that was already stored. `writeInFinish` flips when the run's PDF
  // lands: the writing is paced against the work still running behind it, so it has
  // to run out the moment that work is done.
  const [writeIn, setWriteIn] = useState(false);
  const [writeInFinish, setWriteInFinish] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const competitorQ = useQuery(competitorDetailQuery(competitorId));
  const competitor = competitorQ.data?.competitor ?? null;
  // A card is written for one (product, competitor) pair. Switching the scope to a
  // product that doesn't track this competitor leaves the page rather than offering
  // to generate a card for a pairing that doesn't exist.
  useCompetitorScopeGuard(competitorId, competitor?.name);
  const productsQ = useQuery(productsListQuery());
  const evidenceQ = useQuery(battleCardEvidenceQuery(competitorId, productId));
  const evidence = evidenceQ.data?.evidence ?? null;

  // The product this card is about, TAKEN FROM THE SERVER: the card's own productId,
  // else the product the API resolved this request to. Re-deriving it here was the
  // bug — in all-products scope there is no productId to send, so the page fell back
  // to the org's primary and titled the page "<primary> vs X" over a card written
  // for the SKU that actually tracks X.
  const resolvedProductId = card?.productId ?? evidenceQ.data?.productId ?? productId ?? null;
  const product = useMemo(() => {
    const list = productsQ.data ?? [];
    return list.find((p) => p.id === resolvedProductId) ?? null;
  }, [productsQ.data, resolvedProductId]);

  // The card body is ONE subtree from the first streamed sentence to the stored card:
  // while the run is live it renders the draft the model is writing, and when the row
  // lands it renders that instead. The handoff is a change of props, not a change of
  // page — which is what removes the cut where the finished card wiped the screen and
  // typed itself a second time from empty.
  const generating = status === "generating";
  const partialContent = useMemo(() => partialToContent(job?.partial ?? null), [job?.partial]);
  const bodyContent = generating
    ? partialContent
    : editing
      ? draft
      : (card?.content ?? EMPTY_CONTENT);
  const lines = useMemo(() => flattenCardLines(bodyContent), [bodyContent]);
  // One cursor for the whole thing, rewound only when a NEW run starts. It is what
  // paces the text: the stream arrives in bursts, the cursor drains them.
  const read = useWriteIn(lines, writeIn && !editing, writeInFinish, genStartedAt);
  // The run is still live — this is what the progress block is, and the only thing
  // that leaves when a generation ends.
  const runInFlight = generating || (writeIn && !writeInFinish);
  // The frames outlive it by the length of the run-out: the writing accelerates when
  // the run ends, it does not teleport, so a section the cursor has not reached yet
  // still has something coming. Dropping its frame with the progress block would empty
  // the page for a second right at the moment it is supposed to settle.
  const lastLine = lines[lines.length - 1] ?? null;
  const stillWriting = lastLine !== null && read(lines.length - 1) !== lastLine;

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
      // While polling, the poll loop owns the status (it keeps the build view up until
      // fresh content lands) — don't pre-empt it here.
      if (!silent) setStatus("ready");
      return res.battleCard;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // A 404 mid-generation just means the row isn't written yet — keep the build
        // view instead of flashing the empty state.
        if (!silent) setStatus("absent");
        return null;
      }
      if (!silent) {
        setError(errorConfig(e));
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
    // Still in flight: show the build view and resume polling against the
    // pre-generation snapshot the marker captured.
    setGenStartedAt(marker.at);
    setStatus("generating");
    setWriteIn(true);
    setWriteInFinish(false);
    startPolling(marker.runId ?? null, marker.prev, loaded?.pdfR2Key ?? null);
  }

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  // The pre-generation snapshot the poll compares against is passed in (not read from
  // `card`) so a resume after remount is deterministic and not tied to stale state.
  // The job writes the card content first (~10-20s of AI) and only then renders +
  // uploads the PDF (slower). Reveal the card the moment new content lands — don't
  // make the user stare at the build view through the extra PDF step — and keep
  // polling silently to enable Download PDF.
  //
  // Each tick reads the RUN as well as the card row. That is what closed the hole
  // this page had: with only the card row to look at, "the job gave up" and "the job
  // has not started" are the same observation — nothing new appeared — so the loop
  // eventually timed out and dropped the user back on the empty template with no
  // message. Prod 2026-07-29: three runs, three silent nothings, three retries.
  function startPolling(
    runId: string | null,
    prevGeneratedAt: string | null = card?.generatedAt ?? null,
    prevR2: string | null = card?.pdfR2Key ?? null,
  ) {
    stopPolling();
    let polls = 0;
    let revealed = false;
    // A run reporting "done" should already have written its row, but the two reads
    // are not atomic. Give it a couple of ticks before calling it an empty finish.
    let doneWithoutCard = 0;

    const giveUp = (reason: string) => {
      stopPolling();
      clearGenMarker(competitorId, productId);
      setWriteIn(false);
      setWriteInFinish(false);
      setFailure(reason);
      setStatus("failed");
    };

    let tick = 0;
    pollRef.current = setInterval(async () => {
      tick += 1;
      const heavy = tick % TICKS_PER_POLL === 0;
      // A fast tick exists only to follow the text being written. Nothing else on
      // this loop runs more often than it did before.
      const writing = jobRef.current?.state === "running";
      if (!heavy && !writing) return;
      if (heavy) polls += 1;

      const [fresh, run] = await Promise.all([
        heavy ? load(true) : Promise.resolve(null),
        runId
          ? api
              .getBattleCardJob(competitorId, runId, productId)
              .then((r) => r.job)
              // A failed status read is not a failed generation — keep watching.
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      if (run) {
        setJob(run);
        jobRef.current = run;
      }
      // Everything below decides whether to reveal, give up or stop. Those are 3s
      // decisions, taken on the same reads as before.
      if (!heavy) return;

      if (fresh && fresh.generatedAt !== prevGeneratedAt) {
        // The stored card takes over from the streamed draft under the SAME cursor:
        // whatever was already on screen stays on screen and the writing continues
        // from there. Nothing is replayed, and nothing is dropped back to empty.
        setStatus("ready");
        revealed = true;
        clearGenMarker(competitorId, productId); // content landed → nothing to resume
        // The card was written from freshly gathered evidence; re-read it so the
        // confidence badge reflects the check that just ran.
        void queryClient.invalidateQueries({
          queryKey: battleCardEvidenceQuery(competitorId, productId).queryKey,
        });
      }
      if (fresh && fresh.pdfR2Key && fresh.pdfR2Key !== prevR2) {
        // The whole run is done. Whatever text is still being written out was paced
        // for this tail, so let it finish now rather than hold the reader to it.
        setWriteInFinish(true);
        stopPolling();
        void refreshStaleness(); // regenerated → should now read "fresh"
        return;
      }
      // Content is up and only the PDF is outstanding. Keep chasing it, but under the
      // same ceiling as everything else: the card is already usable, and a PDF that
      // never lands is a "PDF pending" label, not a reason to poll forever. Giving up
      // on it still ends the run for the page — otherwise the progress block would sit
      // above a finished card claiming to be rendering something.
      if (revealed) {
        if (polls >= MAX_WATCHED_POLLS) {
          setWriteInFinish(true);
          stopPolling();
        }
        return;
      }

      // The run said why it stopped. Say it — this is the whole point of the change.
      if (run?.state === "failed" && run.failure) return giveUp(run.failure);
      if (run?.state === "done") {
        doneWithoutCard += 1;
        if (doneWithoutCard >= 3) {
          return giveUp("The run finished without producing a card. Try generating it again.");
        }
        return;
      }

      // Bounded wait. A run we can SEE (queued or running) gets the long ceiling,
      // because a queue wait of several minutes is normal and cutting the view off
      // mid-wait is the behaviour being fixed. With no run to read, fall back to the
      // old ~3 min and say plainly that we lost track of it — never a silent reset.
      const cap = run ? MAX_WATCHED_POLLS : MAX_BLIND_POLLS;
      if (polls >= cap) {
        if (run?.state === "queued") {
          return giveUp(
            "This card is still queued and has not started. It will run when a worker frees up — reopen this page in a few minutes, or generate it again.",
          );
        }
        return giveUp(
          "We lost track of this generation. It may still finish and land in your notifications; otherwise, try again.",
        );
      }
    }, TICK_MS);
  }

  async function onGenerate() {
    setConfirmingRegen(false);
    setGenStartedAt(Date.now());
    setStatus("generating");
    setError(null);
    setFailure(null);
    setJob(null);
    // The write-in is armed BEFORE the first sentence arrives, not when the row lands:
    // the streamed draft and the stored card are written by the same cursor.
    setWriteIn(true);
    setWriteInFinish(false);
    try {
      const { runId } = await api.generateBattleCard(competitorId, productId);
      track("battle_card_generated", { competitorId });
      // Persist a resume marker BEFORE polling: if the user navigates away mid-
      // generation, the remount reads this and re-shows the build view + poll loop.
      // The run id goes in it too, so the resumed loop watches the same run rather
      // than falling back to guessing from the card row.
      writeGenMarker(competitorId, productId, card?.generatedAt ?? null, runId);
      startPolling(runId ?? null);
    } catch (e) {
      // 403 plan_* feature locks → paywallFromError; the 429 daily-cap quota →
      // tierLimitFromError. Both render the same dialog with quota-aware copy.
      const reason = paywallFromError(e) ?? tierLimitFromError(e);
      if (reason) setPaywall(reason);
      // Anything else — the hourly AI cap, a provider outage, a dropped connection —
      // is a refusal to START, not a page that failed to load. It used to replace the
      // whole page with the raw envelope; the card the user already had is worth more
      // than the error is, so it stays and the reason arrives as a toast.
      else toastApiError(e, { title: "Couldn't generate the card", onRetry: onGenerate });
      setWriteIn(false); // nothing is being written — the progress block must not stay
      setStatus(card ? "ready" : "absent");
    }
  }

  async function onSave() {
    if (!card) return;
    setWriteIn(false); // a save re-renders the sections; it is not a fresh arrival
    setStatus("saving");
    try {
      const res = await api.patchBattleCard(competitorId, draft, productId);
      setCard(res.battleCard);
      setDraft(res.battleCard.content);
      setEditing(false);
      setStatus("ready");
    } catch (e) {
      // Stay in the editor: swapping to the error page discarded the edits the user
      // had just typed, which is a worse outcome than the failed save itself.
      toastApiError(e, { title: "Couldn't save your changes", onRetry: onSave });
      setStatus("ready");
    }
  }

  const competitorName = competitor?.name ?? "this competitor";
  const paywallNode = <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />;

  function head(meta?: React.ReactNode, actions?: React.ReactNode) {
    return (
      <BattleCardHead
        competitorId={competitorId}
        competitor={competitor}
        product={product}
        meta={meta}
        actions={actions}
      />
    );
  }

  if (status === "loading") {
    return (
      <div className="space-y-6">
        {head(<Skeleton className="h-3 w-48" />)}
        <BattleCardSkeleton />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-6">
        {head()}
        <TabCard>
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-start gap-2.5">
              <WarningCircleIcon size={20} className="mt-px shrink-0 text-critical" />
              <div className="flex flex-col gap-1.5">
                <h3 className="text-content font-semibold tracking-tight leading-tight">
                  {error?.title ?? "Couldn't load this card"}
                </h3>
                <p className="max-w-prose text-sm text-muted-foreground">
                  {error?.description ?? "The card didn't load. Try again in a moment."}
                </p>
              </div>
            </div>
            {error?.action?.type !== "wait" && (
              <div>
                <Button size="sm" onClick={() => void load()}>
                  <ArrowsClockwiseIcon size={16} /> {error?.action?.label ?? "Try again"}
                </Button>
              </div>
            )}
          </div>
        </TabCard>
      </div>
    );
  }

  if (status === "absent") {
    return (
      <div className="space-y-6">
        {head(<span>Battle card</span>)}
        <BattleCardEmpty
          competitorId={competitorId}
          competitorName={competitorName}
          evidence={evidence}
          onGenerate={onGenerate}
        />
        {paywallNode}
      </div>
    );
  }

  // A run that gave up. It used to land the user back on the "no card yet" template
  // with nothing said, so the only available move was to click Generate again — which
  // is exactly what happened three times in a row on prod. The reason now comes from
  // the run itself, and the previous card (if any) is still one click away.
  if (status === "failed") {
    return (
      <div className="space-y-6">
        {head(
          <>
            <span>Battle card</span>
            <MetaDot />
            <span className="text-critical">generation stopped</span>
          </>,
        )}
        <TabCard>
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-start gap-2.5">
              <WarningCircleIcon size={20} className="mt-px shrink-0 text-critical" />
              <div className="flex flex-col gap-1.5">
                <h3 className="text-content font-semibold tracking-tight leading-tight">
                  This card was not generated
                </h3>
                <p className="max-w-prose text-sm text-muted-foreground">
                  {failure ?? "The generation stopped before it produced a card."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onGenerate}>
                <ArrowsClockwiseIcon size={16} /> Try again
              </Button>
              {card && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFailure(null);
                    setStatus("ready");
                  }}
                >
                  Keep the previous card
                </Button>
              )}
            </div>
          </div>
        </TabCard>
        {paywallNode}
      </div>
    );
  }

  // A generation with no card yet still renders the card's own frame — that is the
  // point of the merge. Only "no card and nothing running" has nothing to show.
  if (!card && !generating) return null;

  const showContent = bodyContent;
  const canDownload = !editing && !generating && Boolean(card?.pdfR2Key);
  const since = staleness?.since ?? null;
  const showStale =
    !generating && Boolean(staleness?.needsRegeneration && since && since.total > 0);

  const meta = generating ? (
    <>
      <span>Battle card</span>
      <MetaDot />
      <span>{job?.state === "queued" ? "queued" : "writing it now"}</span>
    </>
  ) : !card ? null : editing ? (
    <>
      <span>Battle card</span>
      <MetaDot />
      <span>editing, up to five lines per section</span>
    </>
  ) : (
    <>
      <span>Battle card</span>
      <MetaDot />
      <span className={staleness?.needsRegeneration ? "text-high" : undefined}>
        generated {formatDate(card.generatedAt, LONG_DATE)}
      </span>
      {!card.pdfR2Key && (
        <>
          <MetaDot />
          <span>PDF pending</span>
        </>
      )}
      {evidence && (
        <>
          <MetaDot />
          <ConfidenceBadge evidence={evidence} competitorId={competitorId} />
        </>
      )}
    </>
  );

  const actions = generating ? (
    <Button size="sm" disabled>
      <DownloadSimpleIcon size={16} /> Download PDF
    </Button>
  ) : !card ? null : editing ? (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setDraft(card.content);
          setEditing(false);
        }}
      >
        <XIcon size={16} /> Cancel
      </Button>
      <Button size="sm" disabled={status === "saving"} onClick={onSave}>
        {status === "saving" ? (
          <SpinnerIcon size={16} className="animate-spin" />
        ) : (
          <FloppyDiskIcon size={16} />
        )}
        {status === "saving" ? "Saving…" : "Save"}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setWriteIn(false);
          setEditing(true);
        }}
      >
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
              <ArrowsClockwiseIcon size={16} /> Regenerate · up to date
            </Button>
          </TooltipTrigger>
          <TooltipContent>No changes since the last generation.</TooltipContent>
        </Tooltip>
      ) : (
        <Button size="sm" onClick={onGenerate}>
          <ArrowsClockwiseIcon size={16} /> Regenerate
        </Button>
      )}
      <Button asChild={canDownload} variant="outline" size="sm" disabled={!canDownload}>
        {canDownload ? (
          <a
            href={api.battleCardPdfUrl(competitorId, productId)}
            target="_blank"
            rel="noreferrer"
          >
            <DownloadSimpleIcon size={16} /> Download PDF
          </a>
        ) : (
          <span>
            <DownloadSimpleIcon size={16} /> Download PDF
          </span>
        )}
      </Button>
    </>
  );

  // Eases the card in behind the loading skeleton on a plain open. No `token`: the
  // only thing that used to change it under our feet was a generation landing, and a
  // generation is now WRITTEN into this same subtree — replaying the entrance on top
  // of that is precisely the cut being removed.
  return (
    <div className="space-y-6">
      {head(meta, actions)}
      <Reveal>
        <TabCard>
          {/* The run's own block, and the only thing that leaves when the run ends:
              the card underneath is the same subtree from the first streamed sentence
              onward, so finishing collapses this away instead of swapping the page. */}
          <AnimatePresence initial={false}>
            {runInFlight && (
              <motion.div key="run" {...disclosureMotion}>
                <BattleCardProgress
                  startedAt={genStartedAt ?? Date.now()}
                  firstTime={!card}
                  evidence={evidence}
                  competitorName={competitorName}
                  stage={buildStage(job)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Staleness is stated where the card starts, and it names what moved:
              "Regenerate" alone asks the user to spend a daily card on faith. */}
          {!editing && showStale && since && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 bg-high/[0.06] px-5 py-3 text-sm">
              <ClockIcon size={16} className="shrink-0 text-high" />
              <span>
                <span className="font-medium">
                  {since.total} signal{since.total === 1 ? "" : "s"} on {competitorName}
                </span>{" "}
                since this card was generated.
              </span>
              <span className="text-meta text-muted-foreground tabular-nums">
                {since.byCategory
                  .slice(0, 4)
                  .map((c) => `${c.count} ${c.category}`)
                  .join(" · ")}
              </span>
              <Link
                href={`/dashboard/signals?competitor=${competitorId}`}
                className="text-dense text-link hover:underline"
              >
                See them
              </Link>
            </div>
          )}

          {!editing && !generating && confirmingRegen && (
            <div className="flex flex-col gap-2 bg-surface-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                This battle card is already up to date
                {staleness?.lastGeneratedAt &&
                  ` (generated ${formatDate(staleness.lastGeneratedAt, LONG_DATE)})`}
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

          <BattleCardSections
            content={showContent}
            editing={editing}
            draft={draft}
            setDraft={setDraft}
            read={read}
            pending={runInFlight || (writeIn && stillWriting)}
          />

          {/* Packaging (P2): deterministic lines from the captured entitlement
              matrix — hidden while editing (nothing here is editable) and
              absent entirely when no matrix was ever captured. Takes the RESOLVED
              product, not the scope: its "we ship it too" line reads the self
              profile, and in all-products scope the scope is empty, so it was
              answering with the org's default SKU on a card about another one. */}
          {!editing && card && competitor && (
            <PackagingSection
              competitorId={competitorId}
              competitorName={competitor.name}
              productId={resolvedProductId ?? undefined}
            />
          )}

          {/* Their customers (P3): deterministic lines from their published case
              studies and the customer registry. Hidden while editing (nothing here
              is editable) and absent entirely when we hold no customer proof. No
              product scope: who a competitor sells to is a fact about them, not
              about which of our SKUs the card compares. */}
          {!editing && card && competitor && (
            <TheirCustomersSection
              competitorId={competitorId}
              competitorName={competitor.name}
            />
          )}

          {/* Top requested, not delivered (P5): their own customers voting in
              public on what the product still does not do, plus how much of the
              roadmap we have WATCHED them ship. Deterministic like the section
              above, hidden while editing, and absent entirely when they publish no
              portal — an empty frame would state nothing. */}
          {!editing && card && competitor && (
            <TopRequestedSection competitorId={competitorId} />
          )}

          {card && (
            <div className="flex items-center justify-between gap-3 px-5 py-3.5">
              <p className="text-dense text-muted-foreground">
                Edits you make here survive the next regeneration.
              </p>
              {/* Quality feedback (patch-21): "not useful" flags the card for
                  regeneration. autoHydrate — a single card, so it self-fetches the
                  existing verdict on mount. */}
              {!editing && (
                <FeedbackButtons targetType="battle_card" targetId={card.id} autoHydrate />
              )}
            </div>
          )}
        </TabCard>
      </Reveal>
      {paywallNode}
    </div>
  );
}

/**
 * The card as the model has written it so far, in the shape the card renders — so the
 * streamed draft and the stored row are the same kind of value and the body never has
 * to switch renderers.
 *
 * The sentence still being typed is appended to its own section, so a provider that
 * takes seconds over one long line still shows it arriving. Objections are excluded
 * from that: they render as a pair, and half a pair has no answer to sit under.
 */
function partialToContent(partial: BattleCardPartial | null): BattleCardContent {
  const c = partial?.content ?? {};
  const content: BattleCardContent = {
    their_strengths: c.their_strengths ?? [],
    our_strengths: c.our_strengths ?? [],
    their_weaknesses: c.their_weaknesses ?? [],
    common_objections: c.common_objections ?? [],
    when_we_win: c.when_we_win ?? [],
    when_we_lose: c.when_we_lose ?? [],
  };
  const key = partial?.typingKey;
  if (partial?.typing && key && key !== "common_objections") {
    content[key] = [...content[key], partial.typing];
  }
  return content;
}

/** The stage the build view should show. Null while we have no run to read — the
 *  view then says it is working and names no stage, rather than inventing one. */
function buildStage(job: BattleCardJob | null): BuildStage | null {
  if (!job) return null;
  if (job.state === "queued") return "queued";
  if (job.stage === "gathering" || job.stage === "checking" || job.stage === "rendering") {
    return job.stage;
  }
  return "gathering";
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
