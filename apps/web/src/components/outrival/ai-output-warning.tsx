"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// Visible warning on an AI output that failed its self-check (patch-24, layer 4).
// The content stays rendered below it — transparency, not silent removal. The two
// actions reuse the patch-21 feedback loop. 3-part message: what · why · what to do.
type WarnTargetType = "signal" | "battle_card" | "digest";

interface AiOutputWarningProps {
  targetType: WarnTargetType;
  targetId: string;
  /** Called after the user acknowledges, so the parent can hide the warning. */
  onResolved?: () => void;
  className?: string;
}

const LABEL: Record<WarnTargetType, string> = {
  signal: "insight",
  battle_card: "battle card",
  digest: "digest",
};

export function AiOutputWarning({ targetType, targetId, onResolved, className }: AiOutputWarningProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"reported" | "confirmed" | null>(null);

  const report = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.submitQualityFeedback({ targetType, targetId, verdict: "not_useful", reason: "incorrect" });
      setDone("reported");
      toast("Thanks — flagged as inaccurate. We'll review it.");
    } catch {
      toast.error("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all([
        api.submitQualityFeedback({ targetType, targetId, verdict: "useful" }),
        api.acknowledgeAiQuality(targetType, targetId),
      ]);
      setDone("confirmed");
      toast("Thanks — marked as verified.");
      onResolved?.();
    } catch {
      toast.error("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done === "confirmed") return null;

  return (
    <div
      role="alert"
      className={cn(
        "mb-4 rounded-md border border-medium/40 bg-medium/10 px-3.5 py-3 text-dense",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-medium" />
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">
            This {LABEL[targetType]} couldn&apos;t be fully verified
          </p>
          <p className="text-muted-foreground">
            Our automatic check found parts that may not be fully supported by the source, so we
            flagged it for review. The content is shown below — use it with care.
          </p>
          {done === "reported" ? (
            <p className="text-text-subtle">Reported. Thanks for helping us improve.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <button
                type="button"
                disabled={busy}
                onClick={report}
                className="rounded border border-border px-2 py-1 text-xs text-foreground transition-colors hover:border-border-strong disabled:opacity-50"
              >
                Report as inaccurate
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirm}
                className="rounded border border-border px-2 py-1 text-xs text-foreground transition-colors hover:border-border-strong disabled:opacity-50"
              >
                I checked, it&apos;s fine
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
