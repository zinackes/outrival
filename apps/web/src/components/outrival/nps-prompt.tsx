"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type QualityFeedbackVerdict } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Periodic NPS-style prompt (patch-21, point f). Shown at most once per 30 days
// per user — gated server-side (last "nps" row) and snoozed locally so it never
// nags on every page load. Always dismissable; the user can ignore it forever.
const SNOOZE_KEY = "outrival_nps_snooze";
const SNOOZE_DAYS = 14;
const SHOW_DELAY_MS = 6000;

function npsTargetId(): string {
  const now = new Date();
  return `nps-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function verdictForScore(score: number): QualityFeedbackVerdict {
  if (score >= 9) return "useful";
  if (score <= 6) return "not_useful";
  return "neutral";
}

function snoozedRecently(): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const at = new Date(raw).getTime();
    return Date.now() - at < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function snoozeNow() {
  try {
    localStorage.setItem(SNOOZE_KEY, new Date().toISOString());
  } catch {
    // localStorage unavailable → fall back to the server-side 30-day gate.
  }
}

export function NpsPrompt() {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (snoozedRecently()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    api
      .getNpsStatus()
      .then(({ eligible }) => {
        if (!eligible) return;
        timer = setTimeout(() => {
          snoozeNow();
          setOpen(true);
        }, SHOW_DELAY_MS);
      })
      .catch(() => {});
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Record a row so the 30-day gate starts, whether the user answered or dismissed.
  async function record(verdict: QualityFeedbackVerdict, npsScore?: number) {
    setBusy(true);
    try {
      await api.submitQualityFeedback({
        targetType: "nps",
        targetId: npsTargetId(),
        verdict,
        npsScore,
        freeText: comment.trim() || undefined,
      });
    } catch {
      // best-effort — never block the user
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (score === null) return;
    await record(verdictForScore(score), score);
    setOpen(false);
    toast("Thanks for the feedback!");
  }

  function dismiss() {
    setOpen(false);
    // Mark dismissed (neutral, no score) so we don't re-prompt before the window.
    void record("neutral");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>How likely are you to recommend Outrival?</DialogTitle>
          <DialogDescription>
            0 = not at all, 10 = extremely likely. One quick tap.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              className={cn(
                "h-9 w-9 rounded border border-border text-sm tabular-nums transition-colors hover:border-border-strong",
                score === n
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {n}
            </button>
          ))}
        </div>

        {score !== null && (
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything we could do better? (optional)"
            rows={3}
            maxLength={1000}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss} disabled={busy}>
            Not now
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || score === null}>
            Submit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
