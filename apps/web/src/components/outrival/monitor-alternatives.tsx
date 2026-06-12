"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, PencilLine, PauseCircle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type MonitorAlternative } from "@/lib/api";
import { sourceShortLabel } from "@/lib/source-labels";
import { ManualDataEntry } from "./manual-data-entry";

// Human cause line (patch-14 progressive disclosure) for the diagnosed category.
const CAUSE_LABEL: Record<string, string> = {
  anti_bot: "the site is actively blocking automated access",
  site_dead: "the site appears to be down or gone",
  site_redirected: "the site now redirects to a different domain",
  login_required: "the page requires a login to view its content",
  spa_empty: "the page loads its content in a way we couldn't capture",
  geo_blocked: "the site appears to be geo-restricted",
  unknown: "we couldn't reach this source after several attempts",
};

const ICON: Record<string, typeof PencilLine> = {
  different_url: ArrowRight,
  manual_data_entry: PencilLine,
  pause_source: PauseCircle,
  replace_competitor: RefreshCcw,
};

interface Props {
  monitorId: string;
  sourceType: string;
  failureCategory?: string | null;
  /** Called after an action resolves an alternative, so the parent can refresh. */
  onResolved?: () => void;
}

export function MonitorAlternatives({ monitorId, sourceType, failureCategory, onResolved }: Props) {
  const [alternatives, setAlternatives] = useState<MonitorAlternative[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getMonitorAlternatives(monitorId)
      .then((r) => active && setAlternatives(r.alternatives))
      .catch(() => active && setAlternatives([]));
    return () => {
      active = false;
    };
  }, [monitorId]);

  if (!alternatives || alternatives.length === 0) return null;

  async function accept(alt: MonitorAlternative) {
    if (alt.type === "manual_data_entry") {
      setManualOpen(true);
      return;
    }
    setBusyId(alt.id);
    try {
      await api.acceptAlternative(alt.id);
      toast.success(
        alt.type === "different_url"
          ? "Following the new URL — a fresh scrape is on its way."
          : alt.type === "pause_source"
            ? `${label} paused. You can re-enable it any time.`
            : "Done.",
      );
      setAlternatives((prev) => prev?.filter((a) => a.id !== alt.id) ?? null);
      onResolved?.();
    } catch {
      toast.error("Couldn't apply that option. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(alt: MonitorAlternative) {
    setBusyId(alt.id);
    try {
      await api.rejectAlternative(alt.id);
      setAlternatives((prev) => prev?.filter((a) => a.id !== alt.id) ?? null);
    } catch {
      toast.error("Couldn't dismiss that option.");
    } finally {
      setBusyId(null);
    }
  }

  const cause = CAUSE_LABEL[failureCategory ?? "unknown"] ?? CAUSE_LABEL.unknown;
  const label = sourceShortLabel(sourceType);

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      {/* Part 1 — what happened. Part 2 — what we did. */}
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium text-foreground">{label} is temporarily unavailable</p>
          <p className="mt-0.5 text-muted-foreground">
            Detected cause: {cause}. We&apos;ve stopped retrying for now — here&apos;s what you can
            do:
          </p>
        </div>
      </div>

      {/* Part 3 — what you can do. */}
      <ul className="mt-3 flex flex-col gap-2.5">
        {alternatives.map((alt) => {
          const Icon = ICON[alt.type] ?? ArrowRight;
          return (
            <li
              key={alt.id}
              className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm text-foreground">{alt.description}</p>
                  {alt.rationale && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{alt.rationale}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => accept(alt)} disabled={busyId === alt.id}>
                  {alt.type === "different_url"
                    ? "Follow this URL"
                    : alt.type === "manual_data_entry"
                      ? "Enter manually"
                      : alt.type === "pause_source"
                        ? "Pause"
                        : "Got it"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => reject(alt)}
                  disabled={busyId === alt.id}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <ManualDataEntry
        monitorId={monitorId}
        sourceType={sourceType}
        open={manualOpen}
        onOpenChange={setManualOpen}
        onSubmitted={() => {
          setAlternatives((prev) => prev?.filter((a) => a.type !== "manual_data_entry") ?? null);
          onResolved?.();
        }}
      />
    </div>
  );
}
