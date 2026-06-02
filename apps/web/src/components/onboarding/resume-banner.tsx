"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, RotateCcw, X } from "lucide-react";
import { api, type OnboardingSession } from "@/lib/api";
import { Button } from "@/components/ui/button";

const STAGE_LABEL: Record<string, string> = {
  started: "getting started",
  input: "describing your product",
  profile: "confirming your profile",
  discover: "choosing competitors",
  monitoring: "monitoring preferences",
};

// Patch-25: non-blocking nudge shown on the dashboard when the user left an
// onboarding attempt unfinished (e.g. "Leave for now"). Three-part message
// (patch-14): past (started …) / present (reached …) / action (resume / restart).
export function OnboardingResumeBanner({ session }: { session: OnboardingSession }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (dismissed) return null;

  const started = formatDistanceToNow(new Date(session.startedAt), { addSuffix: true });
  const stage = STAGE_LABEL[session.stage] ?? "your setup";

  const resume = () => router.push("/onboarding");
  const restart = async () => {
    setBusy(true);
    try {
      // Abandons the current session and starts a fresh one (one active per user).
      await api.createOnboardingSession();
    } catch {
      // ignore — the wizard creates one on mount if this failed
    }
    router.push("/onboarding");
  };

  return (
    <div className="px-4 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2/60 px-4 py-3">
        <div className="flex-1 min-w-[180px] text-sm">
          <span className="text-foreground">You started setting up Outrival {started}.</span>{" "}
          <span className="text-muted-foreground">You'd reached {stage}.</span>
        </div>
        <Button size="sm" onClick={resume} disabled={busy}>
          Resume <ArrowRight size={14} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void restart()} disabled={busy}>
          <RotateCcw size={13} /> Restart
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
