"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  getRecentErrors,
  initErrorBuffer,
} from "@/lib/feedback/error-buffer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type FeedbackType = "bug" | "idea" | "other";

const TYPE_OPTIONS: Array<{ value: FeedbackType; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Other" },
];

/** Opens the feedback dialog from anywhere (the user menu). */
export const FEEDBACK_OPEN_EVENT = "outrival-feedback-open";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [withScreenshot, setWithScreenshot] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    initErrorBuffer();
  }, []);

  // The trigger used to be a floating circle stacked above the Ask one. Two
  // shadowed FABs in the bottom-right corner is the support-widget silhouette,
  // and they sat on top of the content on every page. "Send feedback" is a
  // rare, account-level action, so it lives in the user menu; only the dialog
  // stays mounted here.
  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    document.addEventListener(FEEDBACK_OPEN_EVENT, onOpen);
    return () => document.removeEventListener(FEEDBACK_OPEN_EVENT, onOpen);
  }, []);

  function reset() {
    setType("bug");
    setMessage("");
    setWithScreenshot(false);
  }

  async function captureScreenshot(): Promise<string | undefined> {
    try {
      const mod = await import("html2canvas");
      const html2canvas = (mod.default ?? mod) as unknown as (
        el: HTMLElement,
        opts?: Record<string, unknown>,
      ) => Promise<HTMLCanvasElement>;
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        logging: false,
        backgroundColor: null,
      });
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return undefined;
    }
  }

  async function handleSubmit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    try {
      const screenshot = withScreenshot ? await captureScreenshot() : undefined;
      await api.submitFeedback({
        type,
        message: message.trim(),
        pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        consoleErrors: getRecentErrors(),
        screenshot,
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      toast.success("Thanks, got it");
      setOpen(false);
      reset();
    } catch {
      toast.error("Send failed, try again in a moment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Bug, idea or note. A few words is enough.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    type === opt.value
                      ? "border-primary text-primary"
                      : "border-border text-text-muted hover:border-border-strong"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-message">Message</Label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the bug or your idea..."
                rows={5}
                maxLength={5000}
                className="resize-none"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={withScreenshot}
                onChange={(e) => setWithScreenshot(e.target.checked)}
                className="h-4 w-4 rounded border-border bg-surface-2 accent-primary"
              />
              Attach a screenshot
            </label>

            <p className="text-xs text-text-subtle">
              The current page and recent technical errors are attached
              automatically to help us debug.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!message.trim() || submitting}>
              {submitting ? (
                <>
                  <CircleNotchIcon size={14} className="animate-spin" /> Sending...
                </>
              ) : (
                "Send"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
