"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "outrival.2fa-nudge-dismissed";
const FIRST_SEEN_KEY = "outrival.2fa-nudge-first-seen";
// Hold the 2FA nudge back from the crowded first arrival — the onboarding analysis
// panel and the setup checklist own that moment. It surfaces ~a day later, in an
// uncontested slot, so security never competes with the first-run experience.
const DEFER_MS = 24 * 60 * 60 * 1000;

/**
 * One-time nudge inviting users to turn on two-factor auth. It's a suggestion,
 * never a gate — onboarding stays untouched so activation isn't taxed. Shown only
 * when 2FA is off. `twoFactorEnabled` is read server-side from the session in the
 * dashboard layout (same field SecuritySettings uses) and passed down, so the nudge
 * doesn't fire its own client get-session on every page; dismissing persists forever
 * in localStorage so we never nag again, and enabling 2FA removes it on the next
 * server render. Deferred past the first dashboard visit (see DEFER_MS) so it doesn't
 * stack onto the first-run analysis + checklist.
 */
export function TwoFactorNudgeBanner({
  twoFactorEnabled,
}: {
  twoFactorEnabled: boolean;
}) {
  // Start hidden so an already-dismissed (or 2FA-enabled) user never sees a flash.
  const [dismissed, setDismissed] = useState(true);
  // Start deferred too — the nudge only appears once the grace window has elapsed.
  const [deferred, setDeferred] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") {
      setDismissed(true);
      return;
    }
    setDismissed(false);
    const raw = localStorage.getItem(FIRST_SEEN_KEY);
    if (!raw) {
      // First dashboard arrival — stamp it and stay deferred this session.
      localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
      setDeferred(true);
      return;
    }
    const firstSeen = Number(raw);
    setDeferred(!Number.isFinite(firstSeen) || Date.now() - firstSeen < DEFER_MS);
  }, []);

  if (twoFactorEnabled || dismissed || deferred) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <ShieldCheck size={16} className="shrink-0 text-link" />
      <p className="flex-1 text-sm text-foreground">
        Add an extra layer of security — turn on two-factor authentication so a
        stolen email or password isn&apos;t enough to sign in.
      </p>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link href="/dashboard/settings/security">Set up 2FA</Link>
      </Button>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X size={16} />
      </button>
    </div>
  );
}
