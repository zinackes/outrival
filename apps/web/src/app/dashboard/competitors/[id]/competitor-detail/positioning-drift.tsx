"use client";

import { formatDistanceToNow } from "date-fns";
import type { PositioningVersion } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TabSection } from "@/components/outrival/tab-shell";

/**
 * How the homepage reads now against how it read before.
 *
 * The tab could say a competitor's copy changed, never what it changed FROM,
 * which is the half that carries the meaning: "Everything your TCG world needs"
 * is a headline, and "they stopped saying track your collection and started
 * saying buy, sell, trade" is a repositioning.
 *
 * Presentational: the tab owns the query, because its verdict is derived from the
 * same two versions and the two must never disagree about whether the copy moved.
 */
export function PositioningDrift({
  versions,
  loading,
}: {
  versions: PositioningVersion[] | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <TabSection title="How the homepage reads now">
        <Skeleton className="h-24 w-full" />
      </TabSection>
    );
  }

  const [now, before] = versions ?? [];
  // A homepage that has never been rewritten has no drift, and an empty
  // before/after would read as a capture we failed to take.
  if (!now || !before) return null;

  const added = now.valueProps.filter((v) => !before.valueProps.includes(v));
  const dropped = before.valueProps.filter((v) => !now.valueProps.includes(v));

  return (
    <TabSection
      title="How the homepage reads now"
      action={
        <span className="shrink-0 text-xs text-muted-foreground">
          against {formatDistanceToNow(new Date(before.capturedAt), { addSuffix: true })}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Version version={before} label="Before" muted />
        <Version version={now} label="Now" />
      </div>

      {(added.length > 0 || dropped.length > 0) && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 pt-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
          {added.length > 0 && (
            <>
              <dt className="text-xs text-muted-foreground">Added</dt>
              <dd className="m-0 flex flex-col gap-1.5">
                {added.map((v) => (
                  <span key={v} className="text-sm leading-snug">
                    {v}
                  </span>
                ))}
              </dd>
            </>
          )}
          {dropped.length > 0 && (
            <>
              <dt className="text-xs text-muted-foreground">Dropped</dt>
              <dd className="m-0 flex flex-col gap-1.5">
                {dropped.map((v) => (
                  // Struck through: what a competitor STOPPED claiming is as
                  // telling as what they started claiming, and reading both as
                  // plain text loses which is which.
                  <span
                    key={v}
                    className="text-sm leading-snug text-muted-foreground line-through decoration-muted-foreground/50"
                  >
                    {v}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}
    </TabSection>
  );
}

function Version({
  version,
  label,
  muted,
}: {
  version: PositioningVersion;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">
        {label} · {formatDistanceToNow(new Date(version.capturedAt), { addSuffix: true })}
      </p>
      {version.headline ? (
        <p
          className={cn(
            "text-lead font-semibold leading-snug tracking-tight text-balance",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {version.headline}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No headline captured.</p>
      )}
      {version.subheadline && (
        <p className="text-sm leading-relaxed text-muted-foreground">{version.subheadline}</p>
      )}
    </div>
  );
}
