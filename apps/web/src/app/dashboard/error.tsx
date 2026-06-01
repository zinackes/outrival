"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
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
    // Report to Sentry (patch-04) so ops sees it; the user never sees the stack.
    Sentry.captureException(error);
  }, [error]);

  return (
    <Card className="mt-10 px-6 py-12 text-center text-muted-foreground border-dashed border-critical/25">
      <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
        Something went wrong
      </div>
      <div className="text-[13px] max-w-[380px] mx-auto mb-4">
        Our team has been notified. Try again, or head back to your dashboard.
        {error.digest && (
          <div className="mt-2 font-mono text-[11px] text-muted-foreground/80">
            ref: {error.digest}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </Card>
  );
}
