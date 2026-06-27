"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, X } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "outrival.2fa-nudge-dismissed";

/**
 * One-time nudge inviting users to turn on two-factor auth. It's a suggestion,
 * never a gate — onboarding stays untouched so activation isn't taxed. Shown only
 * when 2FA is off (read from the session, same field SecuritySettings uses);
 * dismissing persists forever in localStorage so we never nag again, and enabling
 * 2FA removes it on the next session read.
 */
export function TwoFactorNudgeBanner() {
  const { data: session, isPending } = useSession();
  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );
  // Start hidden so an already-dismissed (or 2FA-enabled) user never sees a flash.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (isPending || !session || enabled || dismissed) return null;

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
