"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus, Loader2 } from "lucide-react";
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
  { value: "idea", label: "Idée" },
  { value: "other", label: "Autre" },
];

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [withScreenshot, setWithScreenshot] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    initErrorBuffer();
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
      toast.success("Merci, c'est bien reçu 🙏");
      setOpen(false);
      reset();
    } catch {
      toast.error("Échec de l'envoi — réessaye dans un instant");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Envoyer un feedback"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted shadow-lg backdrop-blur-sm transition-colors hover:border-border-strong hover:text-primary"
      >
        <MessageSquarePlus size={18} />
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Envoyer un feedback</DialogTitle>
            <DialogDescription>
              Bug, idée ou remarque — un mot suffit.
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
                placeholder="Décrivez le bug ou votre idée..."
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
              Joindre une capture d&apos;écran
            </label>

            <p className="text-xs text-text-subtle">
              La page actuelle et les erreurs techniques récentes sont jointes
              automatiquement pour nous aider à débuguer.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button onClick={handleSubmit} disabled={!message.trim() || submitting}>
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Envoi...
                </>
              ) : (
                "Envoyer"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
