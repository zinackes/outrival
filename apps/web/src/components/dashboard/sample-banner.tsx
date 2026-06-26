"use client";

import { Button } from "@/components/ui/button";
import { useSampleMode } from "@/hooks/use-sample-mode";

/**
 * Thin banner shown while sample / demo mode is on (Step 0). Self-hides when off.
 * The Iris dot is the one rationed accent; the copy makes clear nothing real is
 * touched, and "Exit sample" flips back to the user's own data everywhere.
 */
export function SampleBanner() {
  const [sample, setSample] = useSampleMode();
  if (!sample) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Sample data.</span> A
          fictional workspace for exploring — your real data is untouched.
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setSample(false)}>
        Exit sample
      </Button>
    </div>
  );
}
