import { askHistory, type AskHistoryCitation, type AskHistoryContext } from "@outrival/db";
import { db } from "../db";

// Best-effort persistence of one Ask exchange, modelled on logAskRun: a failure here
// must never break the answer stream. Called after the answer is emitted, only for
// questions that produced a real (parsed) answer. Scoped per (org, user).
export async function persistAskHistory(params: {
  orgId: string;
  userId: string;
  question: string;
  answer: string;
  citations: AskHistoryCitation[];
  context: AskHistoryContext | null;
}): Promise<void> {
  try {
    await db.insert(askHistory).values({
      orgId: params.orgId,
      userId: params.userId,
      question: params.question,
      answer: params.answer,
      citations: params.citations,
      context: params.context,
    });
  } catch {
    // ask_history is a convenience log, never load-bearing — swallow.
  }
}
