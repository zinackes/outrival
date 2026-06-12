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

export type AskEmit = (ev: AskEvent) => Promise<void> | void;

export async function runAskAgent(
  orgId: string,
  question: string,
  emit: AskEmit,
): Promise<void> {
  try {
    await emit({ type: "status", phase: "planning" });

    // Roster for name→id resolution, bounded by the plan's max competitors.
    const list = (await getAskTool("listCompetitors")!.run(orgId, {})) as {
      competitors: AskRosterEntry[];
    };
    const roster = list.competitors ?? [];

    const planRaw = await complete(AI_CONFIG.classificationFast, {
      prompt: buildAskPlanPrompt(question, ASK_TOOL_SPECS, roster),
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
      prompt: buildAskSynthesisPrompt(question, results),
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
      const competitorIds = new Set(roster.map((r) => r.id));
      const signalIds = new Set<string>();
      for (const { result } of results) {
        const sigs = (result as { signals?: Array<{ id?: unknown }> }).signals;
        if (Array.isArray(sigs)) {
          for (const s of sigs) if (typeof s.id === "string") signalIds.add(s.id);
        }
      }
      const citations = answer.value.citations.filter((c) =>
        c.type === "competitor" ? competitorIds.has(c.id) : signalIds.has(c.id),
      );
      await emit({ type: "answer", answer: answer.value.answer, citations });
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
