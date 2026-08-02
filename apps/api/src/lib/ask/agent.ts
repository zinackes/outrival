import {
  complete,
  withAiContext,
  AI_CONFIG,
  safeParseJson,
  AskPlanSchema,
  AskAnswerSchema,
  buildAskPlanPrompt,
  buildAskSynthesisPrompt,
  AIUnavailableError,
  type AskRosterEntry,
} from "@outrival/ai";
import { ASK_TOOL_SPECS, getAskTool } from "./tools";
import { logAskRun } from "../ai-runs";
import { persistAskHistory } from "./history";

// The page the user asked from, used to scope the answer. `label` is human-readable
// (shown in the UI chip too); `competitorId` is set when the page is about a specific
// competitor so the planner can resolve an ambiguous question to it.
export interface AskPageContext {
  label: string;
  competitorId?: string;
}

// The Ask Outrival agent: a bounded two-pass loop. (1) a FAST model plans which
// org-scoped tools to call (name→id resolved against the roster we inject), (2) the
// API runs each named tool with orgId from the session, (3) a 70b model synthesises a
// grounded English answer over the results. Progress is streamed via `emit` so the UI
// shows the work. Single-pass plan (no agentic re-planning) — enough for the v1
// questions; the synthesis refuses cleanly when the results don't cover the question.

export type AskEvent =
  | { type: "status"; phase: "planning" | "running" | "synthesizing" }
  | { type: "tool"; name: string }
  // `grounded: false` marks the parse-miss fallback copy (never persisted); the
  // standing-query re-evaluation must not mistake it for a real empty answer.
  | { type: "answer"; answer: string; citations: AskCitation[]; grounded?: boolean }
  | { type: "error"; message: string }
  | { type: "done" };

interface AskCitation {
  type: "competitor" | "signal";
  id: string;
  label: string;
}

// The synthesis is told to keep ids out of the prose, but a 70b model still slips
// bracketed citation markers (e.g. "[e070419f-...]") into the answer academic-style.
// Strip them defensively so the user never sees raw UUIDs — the ids it relied on are
// already surfaced as "Sources" chips from the citations array.
const INLINE_ID_MARKER =
  /\s*\[\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\s*,\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*\s*\]/gi;

function stripInlineIds(text: string): string {
  return text.replace(INLINE_ID_MARKER, "").trimEnd();
}

export type AskEmit = (ev: AskEvent) => Promise<void> | void;

export interface AskRunOptions {
  // Standing-query re-evaluations run the same agent headlessly; they must not
  // land in the user's "Recent questions" list. Default true (interactive path).
  persistHistory?: boolean;
}

export function runAskAgent(
  orgId: string,
  userId: string,
  question: string,
  context: AskPageContext | null,
  emit: AskEmit,
  options?: AskRunOptions,
): Promise<void> {
  // withAiContext spans both passes AND their log sites. Bun (the API runtime)
  // drops the lazy child-frame enterWith complete() falls back on, so without
  // this every ask row in ai_runs carried 0 tokens and a static model label.
  // interactive: someone typed this question and is watching the answer stream in.
  // It draws on the share of each provider's per-minute budget the hourly fan-out
  // is held back from, so a click never queues behind a thousand cron-seeded jobs.
  return withAiContext(() => runAsk(orgId, userId, question, context, emit, options), {
    interactive: true,
  });
}

async function runAsk(
  orgId: string,
  userId: string,
  question: string,
  context: AskPageContext | null,
  emit: AskEmit,
  options?: AskRunOptions,
): Promise<void> {
  // Flatten the page context into one line injected into both prompts.
  const contextStr = context
    ? `The user is currently viewing: ${context.label}.${
        context.competitorId ? ` (competitor id: ${context.competitorId})` : ""
      }`
    : undefined;
  try {
    await emit({ type: "status", phase: "planning" });

    // Roster for name→id resolution, bounded by the plan's max competitors.
    const list = (await getAskTool("listCompetitors")!.run(orgId, {})) as {
      competitors: AskRosterEntry[];
    };
    const roster = list.competitors ?? [];

    const planRaw = await complete(AI_CONFIG.classificationFast, {
      prompt: buildAskPlanPrompt(question, ASK_TOOL_SPECS, roster, contextStr),
      json: true,
    });
    const plan = safeParseJson(planRaw, AskPlanSchema);
    await logAskRun(AI_CONFIG.classificationFast.model, plan.ok ? "success" : "parse_failed", {
      orgId,
    });
    const calls = plan.ok ? plan.value.calls : [];

    await emit({ type: "status", phase: "running" });
    const results: Array<{ tool: string; result: unknown }> = [];
    for (const call of calls) {
      const tool = getAskTool(call.tool);
      if (!tool) continue; // unknown tool from the model → ignore (no arbitrary exec)
      await emit({ type: "tool", name: tool.name });
      results.push({ tool: tool.name, result: await tool.run(orgId, call.args) });
    }

    await emit({ type: "status", phase: "synthesizing" });
    const synthRaw = await complete(AI_CONFIG.insights, {
      prompt: buildAskSynthesisPrompt(question, results, contextStr),
      json: true,
      maxTokens: 1024,
    });
    const answer = safeParseJson(synthRaw, AskAnswerSchema);
    await logAskRun(AI_CONFIG.insights.model, answer.ok ? "success" : "parse_failed", { orgId });

    if (answer.ok) {
      // Re-validate citations server-side: the synthesis is told to cite only ids
      // it saw, but nothing forces it. Keep competitor ids that exist in the org
      // roster and signal ids that appeared in the tool results — a hallucinated or
      // foreign id is dropped rather than shipped to the UI as a dead/leaky link.
      const competitorNames = new Map(roster.map((r) => [r.id, r.name]));
      const signalIds = new Set<string>();
      for (const { result } of results) {
        const sigs = (result as { signals?: Array<{ id?: unknown }> }).signals;
        if (Array.isArray(sigs)) {
          for (const s of sigs) if (typeof s.id === "string") signalIds.add(s.id);
        }
      }
      let citations = answer.value.citations
        .filter((c) =>
          c.type === "competitor" ? competitorNames.has(c.id) : signalIds.has(c.id),
        )
        // Trust the model for the id (validated above) but not the label: the synthesis
        // prompt's example uses "Linear" as a placeholder and the model copies it
        // verbatim. Derive the competitor label from the roster instead.
        .map((c) =>
          c.type === "competitor" ? { ...c, label: competitorNames.get(c.id)! } : c,
        );
      // Deterministic fallback: the synthesis regularly omits citations even when it
      // clearly grounded on tool data (observed in prod: a tech-stack-grounded answer
      // shipped with zero Sources chips). The plan itself knows which competitors
      // were consulted — cite those, so the chips never come back empty when tools
      // actually ran on someone.
      if (citations.length === 0) {
        const consulted = new Set<string>();
        for (const call of calls) {
          const cid = call.args.competitorId;
          if (typeof cid === "string" && competitorNames.has(cid)) consulted.add(cid);
          const ids = call.args.ids;
          if (Array.isArray(ids)) {
            for (const id of ids) {
              if (typeof id === "string" && competitorNames.has(id)) consulted.add(id);
            }
          }
        }
        citations = [...consulted]
          .slice(0, 12)
          .map((id) => ({ type: "competitor" as const, id, label: competitorNames.get(id)! }));
      }
      const cleanAnswer = stripInlineIds(answer.value.answer);
      await emit({ type: "answer", answer: cleanAnswer, citations, grounded: true });
      // Persist only real answers (best-effort) — the fallback below isn't worth logging.
      if (options?.persistHistory !== false) {
        void persistAskHistory({
          orgId,
          userId,
          question,
          answer: cleanAnswer,
          citations,
          context,
        });
      }
    } else {
      await emit({
        type: "answer",
        answer:
          "I couldn't produce a grounded answer for that. Try rephrasing, or name a specific competitor.",
        citations: [],
        grounded: false,
      });
    }
    await emit({ type: "done" });
  } catch (err) {
    await logAskRun(AI_CONFIG.insights.model, "error", { orgId });
    const message =
      err instanceof AIUnavailableError
        ? "AI is temporarily unavailable. Please try again in a moment."
        : "Something went wrong answering that. Please try again.";
    await emit({ type: "error", message });
  }
}
