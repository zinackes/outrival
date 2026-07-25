"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { api, type PositioningVersion } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { TabSection } from "@/components/outrival/tab-shell";

/**
 * How the homepage reads now against how it read before.
 *
 * The tab could say a competitor's copy changed, never what it changed FROM,
 * which is the half that carries the meaning: "Everything your TCG world needs"
 * is a headline, and "they stopped saying track your collection and started
 * saying buy, sell, trade" is a repositioning. The API returns distinct versions
 * of the copy (see /positioning-history), so the comparison is against the last
 * wording they actually used, not against an arbitrary date.
 *
 * Renders nothing until there are two versions: a competitor whose homepage has
 * never been rewritten has no drift, and an empty before/after would imply we
 * simply failed to capture one.
 */
export function PositioningDrift({ competitorId }: { competitorId: string }) {
  const historyQuery = useQuery({
    queryKey: ["competitor", competitorId, "positioningHistory"],
    queryFn: () => api.getCompetitorPositioningHistory(competitorId).then((r) => r.versions),
    placeholderData: keepPreviousData,
  });

  // Best-effort: this is one section of a tab that works without it, so a failure
  // stays silent rather than replacing the feed with an error.
  if (historyQuery.isError) return null;
  if (!historyQuery.data) {
    return (
      <TabSection title="How the homepage reads now">
        <Skeleton className="h-24 w-full" />
      </TabSection>
    );
  }

  const [now, before] = historyQuery.data;
  if (!now || !before) return null;

  const added = before.valueProps.length > 0 || now.valueProps.length > 0
    ? now.valueProps.filter((v) => !before.valueProps.includes(v))
    : [];
  const dropped = now.valueProps.length > 0 || before.valueProps.length > 0
    ? before.valueProps.filter((v) => !now.valueProps.includes(v))
    : [];

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
                  // telling as what they started claiming, and reading it as
                  // plain text alongside the additions loses which is which.
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
          className={`text-lead font-semibold leading-snug tracking-tight text-balance ${
            muted ? "text-muted-foreground" : "text-foreground"
          }`}
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
