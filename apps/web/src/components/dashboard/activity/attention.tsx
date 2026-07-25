"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api, type ActivitySource } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { useForceRescan } from "@/hooks/use-force-rescan";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";
import { Button } from "@/components/ui/button";
import { SectionHead } from "@/components/dashboard/section-head";

// Sources that have stopped answering, named. Nothing on this page could say so
// before: the roster was fetched to fill three dropdowns and thrown away.
//
// Each is one hairline row rather than a card — the block exists to be read and
// cleared, and two cards cost 130px to say two things. The cross hides a row for
// a week rather than for good: a source still dark next Friday has to come back,
// otherwise dismissing it quietly stops the watching it was reporting.

const STORE_KEY = "outrival.activity.dismissed";
const HIDE_DAYS = 7;

type Dismissals = Record<string, number>;

function readDismissals(): Dismissals {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const now = Date.now();
    // Drop expired entries on read, so the store cannot grow without bound and a
    // week-old dismissal cannot outlive its window.
    return Object.fromEntries(
      Object.entries(parsed as Dismissals).filter(([, until]) => typeof until === "number" && until > now),
    );
  } catch {
    return {};
  }
}

function writeDismissals(next: Dismissals) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked storage only costs the memory of the dismissal.
  }
}

const STATE_RANK: Record<string, number> = { unscrapable: 0, failing: 1, paused: 2 };

export function Attention({
  sources,
  onChanged,
}: {
  sources: ActivitySource[];
  onChanged: () => void;
}) {
  const [dismissed, setDismissed] = useState<Dismissals>({});
  // localStorage is unreachable while the component renders on the server, so the
  // block stays out of the tree until the first client pass has read it. That
  // costs one frame and avoids showing a row the user already dismissed.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setDismissed(readDismissals());
    setReady(true);
  }, []);

  const dismiss = useCallback((monitorId: string) => {
    setDismissed((prev) => {
      const next = { ...prev, [monitorId]: Date.now() + HIDE_DAYS * 86_400_000 };
      writeDismissals(next);
      return next;
    });
  }, []);

  const restore = useCallback((monitorId: string) => {
    setDismissed((prev) => {
      const next = { ...prev };
      delete next[monitorId];
      writeDismissals(next);
      return next;
    });
  }, []);

  const broken = sources
    .filter((s) => s.status !== "ok")
    .sort((a, b) => (STATE_RANK[a.status] ?? 9) - (STATE_RANK[b.status] ?? 9));
  const visible = broken.filter((s) => !dismissed[s.monitorId]);
  const hidden = broken.filter((s) => dismissed[s.monitorId]);

  if (!ready || broken.length === 0) return null;

  return (
    <section className="flex flex-col" aria-labelledby="activity-attention">
      <SectionHead
        title="Needs attention"
        divider
        action={
          <span className="text-dense text-muted-foreground">
            <span className="tabular-nums">{visible.length}</span> of{" "}
            <span className="tabular-nums">{sources.length}</span> sources
          </span>
        }
      />
      {visible.map((s) => (
        <AttentionRow key={s.monitorId} source={s} onDismiss={dismiss} onChanged={onChanged} />
      ))}
      {hidden.map((s) => (
        <div
          key={s.monitorId}
          className="flex items-center gap-2.5 border-b border-border py-2.5 pl-1 text-dense text-muted-foreground last:border-b-0"
        >
          <span>
            {s.competitorName} {sourceLabel(s.sourceType).toLowerCase()} hidden for {HIDE_DAYS} days.
          </span>
          <button
            type="button"
            onClick={() => restore(s.monitorId)}
            className="font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Undo
          </button>
        </div>
      ))}
    </section>
  );
}

// Why a source stopped, in its own terms. Only ever built from columns that stay
// current (lastRunAt, consecutiveFailures, the two pause flags) — the failure
// diagnosis columns are sticky and can describe a source that has since healed.
function explain(s: ActivitySource): string {
  const failures = s.consecutiveFailures ?? 0;
  const last = s.lastRunAt
    ? `Last answered ${formatDistanceToNow(new Date(s.lastRunAt), { addSuffix: true })}.`
    : "It has never answered.";
  if (s.status === "unscrapable") {
    return `${last} Outrival paused it after repeated failures and is not retrying on its own.`;
  }
  if (s.status === "paused") return `${last} You paused this source, so it is not being checked.`;
  return failures > 1
    ? `${last} The ${failures} checks since have failed.`
    : `${last} The check since then failed.`;
}

function AttentionRow({
  source,
  onDismiss,
  onChanged,
}: {
  source: ActivitySource;
  onDismiss: (monitorId: string) => void;
  onChanged: () => void;
}) {
  const [resuming, setResuming] = useState(false);
  const { forceRescan, isRescanning } = useForceRescan(source.monitorId, { onDone: onChanged });

  // "Resume" means two different repairs. An auto-paused source has to have its
  // refusal cleared before the scheduler will look at it again (the alternatives
  // route does that and kicks a scrape); a source the user paused only needs its
  // switch back on.
  const resume = async () => {
    setResuming(true);
    try {
      if (source.status === "unscrapable") await api.resumeMonitor(source.monitorId);
      else await api.updateMonitor(source.monitorId, { isActive: true });
      toast.success(`${sourceLabel(source.sourceType)} resumed. It runs on the next check.`);
      onChanged();
    } catch (err) {
      toastApiError(err, { title: "Couldn't resume this source" });
    } finally {
      setResuming(false);
    }
  };

  const sourcesHref = source.isSelf
    ? "/dashboard/products"
    : `/dashboard/competitors/${source.competitorId}/sources`;

  return (
    <div className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-b border-border py-2.5 pl-1 last:border-b-0 max-sm:grid-cols-[8px_minmax(0,1fr)]">
      <span
        className={
          source.status === "failing" || source.status === "unscrapable"
            ? "size-[7px] rounded-full bg-critical"
            : "size-[7px] rounded-full border border-muted-foreground"
        }
        aria-hidden
      />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-dense">
        <span className="text-sm font-medium">
          <Link
            href={source.isSelf ? "/dashboard/products" : `/dashboard/competitors/${source.competitorId}`}
            className="hover:underline"
            style={competitorNameColor(source.competitorColor)}
          >
            {source.competitorName}
          </Link>
          <span className="font-normal text-muted-foreground"> · {sourceLabel(source.sourceType)}</span>
        </span>
        <span className="text-muted-foreground">{explain(source)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:col-start-2">
        {source.status === "failing" ? (
          <Button size="sm" variant="secondary" onClick={forceRescan} loading={isRescanning}>
            Check now
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={resume} loading={resuming}>
            Resume
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <Link href={sourcesHref}>Open source</Link>
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onDismiss(source.monitorId)}
          aria-label={`Hide ${source.competitorName} ${sourceLabel(source.sourceType).toLowerCase()} for ${HIDE_DAYS} days`}
          title={`Hide for ${HIDE_DAYS} days`}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
