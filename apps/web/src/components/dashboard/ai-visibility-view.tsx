"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Eye,
  Play,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Lock,
  Loader2,
} from "lucide-react";
import { aiVisibilityQuery } from "@/lib/queries";
import { api } from "@/lib/api";
import { paywallFromError } from "@/components/outrival/paywall-dialog";
import { useSetAskContext } from "@/components/dashboard/ask-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const AiVisibilityChart = dynamic(() => import("./ai-visibility-chart"), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-lg bg-muted/30" />,
});

const ENGINE_LABEL: Record<string, string> = { perplexity: "Perplexity" };
const engineLabel = (e: string) => ENGINE_LABEL[e] ?? e;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function AiVisibilityView() {
  useSetAskContext({ kind: "view", label: "AI Visibility" });
  const qc = useQueryClient();
  const q = useQuery(aiVisibilityQuery());
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-visibility"] });

  async function runNow() {
    setRunning(true);
    try {
      await api.runAiVisibility();
      toast.success("Visibility run started — results appear in about a minute.");
      // The run is async on a worker; pull the fresh results in a little while.
      setTimeout(refresh, 60_000);
    } catch {
      toast.error("Couldn't start the run.");
    } finally {
      setRunning(false);
    }
  }
  async function addPrompt() {
    const p = draft.trim();
    if (p.length < 3) return;
    try {
      await api.addAiVisibilityPrompt(p);
      setDraft("");
      refresh();
    } catch {
      toast.error("Couldn't add the prompt.");
    }
  }
  async function togglePrompt(id: string, isActive: boolean) {
    try {
      await api.updateAiVisibilityPrompt(id, { isActive });
      refresh();
    } catch {
      toast.error("Couldn't update the prompt.");
    }
  }
  async function removePrompt(id: string) {
    try {
      await api.deleteAiVisibilityPrompt(id);
      refresh();
    } catch {
      toast.error("Couldn't remove the prompt.");
    }
  }

  // Free/starter: the data query 403s with plan_locked_feature → locked upsell.
  if (q.error && paywallFromError(q.error)) return <LockedState />;
  if (q.isLoading && !q.data) return <LoadingState />;
  const data = q.data;
  if (!data) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load AI Visibility.</p>
        <Button onClick={refresh} size="sm" variant="outline" className="mt-3">
          Retry
        </Button>
      </Shell>
    );
  }

  const hasData = data.leaderboard.length > 0;
  const showChart = data.trend.length >= 2 && data.trendKeys.length > 0;
  const primaryEngine = data.leaderboard[0]?.engine ?? "perplexity";

  return (
    <Shell>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold tracking-tight">AI Visibility</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How your product and competitors show up in AI answer engines.
          </p>
        </div>
        <Button onClick={runNow} disabled={running} size="sm">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Run now
        </Button>
      </header>
      {data.lastRunAt && (
        <p className="text-meta text-muted-foreground">
          Last checked {new Date(data.lastRunAt).toLocaleString()}
          {data.degraded ? " · some data temporarily unavailable" : ""}
        </p>
      )}

      {!hasData ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Eye className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-lead font-medium">No visibility data yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Run a check to see whether ChatGPT, Perplexity &amp; co. mention your product —
            and which competitors show up instead.
          </p>
          <Button onClick={runNow} disabled={running} size="sm" className="mt-4">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Run first check
          </Button>
        </div>
      ) : (
        <>
          {showChart && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-medium">Share of voice over time</h2>
              <p className="text-meta text-muted-foreground">
                % of tracked prompts where each brand is mentioned ({engineLabel(primaryEngine)}).
              </p>
              <div className="mt-3">
                <AiVisibilityChart keys={data.trendKeys} data={data.trend} />
              </div>
            </section>
          )}

          {data.leaderboard.map((lb) => (
            <section key={lb.engine} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{engineLabel(lb.engine)}</h2>
                <span className="text-meta text-muted-foreground">
                  {lb.totalPrompts} prompt{lb.totalPrompts > 1 ? "s" : ""}
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {lb.subjects.map((s) => (
                  <li key={s.competitorId} className="flex items-center gap-3">
                    <span
                      className={`w-40 shrink-0 truncate text-dense ${
                        s.isSelf ? "font-semibold text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {s.name}
                      {s.isSelf && <span className="ml-1 text-meta text-[var(--link)]">you</span>}
                    </span>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${Math.round(s.sov * 100)}%`,
                          background: s.isSelf ? "var(--link)" : "var(--chart-2)",
                        }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-dense tabular-nums">{pct(s.sov)}</span>
                    <span className="w-14 shrink-0 text-right text-meta text-muted-foreground">
                      {s.avgRank != null ? `#${s.avgRank.toFixed(1)}` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium">By prompt</h2>
            <ul className="mt-2 divide-y divide-border">
              {data.breakdown.map((row) => {
                const cell = row.cells[0];
                const expanded = open === row.promptId;
                return (
                  <li key={row.promptId} className="py-2">
                    <button
                      onClick={() => setOpen(expanded ? null : row.promptId)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      {expanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="flex-1 truncate text-dense">{row.prompt}</span>
                      {cell?.selfMentioned ? (
                        <span className="shrink-0 text-meta text-[var(--link)]">
                          You{cell.selfRank != null ? ` · #${cell.selfRank}` : ""}
                        </span>
                      ) : (
                        <span className="shrink-0 text-meta text-muted-foreground">Not mentioned</span>
                      )}
                    </button>
                    {expanded && cell && (
                      <div className="mt-2 space-y-2 pl-6">
                        <p className="text-meta text-muted-foreground">
                          Mentioned: {cell.mentioned.length ? cell.mentioned.join(", ") : "—"}
                        </p>
                        {cell.excerpt && (
                          <p className="rounded bg-muted/30 p-2 text-dense text-muted-foreground">
                            {cell.excerpt}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Tracked prompts</h2>
        <p className="text-meta text-muted-foreground">
          The buyer questions we ask the engines. Toggle off to pause, or add your own.
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addPrompt();
            }}
            placeholder="e.g. best CRM for startups"
          />
          <Button onClick={addPrompt} size="sm" disabled={draft.trim().length < 3}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        <ul className="mt-3 space-y-1">
          {data.prompts.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <button
                onClick={() => togglePrompt(p.id, !p.isActive)}
                className={`shrink-0 rounded px-2 py-0.5 text-meta ${
                  p.isActive ? "text-[var(--link)]" : "text-muted-foreground"
                }`}
              >
                {p.isActive ? "Active" : "Paused"}
              </button>
              <span
                className={`flex-1 truncate text-dense ${
                  p.isActive ? "" : "text-muted-foreground line-through"
                }`}
              >
                {p.prompt}
              </span>
              <button
                onClick={() => removePrompt(p.id)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Remove prompt"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          {data.prompts.length === 0 && (
            <li className="text-meta text-muted-foreground">
              No prompts yet — add one, or run a check to seed defaults.
            </li>
          )}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">{children}</div>;
}

function LoadingState() {
  return (
    <Shell>
      <div className="h-7 w-48 animate-pulse rounded bg-muted/40" />
      <div className="h-64 w-full animate-pulse rounded-lg bg-muted/30" />
      <div className="h-40 w-full animate-pulse rounded-lg bg-muted/30" />
    </Shell>
  );
}

function LockedState() {
  return (
    <Shell>
      <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <Lock className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <h1 className="mt-3 text-lead font-semibold">AI Visibility</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Track whether ChatGPT, Perplexity and other AI answer engines mention your product
          — and which competitors show up instead. Available on Pro and Business.
        </p>
        <Button asChild size="sm" className="mt-4">
          <Link href="/dashboard/settings/billing">Upgrade</Link>
        </Button>
      </div>
    </Shell>
  );
}
