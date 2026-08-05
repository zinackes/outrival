"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/lib/toast";
import {
  EyeIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
  CaretRightIcon,
  LockIcon,
  SpinnerIcon,
  CubeIcon,
  WarningIcon,
  PauseIcon,
} from "@/components/icons";
// Aliased: a bare `Icon` collides with the `const Icon = …` of dynamic renders.
import type { Icon as IconComponent } from "@/components/icons";
import { aiVisibilityQuery, productsListQuery } from "@/lib/queries";
import {
  api,
  type AiVisibilityCell,
  type AiVisibilityData,
  type AiVisibilityLeaderboard,
  type AiVisibilityPrompt,
  type AiVisibilitySubject,
} from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { errorConfig } from "@/lib/error-helpers";
import { disclosureMotion, feedItemMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { paywallFromError } from "@/components/outrival/paywall-dialog";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { useSetAskContext } from "@/components/dashboard/ask-context";
import { PageHead } from "@/components/dashboard/page-head";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { Fact, FactStrip, Verdict } from "@/components/outrival/data-marks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
// free default engine, so it's the one with history) — the trend chart and the KPI
// delta are shown only when it's the engine in focus.
const TREND_ENGINE = "gemini";
const ENGINE_LABEL: Record<string, string> = { perplexity: "Perplexity", gemini: "Gemini" };
const engineLabel = (e: string) => ENGINE_LABEL[e] ?? e;
const pctOf = (x: number) => `${Math.round(x * 100)}%`;

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `#${n}`;
const shortDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric" });

// One colour per brand for the whole page: the swatch on its board row, its line in the
// trend, and its name on every question it answers. Self always takes the accent;
// competitors take the six-hue data-viz palette in board order.
//
// Deliberately NOT competitors.color (patch-33): that field is null on most rows, so a
// board would come out half tinted and half grey. Here the colour's job is to tell six
// series apart within one run, which is exactly what --chart-1..6 are tuned for.
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-6)",
  "var(--chart-5)",
  "var(--chart-3)",
  "var(--chart-4)",
];
const SELF_COLOR = "var(--link)";

function buildColors(subjects: AiVisibilitySubject[]): Record<string, string> {
  const map: Record<string, string> = {};
  let i = 0;
  for (const s of subjects) {
    map[s.name] = s.isSelf ? SELF_COLOR : (SERIES_COLORS[i++ % SERIES_COLORS.length] as string);
  }
  return map;
}

// A brand's face on this page. The colour used to be carried by a swatch beside every
// name — on the board, on each question's "Named:" line, and again on each badge in the
// evidence — which is four dots per brand and none of them says WHICH brand it is. The
// logo does that job now, and the colour survives where it actually encodes something:
// the board (which keys the trend chart's lines) wears it as a rule under the logo, and
// the answer text keeps its tinted marks. Everywhere else it's just the logo and the name.
function BrandMark({
  name,
  url,
  color,
  size = 16,
}: {
  name: string;
  url: string | null;
  /** Series colour to key against the trend chart; omit where the colour means nothing. */
  color?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 flex-col items-center gap-[3px]"
      style={{ width: size }}
    >
      <CompAvatar name={name} url={url} size={size} />
      {color && (
        <span className="h-0.5 w-full rounded-full" style={{ background: color }} />
      )}
    </span>
  );
}

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
  // How the last run ended, when it didn't end well. Held until the reader retries or
  // dismisses it: this used to be a toast, which meant the outcome of a job that takes
  // about a minute was only ever seen by someone who happened to be looking.
  const [problem, setProblem] = useState<RunProblem | null>(null);
  // Same for the question editor: a failed add/edit/remove reverted the optimistic row
  // and said why for five seconds, which reads as the row deleting itself.
  const [promptProblem, setPromptProblem] = useState<PromptProblem | null>(null);
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

  // Resume a run parked by an earlier visit in this tab. A run outlives the page — the
  // reader is free to walk away for the minute it takes — so its outcome is picked back
  // up here rather than lost with the component that started it.
  useEffect(() => {
    const parked = readParkedRun();
    if (!parked) return;
    if (Date.now() > parked.deadline) {
      clearParkedRun();
      return;
    }
    baselineRunAt.current = parked.baseline;
    runDeadline.current = parked.deadline;
    setRunId(parked.runId);
    setRunning(true);
  }, []);

  async function runNow() {
    const baseline = q.data?.latestRunAt ?? null;
    const deadline = Date.now() + 180_000;
    baselineRunAt.current = baseline;
    runDeadline.current = deadline;
    jobDoneAt.current = 0;
    setProblem(null);
    setRunId(null);
    setRunning(true);
    try {
      const { runId: id } = await api.runAiVisibility();
      setRunId(id);
      parkRun({ runId: id, baseline, deadline });
    } catch (e) {
      setRunning(false);
      clearParkedRun();
      setProblem({ kind: "start", error: e });
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
      setProblem(null);
      clearParkedRun();
      toast.success("AI Visibility results updated.");
    } else if (graceElapsed || deadlineHit) {
      setRunning(false);
      // A job that ended in `failed` never got as far as an engine; one that completed
      // and still wrote nothing did reach out and got nothing back. Different sentence.
      setProblem(statusQ.data?.state === "failed" ? { kind: "failed" } : { kind: "empty" });
      clearParkedRun();
    }
  }, [
    q.dataUpdatedAt,
    q.errorUpdatedAt,
    q.data?.latestRunAt,
    statusQ.data?.done,
    statusQ.data?.state,
    running,
  ]);

  const runLanding =
    running && !!q.data?.latestRunAt && q.data.latestRunAt !== baselineRunAt.current;
  async function addPrompt() {
    const p = draft.trim();
    if (p.length < 3) return;
    try {
      await api.addAiVisibilityPrompt(p, productId);
      setDraft("");
      setPromptProblem(null);
      refresh();
    } catch (e) {
      setPromptProblem({ title: "Couldn't add that question", error: e });
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
      setPromptProblem(null);
    } catch (e) {
      if (prev) qc.setQueryData(key, prev);
      setPromptProblem({
        title: isActive ? "Couldn't resume that question" : "Couldn't pause that question",
        error: e,
      });
    }
  }
  // Optimistic: drop the question from the list AND from the evidence right away (the
  // last run's rows still reference it until the next run reruns).
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
      setPromptProblem(null);
    } catch (e) {
      if (prev) qc.setQueryData(key, prev);
      setPromptProblem({ title: "Couldn't remove that question", error: e });
    }
  }
  // Optimistic: rewrite the text in the list AND relabel its evidence row (past runs
  // reference the id, so the row keeps its history under the new wording).
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
      setPromptProblem(null);
    } catch (e) {
      if (prev) qc.setQueryData(key, prev);
      setPromptProblem({ title: "Couldn't save that question", error: e });
    }
  }

  // Free/starter: the seed reported the plan-locked 403 → upsell, server-rendered (no
  // client fetch). Kept as a belt-and-braces fallback if the client query 403s too.
  if (locked) return <LockedState />;
  if (q.error && paywallFromError(q.error)) return <LockedState />;
  if (q.isLoading && !q.data) return <LoadingState />;
  const data = q.data;
  if (!data) {
    // The load failed with nothing cached to fall back on. Say what the API said rather
    // than "Couldn't load AI Visibility", which is true of a rate limit, an outage and a
    // dropped connection alike, and tells the reader which of them to wait out.
    return (
      <Shell>
        <PageHead title="AI Visibility" flush />
        <Notice
          tone="critical"
          title={q.error ? errorConfig(q.error).title : "Couldn't load AI Visibility"}
          action={{ label: "Retry", onClick: refresh }}
        >
          {q.error
            ? errorConfig(q.error).description
            : "The page came back empty. Try again in a moment."}
        </Notice>
      </Shell>
    );
  }

  const engines = data.leaderboard.map((l) => l.engine);
  const primaryEngine = engines.includes(TREND_ENGINE) ? TREND_ENGINE : engines[0] ?? TREND_ENGINE;
  const activeEngine = engine && engines.includes(engine) ? engine : primaryEngine;
  const lb = data.leaderboard.find((l) => l.engine === activeEngine) ?? null;
  // A leaderboard row with no in-scope subject carries nothing to read; treat it as no
  // data rather than rendering an empty board under a verdict about zero brands.
  const hasData = data.leaderboard.some((l) => l.subjects.length > 0);
  const isTrendEngine = activeEngine === TREND_ENGINE;
  const showChart = isTrendEngine && data.trend.length >= 2 && data.trendKeys.length > 0;
  const colors = lb ? buildColors(lb.subjects) : {};
  const selfSubject = lb?.subjects.find((s) => s.isSelf) ?? null;
  const selfName = selfSubject?.name ?? null;
  const selfUrl = selfSubject?.url ?? null;

  const questions = buildQuestions(data, activeEngine);

  const runButton = (
    <Button onClick={runNow} disabled={running} size="sm">
      {running ? <SpinnerIcon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
      {running ? "Running…" : "Run now"}
    </Button>
  );

  const questionSection = (
    <QuestionList
      rows={questions}
      colors={colors}
      selfName={selfName}
      selfUrl={selfUrl}
      draft={draft}
      setDraft={setDraft}
      onAdd={addPrompt}
      onToggle={togglePrompt}
      onEdit={editPrompt}
      onRemove={removePrompt}
      problem={promptProblem}
      onDismissProblem={() => setPromptProblem(null)}
    />
  );

  return (
    <Shell>
      <PageHead
        title="AI Visibility"
        flush
        sub={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>Which tools AI assistants name when your buyers ask.</span>
            {hasData && (
              <>
                <span aria-hidden>·</span>
                <span>{engineLabel(activeEngine)}</span>
              </>
            )}
            {data.lastRunAt && (
              <>
                <span aria-hidden>·</span>
                <span>checked {shortDate(data.lastRunAt)}</span>
              </>
            )}
            {data.nextRunAt && (
              <>
                <span aria-hidden>·</span>
                <span>next check {shortDate(data.nextRunAt)}</span>
              </>
            )}
          </span>
        }
        actions={runButton}
      />

      {scopedToPrimary && (
        <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2">
          <CubeIcon className="size-4 shrink-0 text-link" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Tracked per product, showing{" "}
            <span className="font-medium text-foreground">{primaryProduct?.name}</span>. Pick
            another from the product menu, top-left.
          </p>
        </div>
      )}

      {running && <RunProgressBanner landing={runLanding} />}

      {problem && !running && (
        <RunProblemNotice
          problem={problem}
          onRetry={runNow}
          onDismiss={() => setProblem(null)}
        />
      )}

      {/* A refetch that fails once the page already holds numbers used to be silent: the
          board kept printing the last run as though it were current. */}
      {q.isError && (
        <Notice
          tone="critical"
          title="Couldn't refresh these numbers"
          action={{ label: "Retry", onClick: refresh }}
        >
          {errorConfig(q.error).description} Everything below is the last run we could read.
        </Notice>
      )}

      {/* The API answered, but one of its reads didn't. Without this the board simply
          renders short and reads as a product nobody names. */}
      {data.degraded && !q.isError && (
        <Notice
          tone="warn"
          title="Part of this page couldn't be read"
          action={{ label: "Retry", onClick: refresh }}
        >
          Some of the visibility history didn&apos;t come back, so the board or the trend may
          be incomplete. This usually clears on its own.
        </Notice>
      )}

      {/* The scheduled run that named nobody. Distinct from the banner above (which
          reports the run YOU just started) and shown until a check comes back with
          answers, because every number on the page is older than the page says. */}
      {data.stale && !running && data.lastRunAt && data.latestRunAt && (
        <StaleRunNotice
          measuredAt={data.lastRunAt}
          attemptedAt={data.latestRunAt}
          engine={engineLabel(activeEngine)}
          onRetry={runNow}
        />
      )}

      {!hasData ? (
        <>
          <EmptyState onRun={runNow} running={running} />
          <TabCard>{questionSection}</TabCard>
        </>
      ) : (
        <>
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

          <TabCard>
            {lb && lb.subjects.length > 0 && (
              <>
                <VerdictBlock
                  lb={lb}
                  questions={questions}
                  stale={data.stale}
                  measuredAt={data.lastRunAt}
                  engine={engineLabel(activeEngine)}
                />
                <TabSection>
                  <Facts lb={lb} questions={questions} stale={data.stale} measuredAt={data.lastRunAt} />
                </TabSection>
                <Board lb={lb} colors={colors} stale={data.stale} measuredAt={data.lastRunAt} />
              </>
            )}

            {showChart && (
              <TabSection
                title="How the answers moved"
                action={
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Top {data.trendKeys.length} brands
                  </span>
                }
              >
                <AiVisibilityChart
                  keys={data.trendKeys}
                  data={data.trend}
                  colors={colors}
                  selfName={selfName}
                />
              </TabSection>
            )}

            {questionSection}

            <SourceFooter engines={engines} />
          </TabCard>
        </>
      )}
    </Shell>
  );
}

// --- The answer, before the evidence. ------------------------------------------------

// One deterministic sentence computed from the run on screen, never generated. Ordered
// by what a reader needs first: a measurement that couldn't be taken outranks a
// standing, and a standing outranks a share.
function VerdictBlock({
  lb,
  questions,
  stale,
  measuredAt,
  engine,
}: {
  lb: AiVisibilityLeaderboard;
  questions: QuestionRow[];
  stale: boolean;
  measuredAt: string | null;
  engine: string;
}) {
  const subjects = lb.subjects;
  const self = subjects.find((s) => s.isSelf) ?? null;
  const selfIdx = subjects.findIndex((s) => s.isSelf);
  const leader = subjects[0] ?? null;
  const runnerUp = subjects[1] ?? null;
  const anyMention = subjects.some((s) => s.mentions > 0);
  const answered = questions.filter((r) => r.cell).length;

  // Nothing was named at all, and there is no earlier run to fall back on. An engine
  // that returns no tool we track is far more often a quota or outage artefact than a
  // market where nobody is recommended, so the sentence says that rather than "0%".
  if (!anyMention) {
    return (
      <Verdict headline={`${engine} named none of the ${subjects.length} brands tracked here.`}>
        It answered {answered === 1 ? "your question" : `all ${answered} of your questions`} and
        returned no tool we follow, including ones it has named before. That points at the engine
        or its free quota rather than at your visibility, so check again before reading anything
        into it.
      </Verdict>
    );
  }

  if (stale && measuredAt) {
    const selfLine =
      self && self.mentions > 0
        ? `and yours on ${self.mentions} of ${self.prompts}`
        : "and yours on none of them";
    return (
      <Verdict
        headline={`No answer engine has named a tracked brand since ${formatDate(measuredAt)}.`}
      >
        On that run {leader?.name} was in front of buyers on {leader?.mentions} of{" "}
        {leader?.prompts} questions {selfLine}. Nothing has been measurable since, so every
        number below is from {formatDate(measuredAt)}.
      </Verdict>
    );
  }

  if (!self || self.mentions === 0) {
    const rivals = subjects.filter((s) => !s.isSelf && s.mentions > 0).slice(0, 2);
    const you = self ? self.name : "your product";
    return (
      <Verdict headline={`${engine} never names ${you} across your ${lb.totalPrompts} questions.`}>
        {rivals[0] && (
          <>
            {rivals[0].name} answers {rivals[0].mentions} of them
            {rivals[1] ? ` and ${rivals[1].name} ${rivals[1].mentions}` : ""}. When a buyer asks
            an assistant which tool to use, those are the names that come back.
          </>
        )}
      </Verdict>
    );
  }

  if (selfIdx === 0) {
    return (
      <Verdict
        headline={`${self.name} is the most-named tool in ${engine}'s answers, in ${self.mentions} of ${self.prompts} questions.`}
      >
        {runnerUp && runnerUp.mentions > 0
          ? `${runnerUp.name} follows at ${pctOf(runnerUp.sov)}. Holding the lead is worth more than gaining a point: the first name in an answer is the one buyers shortlist.`
          : "No other tracked brand is named at all. That lead is worth defending."}
      </Verdict>
    );
  }

  // Named, but behind. The actionable number is how many questions the leader wins
  // while you are absent, which is the shortest route to a better standing.
  const lost = leader
    ? questions.filter(
        (r) =>
          r.cell &&
          !r.cell.selfMentioned &&
          !r.cell.selfSeeded &&
          r.cell.mentioned.some((m) => m.competitorId === leader.competitorId),
      ).length
    : 0;
  return (
    <Verdict
      headline={`${engine} names ${self.name} in ${self.mentions} of the ${self.prompts} questions that don't already mention you.`}
    >
      {leader?.name} answers {leader?.mentions} of {leader?.prompts}, which puts you{" "}
      {ordinal(selfIdx + 1)} of the {subjects.length} brands tracked here.
      {lost > 0
        ? ` The ${lost} ${lost === 1 ? "question it wins" : "questions it wins"} and you are absent from are the shortest route to a better standing.`
        : ""}
    </Verdict>
  );
}

function Facts({
  lb,
  questions,
  stale,
  measuredAt,
}: {
  lb: AiVisibilityLeaderboard;
  questions: QuestionRow[];
  stale: boolean;
  measuredAt: string | null;
}) {
  const self = lb.subjects.find((s) => s.isSelf) ?? null;
  const selfIdx = lb.subjects.findIndex((s) => s.isSelf);
  const leader = lb.subjects[0] ?? null;
  const ranked = !!self && self.mentions > 0;
  const seeded = questions.filter((r) => r.cell?.selfSeeded).length;
  const delta =
    self && self.prevSov != null ? Math.round((self.sov - self.prevSov) * 100) : null;

  return (
    <FactStrip>
      <Fact label="Your share of voice" muted={!ranked}>
        <span className="text-xl font-semibold tracking-tight tabular-nums">
          {self ? pctOf(self.sov) : "—"}
        </span>
        {delta != null && (
          <span
            className={cn(
              "text-xs",
              delta > 0 ? "text-positive" : delta < 0 ? "text-critical" : "text-muted-foreground",
            )}
          >
            {delta === 0 ? "flat" : `${delta > 0 ? "+" : ""}${delta} pts`}
          </span>
        )}
      </Fact>
      <Fact label="Questions naming you" muted={!ranked}>
        <span className="tabular-nums">
          {self ? `${self.mentions} of ${self.prompts}` : "—"}
        </span>
        {seeded > 0 && (
          <span className="text-xs text-muted-foreground">
            {seeded === 1 ? "1 already names you" : `${seeded} already name you`}
          </span>
        )}
      </Fact>
      <Fact label="Standing" muted={!ranked}>
        {ranked ? (
          <>
            <span className="tabular-nums">#{selfIdx + 1}</span>
            <span className="text-xs text-muted-foreground">
              of {lb.subjects.length} brands tracked
            </span>
          </>
        ) : (
          "Not named"
        )}
      </Fact>
      {stale && measuredAt ? (
        <Fact label="Last measurable check" tone="warn">
          <span className="tabular-nums">{shortDate(measuredAt)}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(measuredAt), { addSuffix: true })}
          </span>
        </Fact>
      ) : (
        <Fact label="Most-named" muted={!leader || leader.mentions === 0}>
          {leader && leader.mentions > 0 ? (
            <>
              <span className="truncate">{leader.isSelf ? "You" : leader.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {pctOf(leader.sov)}
              </span>
            </>
          ) : (
            "Nobody"
          )}
        </Fact>
      )}
    </FactStrip>
  );
}

// --- The board: who the answers name. ------------------------------------------------

function Board({
  lb,
  colors,
  stale,
  measuredAt,
}: {
  lb: AiVisibilityLeaderboard;
  colors: Record<string, string>;
  stale: boolean;
  measuredAt: string | null;
}) {
  const max = lb.subjects.reduce((m, s) => Math.max(m, s.sov), 0) || 1;
  // Fixed columns, so name, share and movement line up down the list instead of
  // drifting with each brand's name length.
  const cols =
    "grid-cols-[1.25rem_minmax(0,1fr)_3.25rem_4rem] sm:grid-cols-[1.25rem_minmax(7rem,11rem)_minmax(4rem,1fr)_4.5rem_3.25rem_4.5rem]";
  return (
    <section className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <h3 className="text-content font-semibold leading-tight tracking-tight">
          Who the answers name
        </h3>
        {stale && measuredAt && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-medium" />
            as of {shortDate(measuredAt)}
          </span>
        )}
      </div>
      <div className={cn("mt-3 grid items-center gap-3 px-5 pb-2 text-xs text-muted-foreground", cols)}>
        <span />
        <span>Brand</span>
        <span className="hidden sm:block" />
        <span className="hidden text-right sm:block">Named in</span>
        <span className="text-right">Share</span>
        <span className="text-right">Change</span>
      </div>
      <ul>
        {/* Switching engine reranks the same brands, so the rows travel to their new
            standing on the competitors-list spring instead of the board reprinting. */}
        <AnimatePresence initial={false} mode="popLayout">
          {lb.subjects.map((s, i) => (
            <BoardRow
              key={s.competitorId}
              subject={s}
              rank={i + 1}
              max={max}
              color={colors[s.name] ?? "var(--muted)"}
              cols={cols}
            />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function BoardRow({
  subject: s,
  rank,
  max,
  color,
  cols,
}: {
  subject: AiVisibilitySubject;
  rank: number;
  max: number;
  color: string;
  cols: string;
}) {
  const delta = s.prevSov == null ? null : Math.round((s.sov - s.prevSov) * 100);
  return (
    <motion.li
      {...feedItemMotion}
      className={cn(
        "grid items-center gap-3 border-t border-border px-5 py-2.5 transition-colors",
        cols,
        // bg-primary is the brand accent; bg-accent in this theme is a neutral surface.
        s.isSelf ? "bg-primary/8 hover:bg-primary/12" : "hover:bg-surface-2",
      )}
    >
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {rank}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <BrandMark name={s.name} url={s.url} color={color} size={18} />
        <Link
          href={s.isSelf ? "/dashboard/products" : `/dashboard/competitors/${s.competitorId}`}
          className={cn(
            "truncate text-sm underline-offset-2 hover:underline",
            s.isSelf && "font-semibold",
          )}
        >
          {s.name}
        </Link>
        {s.isSelf && (
          <span className="shrink-0 rounded-sm bg-primary/12 px-1.5 py-0.5 text-meta font-medium text-link">
            You
          </span>
        )}
      </span>
      <span className="hidden h-1.5 overflow-hidden rounded-full bg-muted sm:block">
        <span
          className="block h-full rounded-full"
          // 0% stays empty; a non-zero share floors at 2% so the bar is still visible.
          style={{
            width: `${s.sov <= 0 ? 0 : Math.max(2, Math.round((s.sov / max) * 100))}%`,
            background: color,
            opacity: s.isSelf ? 1 : 0.55,
          }}
        />
      </span>
      <span className="hidden text-right text-dense tabular-nums text-muted-foreground sm:block">
        {s.mentions} of {s.prompts}
      </span>
      <span className="text-right text-sm font-medium tabular-nums">{pctOf(s.sov)}</span>
      <span
        className={cn(
          "text-right text-dense tabular-nums",
          delta == null || delta === 0
            ? "text-muted-foreground"
            : delta > 0
              ? "text-positive"
              : "text-critical",
        )}
      >
        {delta == null ? "new" : delta === 0 ? "flat" : `${delta > 0 ? "+" : ""}${delta} pts`}
      </span>
    </motion.li>
  );
}

// --- Buyer questions: one list, was two. ---------------------------------------------

type QuestionRow = {
  prompt: AiVisibilityPrompt;
  /** The active engine's result for this question, or null when it has never run. */
  cell: AiVisibilityCell | null;
};

// The tracked question set joined onto the last run's evidence. These used to be two
// sections printing the same sentences: "By prompt" (the results) directly above
// "Tracked prompts" (the same strings again, with the controls). The question is the
// row; the result and the controls both live on it.
//
// Ordered by what each question costs you: one a competitor answers and you don't comes
// before one you win, which comes before one nobody answers. Paused sink to the bottom.
function buildQuestions(data: AiVisibilityData, engine: string): QuestionRow[] {
  const cellByPrompt = new Map<string, AiVisibilityCell>();
  for (const row of data.breakdown) {
    const cell = row.cells.find((c) => c.engine === engine);
    if (cell) cellByPrompt.set(row.promptId, cell);
  }
  const rows: QuestionRow[] = data.prompts.map((prompt) => ({
    prompt,
    cell: cellByPrompt.get(prompt.id) ?? null,
  }));
  const bucket = (r: QuestionRow) => {
    if (!r.prompt.isActive) return 5;
    if (!r.cell) return 4;
    if (r.cell.selfSeeded) return 3;
    if (!r.cell.selfMentioned && r.cell.mentioned.length > 0) return 0;
    if (r.cell.selfMentioned) return 1;
    return 2;
  };
  return rows.sort(
    (a, b) =>
      bucket(a) - bucket(b) || (b.cell?.mentioned.length ?? 0) - (a.cell?.mentioned.length ?? 0),
  );
}

function QuestionList({
  rows,
  colors,
  selfName,
  selfUrl,
  draft,
  setDraft,
  onAdd,
  onToggle,
  onEdit,
  onRemove,
  problem,
  onDismissProblem,
}: {
  rows: QuestionRow[];
  colors: Record<string, string>;
  selfName: string | null;
  selfUrl: string | null;
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  onToggle: (id: string, isActive: boolean) => void;
  onEdit: (id: string, prompt: string) => void;
  onRemove: (id: string) => void;
  /** The last edit that failed. Sits above the list until it's retried or dismissed,
   *  next to the row that snapped back to its old value. */
  problem: PromptProblem | null;
  onDismissProblem: () => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AiVisibilityPrompt | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const iconBtn =
    "shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40";

  return (
    <section className="flex flex-col">
      <div className="flex flex-col gap-1.5 px-5 pt-5">
        <h3 className="text-content font-semibold leading-tight tracking-tight">Buyer questions</h3>
        <p className="max-w-[74ch] text-sm text-muted-foreground">
          What we put to the engines, ordered by what it costs you: the ones a competitor answers
          and you don&apos;t come first. Open one to read what the engine said.
        </p>
      </div>

      {problem && (
        <div className="px-5 pt-3">
          <Notice tone="critical" title={problem.title} onDismiss={onDismissProblem}>
            {errorConfig(problem.error).description}
          </Notice>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No questions yet. Add one below, or run a check to seed a starting set.
        </p>
      ) : (
        <ul className="mt-3">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((r) => {
              const { prompt: p, cell } = r;
              const expanded = open.has(p.id);
              const editing = editingId === p.id;
              const saveEdit = () => {
                const next = editDraft.trim();
                if (next.length >= 3 && next !== p.prompt) onEdit(p.id, next);
                setEditingId(null);
              };
              return (
                // layout="position": the row's own height is animated by the evidence
                // opening inside it, so only its place is projected.
                <motion.li key={p.id} {...feedItemMotion} layout="position" className="group border-t border-border">
                  <div className="flex items-start gap-2 pr-4 transition-colors hover:bg-surface-2">
                    {editing ? (
                      <div className="flex flex-1 items-center gap-2 py-2.5 pl-5">
                        <Input
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          className="h-8 min-w-0 flex-1"
                          aria-label="Edit question"
                        />
                        <button
                          onClick={saveEdit}
                          disabled={editDraft.trim().length < 3}
                          className={iconBtn}
                          aria-label="Save question"
                        >
                          <CheckIcon className="size-4" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className={iconBtn}
                          aria-label="Cancel edit"
                        >
                          <XIcon className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => toggleOpen(p.id)}
                          aria-expanded={expanded}
                          disabled={!cell}
                          className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-default"
                        >
                          <CaretRightIcon
                            className={cn(
                              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                              expanded && "rotate-90",
                              !cell && "opacity-0",
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block text-sm leading-snug",
                                !p.isActive && "text-muted-foreground",
                              )}
                            >
                              {p.prompt}
                            </span>
                            <MentionLine cell={cell} active={p.isActive} />
                          </span>
                        </button>
                        <span className="flex shrink-0 items-center gap-1 py-3">
                          <QuestionStatus cell={cell} active={p.isActive} />
                          <span className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <button
                              onClick={() => onToggle(p.id, !p.isActive)}
                              className={iconBtn}
                              aria-label={p.isActive ? "Pause question" : "Resume question"}
                            >
                              {p.isActive ? (
                                <PauseIcon className="size-4" />
                              ) : (
                                <PlayIcon className="size-4" />
                              )}
                            </button>
                            <button
                              onClick={() => {
                                setEditDraft(p.prompt);
                                setEditingId(p.id);
                              }}
                              className={iconBtn}
                              aria-label="Edit question"
                            >
                              <PencilIcon className="size-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(p)}
                              className={iconBtn}
                              aria-label="Remove question"
                            >
                              <TrashIcon className="size-4" />
                            </button>
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                  <AnimatePresence initial={false}>
                    {expanded && cell && (
                      <motion.div {...disclosureMotion}>
                        <QuestionEvidence
                          cell={cell}
                          colors={colors}
                          selfName={selfName}
                          selfUrl={selfUrl}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      <div className="flex gap-2 border-t border-border px-5 py-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
          placeholder="Ask the engines what your buyers ask, e.g. best CRM for startups"
          aria-label="New question"
        />
        <Button onClick={onAdd} size="sm" disabled={draft.trim().length < 3}>
          <PlusIcon className="size-4" />
          Add
        </Button>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this question?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.prompt}&rdquo; will no longer be put to the answer engines,
              and its past results leave this page.
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

// Which brands the engine named, in the order it named them. This is the reason the
// page exists and it used to be collapsed on every row.
function MentionLine({
  cell,
  active,
}: {
  cell: AiVisibilityCell | null;
  active: boolean;
}) {
  if (!active) return null;
  if (!cell) {
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        Not checked yet, it runs with the next check
      </span>
    );
  }
  if (cell.mentioned.length === 0) {
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        {cell.selfMentioned ? "No competitor named" : "Nobody named"}
      </span>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
      <span>Named:</span>
      {cell.mentioned.slice(0, 4).map((m) => (
        <span key={m.competitorId} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <BrandMark name={m.name} url={m.url} size={14} />
          <span className="text-foreground">{m.name}</span>
          {m.rank != null && <span className="tabular-nums">#{m.rank}</span>}
        </span>
      ))}
      {cell.mentioned.length > 4 && <span>+{cell.mentioned.length - 4} more</span>}
    </span>
  );
}

function QuestionStatus({ cell, active }: { cell: AiVisibilityCell | null; active: boolean }) {
  if (!active) {
    return <span className="whitespace-nowrap text-dense text-muted-foreground">Paused</span>;
  }
  if (!cell) {
    return <span className="whitespace-nowrap text-dense text-muted-foreground">Pending</span>;
  }
  if (cell.selfSeeded) {
    return (
      <span className="whitespace-nowrap text-dense text-muted-foreground">Names you already</span>
    );
  }
  if (cell.selfMentioned) {
    return (
      <span className="whitespace-nowrap text-dense font-medium text-link">
        You{cell.selfRank != null && <span className="tabular-nums"> #{cell.selfRank}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-dense text-muted-foreground">
      <span aria-hidden className="size-1.5 rounded-full border border-border-strong" />
      Not named
    </span>
  );
}

// Trailing public suffix, so a roster name stored as "capydex.fr" still marks "Capydex"
// in prose. Mirrors the worker-side mention guard (lib/ai-visibility/match.ts).
const TRAILING_TLD = /\.(com|io|app|dev|ai|co|net|org|fr|de|es|it|eu|uk|us|gg|xyz)$/i;

type ExcerptSegment = { text: string; brand: string | null };

// Split the engine's answer around every brand on the board it names, so each one can be
// marked in the colour it carries everywhere else on the page. Whole-token,
// case-insensitive, whitespace-flexible for multi-word brands; longest name first so
// "Acme CRM" wins over "Acme". A brand the prompt seeded is marked too: the mark says
// "the engine wrote this name here", which is true regardless of the share accounting.
function splitByBrand(text: string, names: string[]): ExcerptSegment[] {
  const cores = names
    .map((name) => ({ name, core: name.replace(TRAILING_TLD, "").trim() }))
    .filter((c) => c.core.length >= 2) // 1-char names are too noisy to word-match
    .sort((a, b) => b.core.length - a.core.length);
  if (cores.length === 0) return [{ text, brand: null }];

  const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const byCore = new Map(cores.map((c) => [key(c.core), c.name]));
  const pattern = cores
    .map((c) => c.core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"))
    .join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "giu");

  const out: ExcerptSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const hit = m[0];
    const at = m.index;
    if (hit === undefined || at === undefined) continue;
    const brand = byCore.get(key(hit));
    if (!brand) continue;
    if (at > last) out.push({ text: text.slice(last, at), brand: null });
    out.push({ text: hit, brand });
    last = at + hit.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), brand: null });
  return out;
}

function QuestionEvidence({
  cell,
  colors,
  selfName,
  selfUrl,
}: {
  cell: AiVisibilityCell;
  colors: Record<string, string>;
  selfName: string | null;
  selfUrl: string | null;
}) {
  // Everyone the answer named, self folded back in at its own position, so the order
  // on screen is the order the engine wrote them.
  const order = [
    ...cell.mentioned.map((m) => ({ name: m.name, url: m.url, rank: m.rank, isSelf: false })),
    ...(cell.selfMentioned && selfName
      ? [{ name: selfName, url: selfUrl, rank: cell.selfRank, isSelf: true }]
      : []),
  ].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  return (
    <div className="flex flex-col gap-3 px-5 pb-4 pl-12">
      {cell.excerpt && (
        <blockquote className="rounded-md bg-muted/40 p-3 text-dense leading-relaxed text-muted-foreground">
          {splitByBrand(cell.excerpt, Object.keys(colors)).map((seg, i) =>
            seg.brand ? (
              <mark
                key={i}
                className="rounded-[3px] px-0.5 font-medium text-foreground"
                style={{
                  background: `color-mix(in oklab, ${colors[seg.brand] ?? "var(--muted)"} 22%, transparent)`,
                }}
              >
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </blockquote>
      )}
      {order.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {order.map((m) => (
            <span
              key={m.name}
              className="inline-flex items-center gap-1.5 rounded-sm bg-surface-2 py-1 pl-1.5 pr-2 text-xs"
            >
              <BrandMark name={m.name} url={m.url} size={14} />
              <span className={cn(m.isSelf && "font-medium text-link")}>{m.name}</span>
              {m.rank != null && (
                <span className="tabular-nums text-muted-foreground">#{m.rank}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {cell.selfSeeded
          ? "This question names you, so the engine was handed the answer. It is left out of your own share, and still counts for everyone else."
          : "Position is where a brand first appears in the answer. Buyers read the first two."}
      </p>
    </div>
  );
}

function SourceFooter({ engines }: { engines: string[] }) {
  const read = engines.map(engineLabel).join(" and ");
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-5 py-3.5 text-xs text-muted-foreground">
      <span>Read weekly by {read || "Gemini"}, using live web search.</span>
      {!engines.includes("perplexity") && (
        <>
          <span aria-hidden>·</span>
          <span>Perplexity adds a second engine on Business.</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span>A question that already names a brand is excluded from that brand&apos;s share.</span>
    </div>
  );
}

// --- Problems, said once and left on screen. -----------------------------------------

/** How a "Run now" ended, when it didn't end with results. */
type RunProblem =
  | { kind: "start"; error: unknown }
  | { kind: "failed" }
  | { kind: "empty" };

/** A question-editor action that didn't go through, with the context of which one. */
type PromptProblem = { title: string; error: unknown };

/**
 * One shape for every problem this page reports.
 *
 * These were toasts. A toast is the wrong carrier here: an AI Visibility run resolves on
 * a worker about a minute after the click, so the message routinely fired at a reader who
 * had moved on, and the page it described went back to looking healthy. Whatever went
 * wrong now stays where the numbers it invalidates are, until it's retried or dismissed.
 */
function Notice({
  tone = "warn",
  title,
  children,
  action,
  onDismiss,
}: {
  /** `critical` for something that failed, `warn` for something that is merely partial. */
  tone?: "warn" | "critical";
  title: string;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void; icon?: IconComponent };
  onDismiss?: () => void;
}) {
  const critical = tone === "critical";
  const ActionIcon = action?.icon;
  return (
    <div
      // A failure follows a click and has to interrupt; a partial read is context.
      role={critical ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3",
        critical ? "border-critical/25 bg-critical/8" : "border-border bg-card",
      )}
    >
      <WarningIcon
        className={cn("mt-0.5 size-4 shrink-0", critical ? "text-critical" : "text-medium")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-dense leading-relaxed text-muted-foreground">{children}</p>
      </div>
      {action && (
        <Button onClick={action.onClick} size="sm" variant="outline" className="shrink-0">
          {ActionIcon && <ActionIcon className="size-4" />}
          {action.label}
        </Button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

// The three ways a run fails, kept apart because they don't resolve the same way: one
// never left the browser, one died on the worker, one reached out and got nothing back.
function RunProblemNotice({
  problem,
  onRetry,
  onDismiss,
}: {
  problem: RunProblem;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const copy =
    problem.kind === "start"
      ? {
          title: "Couldn't start the check",
          body: errorConfig(problem.error).description,
        }
      : problem.kind === "failed"
        ? {
            title: "The last check stopped before it finished",
            body: "It wrote no results, so the numbers below are unchanged. Try again in a moment.",
          }
        : {
            title: "The last check couldn't reach the answer engine",
            body: "No results came back, so the numbers below are unchanged. This is usually a temporary engine or quota issue, so try again in a moment.",
          };
  return (
    <Notice
      tone="critical"
      title={copy.title}
      action={{ label: "Try again", onClick: onRetry, icon: PlayIcon }}
      onDismiss={onDismiss}
    >
      {copy.body}
    </Notice>
  );
}

// A run outlives the page that started it (~a minute on a worker), so the one in flight is
// parked in sessionStorage: coming back to the page resumes the poll and settles into the
// same notice. Per tab, and dropped as soon as the run resolves either way.
const RUN_KEY = "outrival.ai-visibility.run";
type ParkedRun = { runId: string | null; baseline: string | null; deadline: number };

function parkRun(run: ParkedRun) {
  // Storage can be denied (private mode, blocked cookies). Losing the resume is a
  // downgrade to today's behaviour, never a reason to fail the run.
  try {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    /* no session storage — the run still polls for as long as the page is open */
  }
}

function readParkedRun(): ParkedRun | null {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ParkedRun;
    return typeof parsed?.deadline === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function clearParkedRun() {
  try {
    sessionStorage.removeItem(RUN_KEY);
  } catch {
    /* nothing was parked */
  }
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
        <EyeIcon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">No visibility data yet</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        Run a check to see whether ChatGPT, Perplexity &amp; co. mention your product, and
        which competitors show up instead.
      </p>
      <Button onClick={onRun} disabled={running} size="sm" className="mt-5">
        {running ? <SpinnerIcon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
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
      <SpinnerIcon className="mt-0.5 size-4 shrink-0 animate-spin text-link" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {landing ? "Results are landing…" : "Checking AI answer engines…"}
        </p>
        <p className="text-dense text-muted-foreground">
          {landing
            ? "Fresh mentions are streaming in as each engine responds."
            : "We're asking Gemini and Perplexity your tracked questions. This usually takes about a minute."}
        </p>
      </div>
    </div>
  );
}

// The SCHEDULED check came back naming nobody, so the board below is the last standing
// we could measure. Without this the page presented an engine outage as a verdict: a
// wall of 0% beside a trend chart that (correctly) skips runs carrying no answers.
function StaleRunNotice({
  measuredAt,
  attemptedAt,
  engine,
  onRetry,
}: {
  measuredAt: string;
  attemptedAt: string;
  engine: string;
  onRetry: () => void;
}) {
  return (
    <Notice
      tone="warn"
      title={`The check on ${shortDate(attemptedAt)} came back with nobody named`}
      action={{ label: "Check again", onClick: onRetry, icon: PlayIcon }}
    >
      {engine} answered but named none of the brands tracked here, including ones it named on{" "}
      {shortDate(measuredAt)}. That points at the engine or its free quota rather than at your
      visibility, so the standing below is the last one we could measure.
    </Notice>
  );
}

function LoadingState() {
  return (
    <Shell>
      <div className="h-8 w-48 animate-pulse rounded bg-muted/40" />
      <div className="h-[420px] w-full animate-pulse rounded-lg bg-muted/30" />
    </Shell>
  );
}

function LockedState() {
  return (
    <Shell>
      <div className="mx-auto mt-8 flex max-w-md flex-col items-center rounded-md border border-border bg-card px-6 py-14 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted/60">
          <LockIcon className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">AI Visibility</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Track whether ChatGPT, Perplexity and other AI answer engines mention your product
          and which competitors show up instead. Available on Pro and Business.
        </p>
        <Button asChild size="sm" className="mt-5">
          <Link href="/dashboard/settings/billing">Upgrade</Link>
        </Button>
      </div>
    </Shell>
  );
}
