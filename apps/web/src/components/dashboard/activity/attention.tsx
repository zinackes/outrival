"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CaretRightIcon, XIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api, type ActivitySource } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toastApiError } from "@/lib/error-helpers";
import { useForceRescan } from "@/hooks/use-force-rescan";
import { usePersistedOpen } from "@/hooks/use-persisted-open";
import { feedItemMotion } from "@/lib/motion";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";
import { Button } from "@/components/ui/button";

// Sources that have stopped answering, named. Nothing on this page could say so
// before: the roster was fetched to fill three dropdowns and thrown away.
//
// Each is one hairline row rather than a card, the section collapses, and the
// cross retires a row for good. The opening sentence still counts every dark
// source, because that line is the page's one claim about coverage and must not
// go quiet just because this task list was cleared.

const STORE_KEY = "outrival.activity.dismissed";
const OPEN_KEY = "outrival.activity.attention.open";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // The first shape was {monitorId: expiryMs}. Reading its keys as a plain set
    // means an upgrade never resurrects a row the user had already dismissed.
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    if (parsed && typeof parsed === "object") return Object.keys(parsed);
    return [];
  } catch {
    return [];
  }
}

function writeDismissed(next: string[]) {
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
  const [dismissed, setDismissed] = useState<string[]>([]);
  // localStorage is unreachable while this renders on the server, so the block
  // stays out of the tree until the first client pass has read it. That costs one
  // frame and avoids showing a row the user already cleared.
  const [ready, setReady] = useState(false);
  const [open, setOpen] = usePersistedOpen(OPEN_KEY);
  useEffect(() => {
    setDismissed(readDismissed());
    setReady(true);
  }, []);

  const dismiss = useCallback((monitorId: string) => {
    setDismissed((prev) => {
      const next = prev.includes(monitorId) ? prev : [...prev, monitorId];
      writeDismissed(next);
      return next;
    });
  }, []);

  const visible = sources
    .filter((s) => s.status !== "ok" && !dismissed.includes(s.monitorId))
    .sort((a, b) => (STATE_RANK[a.status] ?? 9) - (STATE_RANK[b.status] ?? 9));

  if (!ready || visible.length === 0) return null;

  return (
    <section className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center justify-between gap-3 border-b border-border pb-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex items-center gap-1.5">
          <CaretRightIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
          <h2 className="text-lg font-semibold leading-tight tracking-tight">Needs attention</h2>
        </span>
        <span className="text-dense text-muted-foreground">
          <span className="tabular-nums">{visible.length}</span> of{" "}
          <span className="tabular-nums">{sources.length}</span> sources
        </span>
      </button>

      {/* 0fr to 1fr animates a height the browser measures itself, so the section
          opens smoothly without pinning a pixel height a wrapped row would break. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          {/* A dismissed row leaves the way a filtered-out competitor does, and the
              rows under it close the gap, so the cross reads as retiring THAT row
              rather than reprinting the list. */}
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((s) => (
              <AttentionRow key={s.monitorId} source={s} onDismiss={dismiss} onChanged={onChanged} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

// Why a source stopped, in its own terms. Only ever built from columns that stay
// current (lastRunAt, consecutiveFailures, the two pause flags): the failure
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
    // The row IS the animated element (not a wrapper around it), or `last:` would
    // match every row's only child and the hairlines would all disappear.
    <motion.div
      {...feedItemMotion}
      className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-b border-border py-2.5 pl-1 transition-colors last:border-b-0 hover:bg-surface-2 max-sm:grid-cols-[8px_minmax(0,1fr)]"
    >
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
          aria-label={`Stop showing ${source.competitorName} ${sourceLabel(source.sourceType).toLowerCase()} here`}
          title="Stop showing this here"
        >
          <XIcon className="size-4" aria-hidden />
        </Button>
      </div>
    </motion.div>
  );
}
