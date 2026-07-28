"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { EyeIcon, SpinnerIcon, PauseIcon, PlayIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PaywallDialog,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// A standing query from GET /api/standing-queries — a saved Ask question kept
// under watch. Re-evaluated when new signals touch its cited entities; alerts
// when the answer materially changes (and lands in the weekly digest).
interface StandingQuery {
  id: string;
  question: string;
  isActive: boolean;
  currentAnswer: string;
  lastChangeSummary: string | null;
  lastAlertedAt: string | null;
  lastEvaluatedAt: string | null;
  createdAt: string;
}

const CHANGED_BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function WatchedQuestions() {
  const [queries, setQueries] = useState<StandingQuery[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${BASE}/api/standing-queries`, { credentials: "include", signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ queries?: StandingQuery[] }>) : null))
      .then((d) => setQueries(d?.queries ?? []))
      .catch(() => setQueries([]));
    return () => ctrl.abort();
  }, []);

  async function toggle(query: StandingQuery) {
    setBusyId(query.id);
    try {
      const res = await fetch(`${BASE}/api/standing-queries/${query.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !query.isActive }),
      });
      if (res.ok) {
        const body = (await res.json()) as { query: StandingQuery };
        setQueries((qs) => qs?.map((q) => (q.id === query.id ? body.query : q)) ?? null);
      } else if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as PaywallReason & {
          error?: string;
        };
        if (body.error === "plan_limit_standing_queries") {
          setPaywall({ code: body.error, plan: body.plan, limit: body.limit, used: body.used });
        }
      }
    } finally {
      setBusyId(null);
    }
  }

  async function remove(query: StandingQuery) {
    setBusyId(query.id);
    try {
      const res = await fetch(`${BASE}/api/standing-queries/${query.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) setQueries((qs) => qs?.filter((q) => q.id !== query.id) ?? null);
    } finally {
      setBusyId(null);
    }
  }

  if (!queries || queries.length === 0) return null;

  return (
    <div>
      <p className="flex items-center gap-1.5 text-dense font-medium text-muted-foreground">
        <EyeIcon className="size-4" aria-hidden />
        Watched questions
      </p>
      <p className="mt-1 text-meta text-muted-foreground">
        Re-checked when new signals touch them, and you&apos;re alerted when an answer
        materially changes.
      </p>
      <div className="mt-3 overflow-hidden rounded-md border border-border">
        {queries.map((q) => {
          const changedRecently =
            q.lastAlertedAt !== null &&
            Date.now() - new Date(q.lastAlertedAt).getTime() < CHANGED_BADGE_WINDOW_MS;
          const busy = busyId === q.id;
          return (
            <div
              key={q.id}
              className="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "min-w-0 truncate text-sm",
                      q.isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {q.question}
                  </span>
                  {changedRecently && (
                    <span className="inline-flex shrink-0 items-center rounded-sm border border-[var(--link)]/40 bg-[var(--link)]/10 px-1.5 py-px text-meta font-medium text-foreground">
                      Changed
                    </span>
                  )}
                  {!q.isActive && (
                    <span className="inline-flex shrink-0 items-center rounded-sm border border-border px-1.5 py-px text-meta text-muted-foreground">
                      Paused
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-meta text-muted-foreground">
                  {q.lastChangeSummary ??
                    (q.lastEvaluatedAt
                      ? `Last checked ${formatDistanceToNow(new Date(q.lastEvaluatedAt), { addSuffix: true })}`
                      : "No change since you saved it")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void toggle(q)}
                  disabled={busy}
                  aria-label={q.isActive ? "Pause watching" : "Resume watching"}
                  title={q.isActive ? "Pause watching" : "Resume watching"}
                >
                  {busy ? (
                    <SpinnerIcon className="size-4 animate-spin" />
                  ) : q.isActive ? (
                    <PauseIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <PlayIcon className="size-4 text-muted-foreground" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void remove(q)}
                  disabled={busy}
                  aria-label="Stop watching and delete"
                  title="Stop watching and delete"
                >
                  <TrashIcon className="size-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {paywall && <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />}
    </div>
  );
}
