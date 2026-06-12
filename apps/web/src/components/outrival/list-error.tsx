"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorConfig } from "@/lib/error-helpers";

// Consistent error state for the main lists (patch-14): never a blank, never an
// endless spinner, never a technical message. Reuses errorConfig so the copy
// matches the toasts. Pair it with the existing skeletons (loading) and the
// per-list empty states.
export function ListError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const cfg = errorConfig(error);
  return (
    <Card className="px-6 py-12 text-center border-dashed border-critical/25">
      <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
        {cfg.title}
      </div>
      <div className="text-sm text-muted-foreground max-w-[380px] mx-auto mb-4">
        {cfg.description}
      </div>
      {onRetry && <Button onClick={onRetry}>{cfg.action?.label ?? "Try again"}</Button>}
    </Card>
  );
}
