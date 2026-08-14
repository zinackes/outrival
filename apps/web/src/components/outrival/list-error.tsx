"use client";

import { WarningIcon } from "@/components/icons";
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

/**
 * A page that loaded, missing one of its parts (OUT-190).
 *
 * The failure ListError can't carry: what failed isn't the query the screen is
 * made of, so blanking the page would throw away everything that did arrive.
 * Names the missing part, leaves the rest readable, and still offers the retry —
 * the shape AI Visibility already uses for a refetch that didn't land.
 */
export function PartialError({
  title,
  error,
  onRetry,
}: {
  /** The part that is missing, named: "The market charts didn't load". */
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  const cfg = errorConfig(error);
  return (
    <div
      // Context, not an interruption: the page around it is intact and readable.
      role="status"
      className="flex flex-wrap items-start gap-x-3 gap-y-3 rounded-md border border-border bg-card px-4 py-3"
    >
      <WarningIcon size={16} className="mt-0.5 shrink-0 text-medium" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <p className="max-w-[62ch] text-dense leading-relaxed text-muted-foreground">
          {cfg.description}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
        {cfg.action?.label ?? "Try again"}
      </Button>
    </div>
  );
}

/**
 * The same failure, inside a settings section (OUT-38).
 *
 * Settings used to state a failed load five different ways — a bare
 * `text-destructive` paragraph on Products, a `text-muted-foreground` one on
 * Usage for the same class of failure, nothing at all elsewhere — and only one
 * surface in the whole directory carried `role="alert"`, so a screen reader
 * heard silence where a sighted user saw red. This announces, names what is
 * intact, and always offers the retry.
 *
 * Left-aligned and inline rather than ListError's centred panel: a section that
 * failed sits between sections that loaded, so it keeps the page's leading edge
 * instead of centring itself in a hole.
 */
export function SettingsError({
  title,
  error,
  onRetry,
}: {
  /** What failed, in the page's own words: "Products didn't load". */
  title?: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const cfg = errorConfig(error);
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-x-3 gap-y-3 rounded-lg border border-critical/25 bg-critical/[0.06] px-4 py-3.5"
    >
      <WarningIcon size={18} className="mt-0.5 shrink-0 text-critical" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-dense font-semibold text-critical">{title ?? cfg.title}</div>
        <p className="mt-0.5 max-w-[56ch] text-dense text-muted-foreground">
          {cfg.description} Nothing was changed.
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {cfg.action?.label ?? "Retry"}
        </Button>
      )}
    </div>
  );
}
