"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// Severity-classification feedback (patch-21, point e). A discreet control under
// the severity badge: tell us the AI rated it too high/low → writes a severity
// override on the signal. Optional, never required.
export function SeverityFeedback({
  signalId,
  className,
}: {
  signalId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (reason: "too_high_severity" | "too_low_severity") => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.submitQualityFeedback({
        targetType: "severity_classification",
        targetId: signalId,
        verdict: "not_useful",
        reason,
      });
      setOpen(false);
      setDone(true);
      if (res.immediateAction) toast(res.immediateAction.description);
    } catch {
      toast.error("Couldn't adjust severity. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className={cn("text-[11px] text-text-subtle", className)}>
        Severity adjusted
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] text-text-subtle transition-colors hover:text-foreground",
          className,
        )}
      >
        <SlidersHorizontal size={11} />
        Adjust severity
      </button>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", className)}>
      <span className="text-text-subtle">Severity is</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => submit("too_high_severity")}
        className="rounded border border-border px-1.5 py-0.5 text-text-subtle hover:border-border-strong hover:text-foreground disabled:opacity-50"
      >
        too high
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => submit("too_low_severity")}
        className="rounded border border-border px-1.5 py-0.5 text-text-subtle hover:border-border-strong hover:text-foreground disabled:opacity-50"
      >
        too low
      </button>
    </span>
  );
}
