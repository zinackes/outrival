"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, PauseCircle, PencilLine, Play, RefreshCcw } from "lucide-react";
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

// Secondary, diagnosis-specific suggestions shown below the paused card. Manual
// entry and resume are first-class actions on the card itself; the source is
// auto-paused on the unscrapable transition, so there is no "pause" option.
const ICON: Record<string, typeof PencilLine> = {
  different_url: ArrowRight,
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
  const [resuming, setResuming] = useState(false);
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

  const label = sourceShortLabel(sourceType);
  const cause = CAUSE_LABEL[failureCategory ?? "unknown"] ?? CAUSE_LABEL.unknown;
  const manualAlt = alternatives.find((a) => a.type === "manual_data_entry");
  // Only diagnosis-specific suggestions render as their own rows; pause_source
  // (legacy rows) and manual_data_entry are handled by the card actions.
  const suggestions = alternatives.filter(
    (a) => a.type === "different_url" || a.type === "replace_competitor",
  );

  async function resume() {
    setResuming(true);
    try {
      await api.resumeMonitor(monitorId);
      toast.success(`${label} resumed — a fresh scrape is on its way.`);
      setAlternatives([]);
      onResolved?.();
    } catch {
      toast.error("Couldn't resume this source. Please try again.");
    } finally {
      setResuming(false);
    }
  }

  async function acceptSuggestion(alt: MonitorAlternative) {
    setBusyId(alt.id);
    try {
      await api.acceptAlternative(alt.id);
      toast.success(
        alt.type === "different_url"
          ? "Following the new URL — a fresh scrape is on its way."
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

  async function rejectSuggestion(alt: MonitorAlternative) {
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

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium text-foreground">{label} monitoring is paused</p>
            <p className="mt-0.5 text-muted-foreground">
              We paused it because {cause}. Bring it back any time — enter the data yourself, or
              resume scraping and we&apos;ll try again.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {manualAlt && (
            <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
              <PencilLine className="h-4 w-4" /> Enter manually
            </Button>
          )}
          <Button size="sm" onClick={resume} disabled={resuming}>
            <Play className="h-4 w-4" /> Resume anyway
          </Button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2.5">
          {suggestions.map((alt) => {
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
                  <Button
                    size="sm"
                    onClick={() => acceptSuggestion(alt)}
                    disabled={busyId === alt.id}
                  >
                    {alt.type === "different_url" ? "Follow this URL" : "Got it"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => rejectSuggestion(alt)}
                    disabled={busyId === alt.id}
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

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
