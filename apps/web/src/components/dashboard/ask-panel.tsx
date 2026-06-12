"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
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

const EXAMPLES = [
  "What changed across my competitors this month?",
  "Who is hiring the most right now?",
  "Summarize the critical signals from the past week.",
  "What are the most common complaints in competitor reviews?",
];

function citationHref(c: Citation): string {
  return c.type === "competitor" ? `/dashboard/competitors/${c.id}` : "/dashboard/signals";
}

export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<string[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
          className="resize-none"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-meta text-muted-foreground">⌘/Ctrl + Enter to send</span>
          <Button type="submit" disabled={loading || !question.trim()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Ask
          </Button>
        </div>
      </form>

      {!answer && !loading && !error && (
        <div className="mt-8">
          <p className="text-meta uppercase tracking-wide text-muted-foreground">Try asking</p>
          <div className="mt-3 flex flex-col gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setQuestion(ex);
                  void ask(ex);
                }}
                className="rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {(loading || trace.length > 0) && !answer && (
        <ul className="mt-6 flex flex-col gap-1.5">
          {trace.map((step, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
              {loading && i === trace.length - 1 ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <span className="size-1.5 rounded-full bg-[var(--link)]" />
              )}
              {step}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <Card className="mt-6 border-destructive/40 p-4 text-sm text-foreground">{error}</Card>
      )}

      {answer && (
        <Card className="mt-6 p-5">
          <p className="whitespace-pre-wrap text-content leading-relaxed text-foreground">
            {answer}
          </p>
          {citations.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-meta uppercase tracking-wide text-muted-foreground">Sources</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {citations.map((c) => (
                  <Link
                    key={`${c.type}-${c.id}`}
                    href={citationHref(c)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-dense text-foreground transition-colors hover:bg-accent"
                  >
                    {c.label}
                    <ArrowUpRight className="size-3 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
