"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { api } from "@/lib/api";

export interface ReviewIssue {
  type: string;
  description: string;
  affectedAssertion: string;
}

export interface ReviewCitation {
  assertion: string;
  sourceQuote: string;
}

export interface ReviewClaim {
  claim: { text: string; citedQuote: string };
  status: string;
  reason: string | null;
}

export interface ReviewFaithfulness {
  verdict: "pass" | "blocked" | "skipped";
  ratio: number;
  unfaithfulClaims: ReviewClaim[];
  reason: string | null;
  /** The refused claims were deleted and the rest re-verified clean, so it shipped. */
  repaired?: boolean;
}

export interface ReviewItem {
  id: string;
  aiTask: string;
  targetType: string;
  targetId: string | null;
  orgId: string | null;
  confidence: string | null;
  citations: ReviewCitation[] | null;
  groundingValidation: { score?: number; failedCitations?: ReviewCitation[] } | null;
  selfCheckResult: { passed?: boolean; issues?: ReviewIssue[]; reviewerConfidence?: string } | null;
  selfCheckTriggeredBy: string | null;
  faithfulness: ReviewFaithfulness | null;
  flaggedAt: string | null;
  createdAt: string;
}

export function ReviewQueueView({ items }: { items: ReviewItem[] }) {
  const [list, setList] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = async (id: string, resolution: "false_positive" | "hallucination_confirmed") => {
    setBusy(id);
    try {
      await api.adminResolveAiReview(id, resolution);
      setList((l) => l.filter((it) => it.id !== id));
      toast(resolution === "false_positive" ? "Marked correct." : "Hallucination confirmed.");
    } catch {
      toast.error("Couldn't resolve. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (list.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">Nothing to review. The queue is clear.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {list.map((it) => {
        const issues = it.selfCheckResult?.issues ?? [];
        const failed = it.groundingValidation?.failedCitations ?? [];
        const blocked = it.faithfulness?.verdict === "blocked" ? it.faithfulness : null;
        return (
          <div key={it.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-foreground">{it.aiTask}</span>
              <span className="text-xs text-muted-foreground">
                {it.targetType}
                {it.targetId ? ` · ${it.targetId.slice(0, 8)}` : ""}
              </span>
              {it.confidence && (
                <span className="rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground">
                  confidence: {it.confidence}
                </span>
              )}
              {it.selfCheckTriggeredBy && (
                <span className="text-meta text-text-subtle">via {it.selfCheckTriggeredBy}</span>
              )}
              {blocked && (
                <span
                  className="rounded-full border px-2 py-0.5 text-meta"
                  style={
                    blocked.repaired
                      ? { borderColor: "var(--medium)", color: "var(--medium)" }
                      : { borderColor: "var(--critical)", color: "var(--critical)" }
                  }
                >
                  {blocked.repaired ? "Claims removed, rest published" : "Not published"} ·{" "}
                  <span className="tabular-nums">{blocked.ratio.toFixed(2)}</span> supported
                </span>
              )}
              <span className="ml-auto text-meta text-text-subtle">
                {it.flaggedAt ? new Date(it.flaggedAt).toLocaleString() : ""}
              </span>
            </div>

            {blocked && blocked.unfaithfulClaims.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {blocked.unfaithfulClaims.map((c, i) => (
                  <li key={i} className="text-dense">
                    <span className="font-medium text-medium">unsupported claim</span>
                    {c.reason && <span className="text-muted-foreground">: {c.reason}</span>}
                    <span className="block text-xs text-text-subtle">“{c.claim.text}”</span>
                  </li>
                ))}
              </ul>
            )}

            {issues.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {issues.map((iss, i) => (
                  <li key={i} className="text-dense">
                    <span className="font-medium text-medium">{iss.type}</span>
                    <span className="text-muted-foreground">: {iss.description}</span>
                    {iss.affectedAssertion && (
                      <span className="block text-xs text-text-subtle">
                        “{iss.affectedAssertion}”
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {failed.length > 0 && (
              <p className="mt-2 text-xs text-text-subtle">
                {failed.length} ungrounded citation{failed.length > 1 ? "s" : ""}:{" "}
                {failed.map((cit) => `“${cit.sourceQuote.slice(0, 60)}”`).join(", ")}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy === it.id}
                onClick={() => resolve(it.id, "false_positive")}
                className="rounded border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:border-border-strong disabled:opacity-50"
              >
                Mark correct
              </button>
              <button
                type="button"
                disabled={busy === it.id}
                onClick={() => resolve(it.id, "hallucination_confirmed")}
                className="rounded border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
                style={{ borderColor: "var(--critical)", color: "var(--critical)" }}
              >
                Confirm hallucination
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
