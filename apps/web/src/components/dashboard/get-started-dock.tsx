"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CircleIcon, LockIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  api,
  type Competitor,
  type GetStartedMilestone,
  type OnboardingChecklist,
} from "@/lib/api";
import { competitorsQuery, onboardingChecklistQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ASK_OPEN_EVENT } from "./ask-dock";
import { useProductScope } from "./product-scope-provider";

/** Expands the dock from anywhere: the analysis-complete moment, the user menu, ⌘K. */
export const GET_STARTED_OPEN_EVENT = "outrival-get-started-open";

const PANEL_ID = "get-started-panel";

// Milestones the dock observes itself (a page visit, a dismiss). Each one also
// goes to the API, which keeps it in the user's onboarding session when they have
// one; an invited teammate has no session, so this copy is always read too.
const LOCAL_KEY = "outrival.getStarted";
type Milestones = Partial<Record<GetStartedMilestone, number>>;

function readLocal(): Milestones {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as Milestones) : {};
  } catch {
    return {};
  }
}

function writeLocal(m: Milestones) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

// The loop the dock narrates. Every step resolves from what the user actually
// did (a row exists, a page was opened), never from a checkbox they tick.
type Move = "Watch" | "Ask" | "Brief" | "Decide";
const MOVES: Move[] = ["Watch", "Ask", "Brief", "Decide"];

interface Step {
  key: string;
  move: Move;
  title: string;
  why: string;
  minutes: number;
  done: boolean;
  /** Deep link. Absent when the step opens something in place (the Ask sheet). */
  href?: string;
  /** Waits on the first signal: shown under the list, not as a todo. */
  locked?: boolean;
}

function deriveSteps(
  f: OnboardingChecklist,
  m: Milestones,
  top: { id: string; name: string } | null,
): Step[] {
  const n = f.competitorCount;
  return [
    {
      key: "watch",
      move: "Watch",
      title:
        n > 0 ? `${n} competitor${n === 1 ? "" : "s"} under watch` : "Add your first competitor",
      why: "Their pricing, product and hiring pages are scanned on your cadence.",
      minutes: 1,
      done: n > 0,
      href: "/dashboard/competitors",
    },
    {
      key: "landscape",
      move: "Watch",
      title: "See where you stand today",
      why: "The baseline every later signal is measured against.",
      minutes: 1,
      done: Boolean(m.landscape_seen),
      href: top ? `/dashboard/competitors/${top.id}` : "/dashboard/competitors",
    },
    {
      key: "ask",
      move: "Ask",
      title: top ? `Ask one question about ${top.name}` : "Ask one question about a competitor",
      why: "Answered from your tracked data, with citations.",
      minutes: 2,
      done: f.askedByMe,
    },
    {
      key: "cadence",
      move: "Brief",
      title: "Choose your briefing cadence and channel",
      why: "Outrival comes to you, so you can stop checking.",
      minutes: 1,
      done: f.channelConfigured || Boolean(m.cadence_seen),
      href: "/dashboard/settings/notifications",
    },
    {
      key: "battle_card",
      move: "Brief",
      title: "Generate a battle card",
      why: "A one-page brief your sales team can hand around.",
      minutes: 3,
      // Cards are generated per competitor: send the user to the richest one's
      // card, not to the index that only lists what already exists.
      href: top ? `/dashboard/competitors/${top.id}/battle-card` : "/dashboard/battle-cards",
      done: f.hasBattleCard,
    },
    {
      key: "decide",
      move: "Decide",
      title: "Open your first signal",
      why: "What changed, why it matters, and what to do about it.",
      minutes: 2,
      done: f.hasReadSignal,
      locked: f.signalCount === 0 && !f.hasReadSignal,
      href: "/dashboard/signals",
    },
  ];
}

// The horizon is the next scan, never a signal ETA: a scan that finds nothing is
// the common case, and a promised signal that never lands reads as broken.
function horizon(nextScanAt: string | null): string | null {
  if (!nextScanAt) return null;
  const ms = new Date(nextScanAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Next scan is due now.";
  const hours = ms / 3_600_000;
  if (hours < 1) return "Next scan in under an hour.";
  const h = Math.round(hours);
  return `Next scan in about ${h} hour${h === 1 ? "" : "s"}.`;
}

// The competitor every deep link points at: the one we hold the most on today, so
// the page it opens is full rather than empty. Signals collected over the last two
// windows are the proxy for that; overlap only breaks a tie between silent ones.
function dataScore(c: Competitor): number {
  const s = c.stats;
  return (s?.signals7d ?? 0) + (s?.signalsPrev ?? 0);
}

function topCompetitor(list: Competitor[] | undefined): { id: string; name: string } | null {
  let best: Competitor | null = null;
  for (const c of list ?? []) {
    if (!best) {
      best = c;
      continue;
    }
    const d = dataScore(c) - dataScore(best);
    if (d > 0 || (d === 0 && (c.overlapScore ?? -1) > (best.overlapScore ?? -1))) best = c;
  }
  return best ? { id: best.id, name: best.name } : null;
}

function Ring({ value }: { value: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-track" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value / 100)}
        className="stroke-link transition-[stroke-dashoffset]"
      />
    </svg>
  );
}

function StepRow({ step, onAsk }: { step: Step; onAsk: () => void }) {
  const body = (
    <>
      {step.done ? (
        <CheckIcon size={16} className="mt-px shrink-0 text-link" aria-hidden />
      ) : step.locked ? (
        <LockIcon size={16} className="mt-px shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <CircleIcon size={16} className="mt-px shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-dense",
            step.done && "text-muted-foreground line-through",
            step.locked && "text-muted-foreground",
          )}
        >
          {step.title}
        </span>
        {!step.done && <span className="block text-meta text-muted-foreground">{step.why}</span>}
      </span>
      {!step.done && (
        <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
          {step.minutes} min
        </span>
      )}
    </>
  );
  const cls = "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left";
  // A done step keeps its destination: the dock is also how you find these pages
  // again. Only a locked one is inert, since there is nothing there yet.
  if (step.locked) return <li className={cls}>{body}</li>;
  if (step.href) {
    return (
      <li>
        <Link href={step.href} className={cn(cls, "transition-colors hover:bg-muted")}>
          {body}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={onAsk} className={cn(cls, "transition-colors hover:bg-muted")}>
        {body}
      </button>
    </li>
  );
}

// Bottom-right, on every dashboard page: a flat bordered pill (not the shadowed
// bubble this product rejects) that opens into the loop of moves. It collapses
// on every navigation, so it never sits on the page it just sent the user to.
export function GetStartedDock() {
  const pathname = usePathname();
  const qc = useQueryClient();
  const scope = useProductScope();
  const checklistQ = useQuery({
    ...onboardingChecklistQuery(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const competitorsQ = useQuery(competitorsQuery(scope ?? undefined));
  const [expanded, setExpanded] = React.useState(false);
  // Null until the local copy is read, so nothing paints before the effect.
  const [local, setLocal] = React.useState<Milestones | null>(null);

  React.useEffect(() => setLocal(readLocal()), []);

  const milestones = React.useMemo<Milestones>(
    () => ({ ...local, ...checklistQ.data?.milestones }),
    [local, checklistQ.data],
  );
  const milestonesRef = React.useRef(milestones);
  milestonesRef.current = milestones;

  const stamp = React.useCallback(
    (key: GetStartedMilestone, clear = false) => {
      const next = { ...readLocal() };
      if (clear) delete next[key];
      else next[key] = Date.now();
      writeLocal(next);
      setLocal(next);
      qc.setQueryData<OnboardingChecklist>(onboardingChecklistQuery().queryKey, (d) => {
        if (!d) return d;
        const m = { ...d.milestones };
        if (clear) delete m[key];
        else m[key] = next[key];
        return { ...d, milestones: m };
      });
      void api.stampGetStartedMilestone(key, clear).catch(() => {});
    },
    [qc],
  );

  // Collapse on every navigation, and refresh the facts: the step the user just
  // went to do may now be done.
  const firstPath = React.useRef(true);
  React.useEffect(() => {
    setExpanded(false);
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    if (milestonesRef.current.dismissed) return;
    void qc.invalidateQueries({ queryKey: onboardingChecklistQuery().queryKey });
  }, [pathname, qc]);

  // Visit milestones: opening a competitor page is "seeing where you stand",
  // opening the notifications settings is "choosing a cadence".
  React.useEffect(() => {
    if (local === null) return;
    if (/^\/dashboard\/competitors\/[^/]+/.test(pathname) && !milestones.landscape_seen) {
      stamp("landscape_seen");
    } else if (pathname === "/dashboard/settings/notifications" && !milestones.cadence_seen) {
      stamp("cadence_seen");
    }
  }, [pathname, local, milestones, stamp]);

  React.useEffect(() => {
    function onOpen() {
      if (milestonesRef.current.dismissed) stamp("dismissed", true);
      void qc.invalidateQueries({ queryKey: onboardingChecklistQuery().queryKey });
      setExpanded(true);
    }
    document.addEventListener(GET_STARTED_OPEN_EVENT, onOpen);
    return () => document.removeEventListener(GET_STARTED_OPEN_EVENT, onOpen);
  }, [qc, stamp]);

  React.useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (local === null || !checklistQ.data || milestones.dismissed) return null;

  const top = topCompetitor(competitorsQ.data);
  const steps = deriveSteps(checklistQ.data, milestones, top);
  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const locked = steps.filter((s) => s.locked);
  const nextScan = horizon(checklistQ.data.nextScanAt);

  const corner = "fixed bottom-4 right-4 z-40";

  // Done: one closing beat with the next thing worth doing, then gone for good.
  if (doneCount === steps.length) {
    return (
      <div
        className={cn(
          corner,
          "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card pl-3 pr-1 text-dense",
        )}
      >
        <CheckIcon size={16} className="text-link" aria-hidden />
        <span className="font-medium">All set.</span>
        <Link
          href="/dashboard/settings/members"
          onClick={() => stamp("dismissed")}
          className="text-link hover:underline"
        >
          Invite a teammate
        </Link>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close"
          onClick={() => stamp("dismissed")}
        >
          <XIcon size={16} />
        </Button>
      </div>
    );
  }

  function openAsk() {
    setExpanded(false);
    const question = top
      ? `What does ${top.name} do differently from us?`
      : "What changed across my competitors this week?";
    document.dispatchEvent(new CustomEvent(ASK_OPEN_EVENT, { detail: { question } }));
  }

  if (!expanded) {
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-controls={PANEL_ID}
        // Re-read the facts on open. Steps done without a navigation — asking in
        // the sheet, opening a signal in the feed — land on this fetch, not on
        // the pathname effect that never fires for them.
        onClick={() => {
          void qc.invalidateQueries({ queryKey: onboardingChecklistQuery().queryKey });
          setExpanded(true);
        }}
        className={cn(
          corner,
          "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-dense font-medium transition-colors hover:bg-muted",
        )}
      >
        <Ring value={pct} />
        Get started
        <span className="text-muted-foreground tabular-nums">
          {doneCount}/{steps.length}
        </span>
      </button>
    );
  }

  return (
    <section
      id={PANEL_ID}
      aria-label="Get started"
      className={cn(
        corner,
        "w-[340px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card shadow-e2",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
      )}
    >
      <div className="border-b border-border px-4 pb-3 pt-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Get started</h2>
          <span className="text-meta text-muted-foreground tabular-nums">
            {doneCount} of {steps.length}
          </span>
        </div>
        <Progress value={pct} aria-label="Get started progress" className="mt-2 h-1.5" />
      </div>

      <ol className="px-2 py-1">
        {MOVES.map((move) => {
          const rows = steps.filter((s) => s.move === move && !s.locked);
          if (rows.length === 0) return null;
          return (
            <li key={move}>
              <div className="px-2 pb-0.5 pt-2 text-meta font-medium text-muted-foreground">
                {move}
              </div>
              <ol>
                {rows.map((s) => (
                  <StepRow key={s.key} step={s} onAsk={openAsk} />
                ))}
              </ol>
            </li>
          );
        })}
      </ol>

      {locked.length > 0 && (
        <div className="border-t border-border px-2 pb-2 pt-1">
          <div className="px-2 pb-0.5 pt-2 text-meta font-medium text-muted-foreground">
            When your first signal lands
          </div>
          <ol>
            {locked.map((s) => (
              <StepRow key={s.key} step={s} onAsk={openAsk} />
            ))}
          </ol>
          {nextScan && (
            <p className="px-2 pt-1 text-meta text-muted-foreground tabular-nums">{nextScan}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border py-2 pl-4 pr-2">
        <span className="text-meta text-muted-foreground">Reopen it from your profile menu.</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => setExpanded(false)}>
            Hide
          </Button>
          <Button variant="ghost" size="xs" onClick={() => stamp("dismissed")}>
            Dismiss
          </Button>
        </div>
      </div>
    </section>
  );
}
