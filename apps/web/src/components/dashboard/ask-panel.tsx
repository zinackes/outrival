"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  CornerDownLeft,
  DollarSign,
  GitCompare,
  Loader2,
  MessageSquare,
  Package,
  Sparkles,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PageHead } from "./page-head";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Citation {
  type: "competitor" | "signal";
  id: string;
  label: string;
}

// SSE event shapes mirror apps/api/src/lib/ask/agent.ts AskEvent.
type AskEvent =
  | { type: "status"; phase: "planning" | "running" | "synthesizing" }
  | { type: "tool"; name: string }
  | { type: "answer"; answer: string; citations: Citation[] }
  | { type: "error"; message: string }
  | { type: "done" };

const TOOL_LABEL: Record<string, string> = {
  listCompetitors: "Listing competitors",
  getSignals: "Reading signals",
  getPricingHistory: "Checking pricing",
  getJobTrends: "Checking hiring",
  getReviewThemes: "Reading reviews",
  getTechStackChanges: "Checking tech stack",
  compareCompetitors: "Comparing competitors",
};

const PHASE_LABEL: Record<string, string> = {
  planning: "Planning the answer",
  running: "Gathering data",
  synthesizing: "Writing the answer",
};

// Starter prompts come from GET /api/ask/suggestions — deterministic, AI-free, adapted
// to the org's active competitors and rotated daily (server keeps the same set within a
// day). The server sends only { q, kind }; the kind maps here to a leading glyph + tint
// so it doubles as wayfinding (the product's own category color system), not decoration.
type SuggestionKind = "activity" | "pricing" | "hiring" | "reviews" | "product" | "compare";
interface Suggestion {
  q: string;
  kind: SuggestionKind;
}

const KIND_META: Record<SuggestionKind, { icon: LucideIcon; tint: string }> = {
  activity: { icon: Activity, tint: "var(--link)" },
  pricing: { icon: DollarSign, tint: "var(--cat-pricing)" },
  hiring: { icon: Users, tint: "var(--cat-hiring)" },
  reviews: { icon: MessageSquare, tint: "var(--cat-reviews)" },
  product: { icon: Package, tint: "var(--cat-product)" },
  compare: { icon: GitCompare, tint: "var(--link)" },
};

// Shown while the fetch is in flight and if it fails or returns nothing.
const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { q: "What changed across my competitors this month?", kind: "activity" },
  { q: "Who is hiring the most right now?", kind: "hiring" },
  { q: "How has competitor pricing shifted this quarter?", kind: "pricing" },
  { q: "What are the most common complaints in competitor reviews?", kind: "reviews" },
];

function citationHref(c: Citation): string {
  return c.type === "competitor" ? `/dashboard/competitors/${c.id}` : "/dashboard/signals";
}

/** Terminal-style stepper: a connected sequence of the agent's work. */
function Steps({ steps, active }: { steps: string[]; active: boolean }) {
  return (
    <ol className="relative flex flex-col gap-2.5">
      {steps.length > 1 && (
        <span aria-hidden className="absolute top-2 bottom-2 left-[7px] w-px bg-border" />
      )}
      {steps.map((step, i) => {
        const running = active && i === steps.length - 1;
        return (
          <li
            key={i}
            className="relative flex items-center gap-2.5 duration-200 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-1"
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {running ? (
                <Loader2 className="size-3.5 animate-spin text-[var(--link)]" />
              ) : (
                <span className="size-1.5 rounded-full bg-[var(--link)] ring-2 ring-[var(--surface)]" />
              )}
            </span>
            <span className={running ? "text-dense text-foreground" : "text-dense text-muted-foreground"}>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<string[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(DEFAULT_SUGGESTIONS);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setIsMac(/mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    // Suggestions are stable within a day (server rotates by UTC epoch-day), so cache
    // them per-day in sessionStorage and skip the round-trip on re-navigation. The key
    // carries the day, so a stale entry auto-invalidates the next morning.
    const today = Math.floor(Date.now() / 86_400_000);
    const KEY = "ask:suggestions";

    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { day?: number; suggestions?: Suggestion[] };
        if (cached.day === today && cached.suggestions && cached.suggestions.length > 0) {
          setSuggestions(cached.suggestions);
          return; // fresh for today — no fetch
        }
      }
    } catch {
      /* unreadable cache — fall through to fetch */
    }

    const ctrl = new AbortController();
    fetch(`${BASE}/api/ask/suggestions`, { credentials: "include", signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ suggestions?: Suggestion[] }>) : null))
      .then((d) => {
        const list = d?.suggestions?.filter(
          (s) => s && typeof s.q === "string" && s.kind in KIND_META,
        );
        if (list && list.length > 0) {
          setSuggestions(list);
          try {
            sessionStorage.setItem(KEY, JSON.stringify({ day: today, suggestions: list }));
          } catch {
            /* storage unavailable — non-fatal */
          }
        }
      })
      .catch(() => {
        /* keep the static defaults */
      });
    return () => ctrl.abort();
  }, []);

  function handleEvent(ev: AskEvent) {
    if (ev.type === "status") setTrace((t) => [...t, PHASE_LABEL[ev.phase] ?? ev.phase]);
    else if (ev.type === "tool") setTrace((t) => [...t, TOOL_LABEL[ev.name] ?? ev.name]);
    else if (ev.type === "answer") {
      setAnswer(ev.answer);
      setCitations(ev.citations ?? []);
    } else if (ev.type === "error") setError(ev.message);
  }

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setTrace([]);
    setAnswer(null);
    setCitations([]);
    setError(null);
    setCopied(false);

    try {
      const res = await fetch(`${BASE}/api/ask`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        setError(
          res.status === 429
            ? "You've reached the limit of 10 questions per hour. Try again later."
            : res.status === 401
              ? "Your session expired. Please sign in again."
              : "Couldn't reach the assistant. Please try again.",
        );
        return;
      }

      // SSE over a POST stream (EventSource can't POST): read frames split by \n\n,
      // parse the `data:` line of each as one AskEvent.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            handleEvent(JSON.parse(dataLine.slice(5).trim()) as AskEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError("Network error — could not reach the assistant. Check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }

  function copyAnswer() {
    if (!answer) return;
    void navigator.clipboard?.writeText(answer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHead
        title="Ask"
        icon={<Sparkles className="size-5 text-[var(--link)]" />}
        sub="Ask anything about your tracked competitors — answered from your own data."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <div className="rounded-lg border border-border bg-surface shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void ask(question);
              }
            }}
            placeholder="e.g. What changed in Linear's pricing this quarter?"
            rows={3}
            autoFocus
            className="min-h-[5rem] resize-none border-0 bg-transparent px-4 pt-3.5 pb-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-3 px-3 pt-2 pb-3">
            <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center rounded border border-border bg-surface-2 px-1.5 font-mono text-meta font-medium">
                {mod}
              </kbd>
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center rounded border border-border bg-surface-2 px-1.5 font-mono text-meta font-medium">
                ↵
              </kbd>
              <span className="hidden sm:inline">to send</span>
            </span>
            <Button type="submit" disabled={loading || !question.trim()}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Ask
            </Button>
          </div>
        </div>
      </form>

      {!answer && !loading && !error && (
        <div className="mt-8 duration-300 motion-safe:animate-in motion-safe:fade-in">
          <p className="text-dense font-medium text-muted-foreground">Start with a question</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {suggestions.map(({ q, kind }) => {
              const { icon: Icon, tint } = KIND_META[kind];
              return (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuestion(q);
                  void ask(q);
                }}
                className="group flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-3 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Icon className="size-4 shrink-0" style={{ color: tint }} aria-hidden />
                <span className="flex-1 text-sm text-foreground">{q}</span>
                <CornerDownLeft
                  className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden
                />
              </button>
              );
            })}
          </div>
        </div>
      )}

      {(loading || trace.length > 0) && !answer && (
        <div className="mt-6">
          <Steps steps={trace} active={loading} />
        </div>
      )}

      {error && (
        <Card className="mt-6 flex items-start gap-3 border-destructive/40 p-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="flex-1">
            <p className="text-sm text-foreground">{error}</p>
            {question.trim() && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void ask(question)}
                disabled={loading}
              >
                Try again
              </Button>
            )}
          </div>
        </Card>
      )}

      {answer && (
        <div className="duration-300 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
          {trace.length > 0 && (
            <details className="group mt-6">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-meta text-muted-foreground transition-colors hover:text-foreground">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />
                <span className="font-mono">{trace.length}</span> steps to answer
              </summary>
              <div className="mt-3 pl-1">
                <Steps steps={trace} active={false} />
              </div>
            </details>
          )}

          <Card className="mt-3 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-dense font-medium text-foreground">
                <span className="size-1.5 rounded-full bg-[var(--link)]" aria-hidden />
                Answer
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={copyAnswer}
                aria-label={copied ? "Copied" : "Copy answer"}
                title={copied ? "Copied" : "Copy answer"}
              >
                {copied ? (
                  <Check className="size-3.5 text-[var(--positive)]" />
                ) : (
                  <Copy className="size-3.5 text-muted-foreground" />
                )}
              </Button>
            </div>

            <p className="text-content leading-relaxed whitespace-pre-wrap text-foreground">{answer}</p>

            {citations.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-dense font-medium text-muted-foreground">Sources</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {citations.map((c) => (
                    <Link
                      key={`${c.type}-${c.id}`}
                      href={citationHref(c)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-dense text-foreground transition-colors hover:border-border-strong hover:bg-surface-3"
                    >
                      {c.label}
                      <ArrowUpRight className="size-3 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
