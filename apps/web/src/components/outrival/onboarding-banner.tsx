import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Non-blocking completion banner shown at the top of the dashboard when the user
 * skipped onboarding and has no product profile yet. Disappears automatically once
 * a profile exists (the layout stops rendering it).
 */
export function OnboardingBanner() {
  return (
    <div className="flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 sm:px-6 py-2.5">
      <AlertTriangle size={16} className="text-accent shrink-0" />
      <p className="flex-1 text-sm text-foreground">
        Complete your setup to start tracking competitors.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link href="/onboarding">Complete now</Link>
      </Button>
    </div>
  );
}
