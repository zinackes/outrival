import {
  complete,
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
  | { type: "answer"; answer: string; citations: AskCitation[] }
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

export async function runAskAgent(
  orgId: string,
  userId: string,
  question: string,
  context: AskPageContext | null,
  emit: AskEmit,
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
    await logAskRun(AI_CONFIG.classificationFast.model, plan.ok ? "success" : "parse_failed");
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
    await logAskRun(AI_CONFIG.insights.model, answer.ok ? "success" : "parse_failed");

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
      const citations = answer.value.citations
        .filter((c) =>
          c.type === "competitor" ? competitorNames.has(c.id) : signalIds.has(c.id),
        )
        // Trust the model for the id (validated above) but not the label: the synthesis
        // prompt's example uses "Linear" as a placeholder and the model copies it
        // verbatim. Derive the competitor label from the roster instead.
        .map((c) =>
          c.type === "competitor" ? { ...c, label: competitorNames.get(c.id)! } : c,
        );
      const cleanAnswer = stripInlineIds(answer.value.answer);
      await emit({ type: "answer", answer: cleanAnswer, citations });
      // Persist only real answers (best-effort) — the fallback below isn't worth logging.
      void persistAskHistory({
        orgId,
        userId,
        question,
        answer: cleanAnswer,
        citations,
        context,
      });
    } else {
      await emit({
        type: "answer",
        answer:
          "I couldn't produce a grounded answer for that. Try rephrasing, or name a specific competitor.",
        citations: [],
      });
    }
    await emit({ type: "done" });
  } catch (err) {
    await logAskRun(AI_CONFIG.insights.model, "error");
    const message =
      err instanceof AIUnavailableError
        ? "AI is temporarily unavailable. Please try again in a moment."
        : "Something went wrong answering that. Please try again.";
    await emit({ type: "error", message });
  }
}
