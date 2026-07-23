"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Play, Plus, Trash2, Pencil, Check, X, ChevronRight, Lock, Loader2, Box, AlertTriangle } from "lucide-react";
import { aiVisibilityQuery, productsListQuery } from "@/lib/queries";
import {
  api,
  type AiVisibilityData,
  type AiVisibilityLeaderboard,
  type AiVisibilityPrompt,
  type AiVisibilitySubject,
} from "@/lib/api";
import { paywallFromError } from "@/components/outrival/paywall-dialog";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { useSetAskContext } from "@/components/dashboard/ask-context";
import { PageHead } from "@/components/dashboard/page-head";
import { SectionHead } from "@/components/dashboard/section-head";
import { Kpi } from "@/components/dashboard/kpi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const AiVisibilityChart = dynamic(() => import("./ai-visibility-chart"), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-md bg-muted/30" />,
});

// Only gemini carries a share-of-voice-over-time trend (Google Search grounding is the
// free default engine, so it's the one with history) — the trend chart, KPI delta and
// sparkline are shown only when it's the engine in focus.
const TREND_ENGINE = "gemini";
const ENGINE_LABEL: Record<string, string> = { perplexity: "Perplexity", gemini: "Gemini" };
const engineLabel = (e: string) => ENGINE_LABEL[e] ?? e;
const pctOf = (x: number) => `${Math.round(x * 100)}%`;

export function AiVisibilityView({ locked = false }: { locked?: boolean }) {
  useSetAskContext({ kind: "view", label: "AI Visibility" });
  const qc = useQueryClient();
  const productId = useProductScope() ?? undefined;
  // AI Visibility is per-product: in "All products" scope the server falls back to the
  // primary product (routes/ai-visibility.ts), so a multi-product org silently sees only
  // that one. Surface which product is on screen when the scope doesn't name it itself.
  const products = useQuery(productsListQuery()).data;
  const activeProducts = (products ?? []).filter((p) => p.status !== "archived");
  const primaryProduct = activeProducts.find((p) => p.isPrimary) ?? null;
  const scopedToPrimary = productId === undefined && activeProducts.length > 1 && !!primaryProduct;
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  // Set when a finished run produced no rows (engine unreachable / quota) so the page
  // says so plainly instead of silently reverting to the empty state.
  const [emptyRun, setEmptyRun] = useState(false);
  const [draft, setDraft] = useState("");
  const [engine, setEngine] = useState<string | null>(null);

  // While a run is in flight, poll the payload so fresh mentions stream in. The worker
  // stamps one run at start and writes rows per prompt×engine, so `lastRunAt` advancing
  // past the pre-run baseline is our "results are landing" signal.
  const q = useQuery({
    ...aiVisibilityQuery(productId),
    enabled: !locked,
    refetchInterval: running ? 5_000 : false,
  });

  // Poll the job's lifecycle so we can settle the moment the worker finishes, rather
  // than waiting out a blind deadline. pg-boss drops the handler's return value, so
  // `done` only says "finished" — we pair it with whether the board gained rows to
  // tell a real run from an engine-unreachable one.
  const statusQ = useQuery({
    queryKey: ["ai-visibility-run", runId],
    queryFn: () => api.aiVisibilityRunStatus(runId as string),
    enabled: running && !!runId,
    refetchInterval: running && !!runId ? 3_000 : false,
  });

  const baselineRunAt = useRef<string | null>(null);
  const runDeadline = useRef(0);
  const jobDoneAt = useRef(0);

  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-visibility"] });

  async function runNow() {
    baselineRunAt.current = q.data?.latestRunAt ?? null;
    runDeadline.current = Date.now() + 180_000;
    jobDoneAt.current = 0;
    setEmptyRun(false);
    setRunId(null);
    setRunning(true);
    try {
      const { runId: id } = await api.runAiVisibility();
      setRunId(id);
      toast.success("Visibility check started — results appear as engines respond.");
    } catch {
      setRunning(false);
      toast.error("Couldn't start the run.");
    }
  }

  // Settle the run into ONE of two outcomes: updated (the run wrote fresh rows) or empty
  // (the worker finished but wrote nothing — the answer engine didn't respond). The
  // "wrote rows" signal is `latestRunAt` advancing past the pre-run baseline (the newest
  // run regardless of mentions; the data read is `cache:"no-store"`, so a 5s poll sees
  // it fresh). We learn the job finished from the status poll, then give an ~8s grace
  // for that next poll before declaring the run empty. The hard deadline is a backstop
  // for when the status endpoint can't see the job (already pruned / dedup).
  useEffect(() => {
    if (!running) return;
    const now = Date.now();
    const advanced = !!q.data?.latestRunAt && q.data.latestRunAt !== baselineRunAt.current;
    if (statusQ.data?.done && jobDoneAt.current === 0) jobDoneAt.current = now;

    const graceElapsed = jobDoneAt.current > 0 && now - jobDoneAt.current > 8_000;
    const deadlineHit = now > runDeadline.current;

    if (advanced) {
      setRunning(false);
      toast.success("AI Visibility results updated.");
    } else if (graceElapsed || deadlineHit) {
      setRunning(false);
      setEmptyRun(true);
      toast.error(
        "The run finished but no results came back — the answer engine may be temporarily unavailable.",
      );
    }
  }, [q.dataUpdatedAt, q.errorUpdatedAt, q.data?.latestRunAt, statusQ.data?.done, running]);

  const runLanding =
    running && !!q.data?.latestRunAt && q.data.latestRunAt !== baselineRunAt.current;
  async function addPrompt() {
    const p = draft.trim();
    if (p.length < 3) return;
    try {
      await api.addAiVisibilityPrompt(p, productId);
      setDraft("");
      refresh();
    } catch {
      toast.error("Couldn't add the prompt.");
    }
  }
  // Optimistic: flip the switch in the cache immediately (the round-trip + refetch
  // otherwise left it stuck for ~2s), revert to server truth on error.
  async function togglePrompt(id: string, isActive: boolean) {
    const key = aiVisibilityQuery(productId).queryKey;
    const prev = qc.getQueryData<AiVisibilityData>(key);
    qc.setQueryData<AiVisibilityData>(key, (old) =>
      old
        ? { ...old, prompts: old.prompts.map((p) => (p.id === id ? { ...p, isActive } : p)) }
        : old,
    );
    try {
      await api.updateAiVisibilityPrompt(id, { isActive });
    } catch {
      if (prev) qc.setQueryData(key, prev);
      toast.error("Couldn't update the prompt.");
    }
  }
  // Optimistic: drop the prompt from the list AND from the "By prompt" evidence right
  // away (the last run's rows still reference it until the next run reruns).
  async function removePrompt(id: string) {
    const key = aiVisibilityQuery(productId).queryKey;
    const prev = qc.getQueryData<AiVisibilityData>(key);
    qc.setQueryData<AiVisibilityData>(key, (old) =>
      old
        ? {
            ...old,
            prompts: old.prompts.filter((p) => p.id !== id),
            breakdown: old.breakdown.filter((b) => b.promptId !== id),
          }
        : old,
    );
    try {
      await api.deleteAiVisibilityPrompt(id);
    } catch {
      if (prev) qc.setQueryData(key, prev);
      toast.error("Couldn't remove the prompt.");
    }
  }
  // Optimistic: rewrite the prompt text in the list AND relabel its "By prompt" row (past
  // runs reference the id, so the breakdown keeps its history under the new wording).
  async function editPrompt(id: string, prompt: string) {
    const key = aiVisibilityQuery(productId).queryKey;
    const prev = qc.getQueryData<AiVisibilityData>(key);
    qc.setQueryData<AiVisibilityData>(key, (old) =>
      old
        ? {
            ...old,
            prompts: old.prompts.map((p) => (p.id === id ? { ...p, prompt } : p)),
            breakdown: old.breakdown.map((b) => (b.promptId === id ? { ...b, prompt } : b)),
          }
        : old,
    );
    try {
      await api.updateAiVisibilityPrompt(id, { prompt });
    } catch {
      if (prev) qc.setQueryData(key, prev);
      toast.error("Couldn't update the prompt.");
    }
  }

  // Free/starter: the seed reported the plan-locked 403 → upsell, server-rendered (no
  // client fetch). Kept as a belt-and-braces fallback if the client query 403s too.
  if (locked) return <LockedState />;
  if (q.error && paywallFromError(q.error)) return <LockedState />;
  if (q.isLoading && !q.data) return <LoadingState />;
  const data = q.data;
  if (!data) {
    return (
      <Shell>
        <PageHead title="AI Visibility" flush />
        <p className="text-sm text-muted-foreground">Couldn&apos;t load AI Visibility.</p>
        <Button onClick={refresh} size="sm" variant="outline" className="mt-3 w-fit">
          Retry
        </Button>
      </Shell>
    );
  }

  const engines = data.leaderboard.map((l) => l.engine);
  const primaryEngine = engines.includes(TREND_ENGINE) ? TREND_ENGINE : engines[0] ?? TREND_ENGINE;
  const activeEngine = engine && engines.includes(engine) ? engine : primaryEngine;
  const lb = data.leaderboard.find((l) => l.engine === activeEngine) ?? null;
  const hasData = data.leaderboard.length > 0;
  const isTrendEngine = activeEngine === TREND_ENGINE;
  const showChart = isTrendEngine && data.trend.length >= 2 && data.trendKeys.length > 0;

  const runButton = (
    <Button onClick={runNow} disabled={running} size="sm">
      {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
      {running ? "Running…" : "Run now"}
    </Button>
  );

  return (
    <Shell>
      <PageHead
        title="AI Visibility"
        flush
        sub={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>How your product and competitors show up in AI answer engines.</span>
            {data.lastRunAt && (
              <span className="text-meta font-mono text-muted-foreground">
                · checked {new Date(data.lastRunAt).toLocaleDateString()}
                {data.degraded ? " · partial data" : ""}
              </span>
            )}
          </span>
        }
        actions={runButton}
      />

      {scopedToPrimary && (
        <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2">
          <Box className="size-4 shrink-0 text-[var(--link)]" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Tracked per product — showing{" "}
            <span className="font-medium text-foreground">{primaryProduct?.name}</span>. Pick
            another from the product menu, top-left.
          </p>
        </div>
      )}

      {running && <RunProgressBanner landing={runLanding} />}

      {emptyRun && !running && <EngineUnreachableBanner onRetry={runNow} />}

      {!hasData ? (
        <EmptyState onRun={runNow} running={running} />
      ) : (
        <TooltipProvider delayDuration={80}>
          {engines.length > 1 && (
            <Tabs value={activeEngine} onValueChange={setEngine} className="w-fit">
              <TabsList>
                {engines.map((e) => (
                  <TabsTrigger key={e} value={e}>
                    {engineLabel(e)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {lb && <VisibilityKpis lb={lb} trend={data.trend} isTrendEngine={isTrendEngine} />}

          <div className={showChart ? "grid gap-5 xl:grid-cols-2" : ""}>
            {lb && <Leaderboard lb={lb} />}
            {showChart && (
              <section className="min-w-0">
                <SectionHead
                  title="Share of voice over time"
                  sub={`% of prompts mentioning each brand · ${engineLabel(activeEngine)}`}
                />
                <div className="mt-4">
                  <AiVisibilityChart keys={data.trendKeys} data={data.trend} />
                </div>
              </section>
            )}
          </div>

          <Breakdown data={data} engine={activeEngine} />
        </TooltipProvider>
      )}

      <PromptManager
        prompts={data.prompts}
        draft={draft}
        setDraft={setDraft}
        onAdd={addPrompt}
        onToggle={togglePrompt}
        onEdit={editPrompt}
        onRemove={removePrompt}
      />
    </Shell>
  );
}

// --- Hero KPIs: where you stand in the selected engine's answers. -------------------

function VisibilityKpis({
  lb,
  trend,
  isTrendEngine,
}: {
  lb: AiVisibilityLeaderboard;
  trend: AiVisibilityData["trend"];
  isTrendEngine: boolean;
}) {
  const subjects = lb.subjects;
  const self = subjects.find((s) => s.isSelf) ?? null;
  const selfIdx = subjects.findIndex((s) => s.isSelf);
  const ranked = !!self && self.sov > 0;
  const leader = subjects[0] ?? null;

  // Self's share-of-voice trajectory (trend values are already 0–100 points).
  const series =
    isTrendEngine && self
      ? trend
          .map((r) => r[self.name])
          .filter((v): v is number => typeof v === "number")
      : [];
  const last = series.at(-1);
  const prev = series.at(-2);
  const delta = last != null && prev != null ? Math.round(last - prev) : null;
  const deltaKind = delta == null || delta === 0 ? "neutral" : delta > 0 ? "pos" : "neg";

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
      <div className="bg-card">
        <Kpi
          label="Your share of voice"
          value={self ? pctOf(self.sov) : "—"}
          hint="Share of tracked prompts where an AI answer engine mentions your product."
          delta={delta != null ? `${delta > 0 ? "+" : ""}${delta} pts` : undefined}
          deltaKind={deltaKind}
          spark={series.length >= 2 ? series : undefined}
          sparkColor="var(--link)"
          sparkValueLabel="% SoV"
        />
      </div>
      <div className="bg-card">
        <Kpi
          label="Mentioned in"
          value={self ? self.mentions : 0}
          suffix={`/ ${lb.totalPrompts} prompts`}
          deltaKind="neutral"
        />
      </div>
      <div className="bg-card">
        <Kpi
          label="Standing"
          value={ranked ? `#${selfIdx + 1}` : "—"}
          suffix={ranked ? `of ${subjects.length}` : undefined}
          meta={ranked ? undefined : "Not yet mentioned"}
          deltaKind="neutral"
        />
      </div>
      <div className="bg-card">
        <Kpi
          label="Leader"
          value={leader ? pctOf(leader.sov) : "—"}
          valueClassName={leader?.isSelf ? "text-[var(--link)]" : undefined}
          meta={leader ? (leader.isSelf ? "You lead" : leader.name) : undefined}
          deltaKind="neutral"
        />
      </div>
    </div>
  );
}

// --- Leaderboard: ranked share-of-voice bars, self highlighted in cyan. -------------

function Leaderboard({ lb }: { lb: AiVisibilityLeaderboard }) {
  const max = lb.subjects.reduce((m, s) => Math.max(m, s.sov), 0) || 1;
  return (
    <section className="min-w-0">
      <SectionHead
        title="Share of voice"
        sub={`${engineLabel(lb.engine)} · ${lb.totalPrompts} prompt${lb.totalPrompts > 1 ? "s" : ""}`}
      />
      <div className="mt-1.5 flex items-center gap-3 px-1 py-1.5 text-meta text-muted-foreground">
        <span className="w-6 shrink-0" />
        <span className="flex-1">Brand</span>
        <span className="w-12 shrink-0 text-right">Share</span>
        <span className="hidden w-14 shrink-0 text-right sm:block">Avg pos</span>
      </div>
      <ul>
        {lb.subjects.map((s, i) => (
          <LeaderboardRow key={s.competitorId} subject={s} rank={i + 1} max={max} />
        ))}
      </ul>
    </section>
  );
}

function LeaderboardRow({
  subject: s,
  rank,
  max,
}: {
  subject: AiVisibilitySubject;
  rank: number;
  max: number;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-md px-1 py-2.5 ${
        s.isSelf ? "bg-accent/50" : ""
      }`}
    >
      <span className="w-6 shrink-0 text-right font-mono text-dense tabular-nums text-muted-foreground">
        {rank}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Link
            href={s.isSelf ? "/dashboard/products" : `/dashboard/competitors/${s.competitorId}`}
            className={`truncate text-sm underline-offset-2 hover:underline ${
              s.isSelf ? "font-semibold text-foreground" : "text-foreground"
            }`}
          >
            {s.name}
          </Link>
          {s.isSelf && <Badge variant="tracked">You</Badge>}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${s.isSelf ? "bg-[var(--link)]" : "bg-foreground/25"}`}
            // 0% stays empty; a non-zero share floors at 2% so the bar is still visible.
            style={{ width: `${s.sov <= 0 ? 0 : Math.max(2, Math.round((s.sov / max) * 100))}%` }}
          />
        </div>
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-sm tabular-nums">
        {pctOf(s.sov)}
      </span>
      <span className="hidden w-14 shrink-0 text-right font-mono text-dense tabular-nums text-muted-foreground sm:block">
        {s.avgRank != null ? `#${s.avgRank.toFixed(1)}` : "—"}
      </span>
    </li>
  );
}

// --- Per-prompt evidence: who each engine names, with the answer excerpt. -----------

function Breakdown({ data, engine }: { data: AiVisibilityData; engine: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = data.breakdown.flatMap((row) => {
    const cell = row.cells.find((c) => c.engine === engine);
    return cell ? [{ row, cell }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <section>
      <SectionHead
        title="By prompt"
        sub={`What ${engineLabel(engine)} answers, question by question`}
      />
      <ul className="mt-1.5 divide-y divide-border">
        {rows.map(({ row, cell }) => {
          const expanded = open.has(row.promptId);
          return (
            <li key={row.promptId}>
              <button
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(row.promptId)) next.delete(row.promptId);
                    else next.add(row.promptId);
                    return next;
                  })
                }
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 rounded-md px-1 py-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
              >
                <ChevronRight
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                    expanded ? "rotate-90" : ""
                  }`}
                  aria-hidden
                />
                <span className="flex-1 truncate text-sm">{row.prompt}</span>
                {cell.selfMentioned ? (
                  <Badge variant="tracked">
                    {cell.selfRank != null ? `You · #${cell.selfRank}` : "You"}
                  </Badge>
                ) : (
                  <Badge variant="paused">Not mentioned</Badge>
                )}
              </button>
              {expanded && (
                <div className="space-y-3 px-1 pb-4 pl-8">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-meta text-muted-foreground">Also mentioned:</span>
                    {cell.mentioned.length ? (
                      cell.mentioned.map((name) => (
                        <Badge key={name} variant="outline">
                          {name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-meta text-muted-foreground">no competitors</span>
                    )}
                  </div>
                  {cell.excerpt && (
                    <p className="rounded-md bg-muted/40 p-3 text-dense leading-relaxed text-muted-foreground">
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
  );
}

// --- Tracked prompts: the buyer questions we ask the engines. -----------------------

function PromptManager({
  prompts,
  draft,
  setDraft,
  onAdd,
  onToggle,
  onEdit,
  onRemove,
}: {
  prompts: AiVisibilityData["prompts"];
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  onToggle: (id: string, isActive: boolean) => void;
  onEdit: (id: string, prompt: string) => void;
  onRemove: (id: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<AiVisibilityPrompt | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const iconBtn =
    "shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40";
  return (
    <section>
      <SectionHead
        title="Tracked prompts"
        sub="The buyer questions we ask the engines · toggle to pause, or add your own"
      />
      <div className="mt-4 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
          placeholder="e.g. best CRM for startups"
        />
        <Button onClick={onAdd} size="sm" disabled={draft.trim().length < 3}>
          <Plus className="size-4" />
          Add
        </Button>
      </div>
      {prompts.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No prompts yet — add one, or run a check to seed defaults.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {prompts.map((p) => {
            const editing = editingId === p.id;
            const saveEdit = () => {
              const next = editDraft.trim();
              if (next.length >= 3 && next !== p.prompt) onEdit(p.id, next);
              setEditingId(null);
            };
            return (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <Switch
                  checked={p.isActive}
                  onCheckedChange={(v) => onToggle(p.id, v)}
                  disabled={editing}
                  aria-label={p.isActive ? "Pause prompt" : "Activate prompt"}
                />
                {editing ? (
                  <>
                    <Input
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      className="h-8 min-w-0 flex-1"
                      aria-label="Edit prompt"
                    />
                    <button
                      onClick={saveEdit}
                      disabled={editDraft.trim().length < 3}
                      className={iconBtn}
                      aria-label="Save prompt"
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className={iconBtn}
                      aria-label="Cancel edit"
                    >
                      <X className="size-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        p.isActive ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {p.prompt}
                    </span>
                    <button
                      onClick={() => {
                        setEditDraft(p.prompt);
                        setEditingId(p.id);
                      }}
                      className={iconBtn}
                      aria-label="Edit prompt"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(p)}
                      className={iconBtn}
                      aria-label="Remove prompt"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this prompt?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.prompt}&rdquo; will no longer be checked against AI answer
              engines. Past results for it are removed from the breakdown.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (deleteTarget) onRemove(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// --- Scaffolding: shell, empty, loading, locked. ------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  // Match sibling dashboard views (Activity/Signals) — the dashboard shell already
  // provides the page padding, so no extra max-width / padding here.
  return <div className="flex flex-col gap-6">{children}</div>;
}

function EmptyState({ onRun, running }: { onRun: () => void; running: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-md border border-border bg-card px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted/60">
        <Eye className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">No visibility data yet</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        Run a check to see whether ChatGPT, Perplexity &amp; co. mention your product — and
        which competitors show up instead.
      </p>
      <Button onClick={onRun} disabled={running} size="sm" className="mt-5">
        {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        Run first check
      </Button>
    </div>
  );
}

// In-progress strip shown from "Run now" click until the fresh run's rows land (a run is
// async on a worker, ~a minute) — otherwise the button just flickers and nothing tells the
// user the check is underway.
function RunProgressBanner({ landing }: { landing: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3"
    >
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--link)]" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {landing ? "Results are landing…" : "Checking AI answer engines…"}
        </p>
        <p className="text-dense text-muted-foreground">
          {landing
            ? "Fresh mentions are streaming in as each engine responds."
            : "We're asking Gemini and Perplexity your tracked prompts. This usually takes about a minute."}
        </p>
      </div>
    </div>
  );
}

// Shown after a run finishes having reached no answer engine (missing key / quota /
// outage) — the honest counterpart to the completion toast, so an empty board reads as
// "the engine didn't respond", not "you're invisible everywhere".
function EngineUnreachableBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          The last run couldn&apos;t reach the answer engine
        </p>
        <p className="text-dense text-muted-foreground">
          No results came back, so the numbers below are unchanged. This is usually a
          temporary engine or quota issue — try again in a moment.
        </p>
      </div>
      <Button onClick={onRetry} size="sm" variant="outline" className="shrink-0">
        <Play className="size-4" />
        Retry
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <Shell>
      <div className="h-8 w-48 animate-pulse rounded bg-muted/40" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[92px] animate-pulse bg-card" />
        ))}
      </div>
      <div className="h-64 w-full animate-pulse rounded-md bg-muted/30" />
    </Shell>
  );
}

function LockedState() {
  return (
    <Shell>
      <div className="mx-auto mt-8 flex max-w-md flex-col items-center rounded-md border border-border bg-card px-6 py-14 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted/60">
          <Lock className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">AI Visibility</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Track whether ChatGPT, Perplexity and other AI answer engines mention your product
          — and which competitors show up instead. Available on Pro and Business.
        </p>
        <Button asChild size="sm" className="mt-5">
          <Link href="/dashboard/settings/billing">Upgrade</Link>
        </Button>
      </div>
    </Shell>
  );
}
