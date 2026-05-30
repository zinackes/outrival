"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="mt-10 px-6 py-12 text-center text-muted-foreground border-dashed border-critical/25">
      <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
        Something went wrong
      </div>
      <div className="text-[13px] max-w-[380px] mx-auto mb-4">
        This page couldn&apos;t be loaded. Try again or reload the page.
        {error.digest && (
          <div className="mt-2 font-mono text-[11px] text-muted-foreground/80">
            ref: {error.digest}
          </div>
        )}
      </div>
      <Button onClick={reset}>Try again</Button>
    </Card>
  );
}
