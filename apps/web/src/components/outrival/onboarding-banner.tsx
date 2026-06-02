"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpdateProfileDialog } from "@/components/outrival/update-profile-dialog";

/**
 * Non-blocking completion banner shown at the top of the dashboard when the user
 * skipped onboarding and has no product profile yet. Disappears automatically once
 * a profile exists (the layout stops rendering it). "Complete now" opens the
 * product-profile modal in setup mode rather than re-routing through the full
 * onboarding page; saving routes straight to competitor discovery.
 */
export function OnboardingBanner() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 sm:px-6 py-2.5">
      <AlertTriangle size={16} className="text-accent shrink-0" />
      <p className="flex-1 text-sm text-foreground">
        Complete your setup to start tracking competitors.
      </p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Complete now
      </Button>
      <UpdateProfileDialog open={open} onOpenChange={setOpen} mode="setup" />
    </div>
  );
}
