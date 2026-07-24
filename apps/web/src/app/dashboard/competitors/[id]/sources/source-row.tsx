"use client";

import { useState } from "react";
import { ExternalLink, Link2, Loader2, Lock, Play, Plus } from "lucide-react";
import {
  MONITOR_FREQUENCIES,
  PLAN_LABELS,
  isReviewSource,
  minPlanForSource,
  planIncludesFrequency,
  minPlanForFrequency,
  sourceState,
  validateMonitorUrl,
  type DetectedTargets,
  type MonitorFrequency,
  type Plan,
  type SourceType,
} from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { sourceShortLabel } from "@/lib/source-labels";
import {
  SourceStatusIcon,
  monitorStatus,
  nextScanLabel,
  lastScanLabel,
} from "../competitor-detail/monitor-status";
import { sourceCopy, isConcerning } from "./source-copy";

const TONE_CLASS = {
  ok: "text-muted-foreground",
  limited: "text-warning",
  actionable: "text-critical",
  neutral: "text-muted-foreground",
} as const;

/**
 * What a URL means for this source. Most take a page on the competitor's own
 * domain and are auto-discovered, so the field is an override. The two that live
 * on a fixed third-party host (App Store listing, GitHub repo) can't be derived
 * from the site at all — they say what they need, since a blank field there is the
 * difference between enabling the source and a rejected request.
 */
const URL_GUIDANCE: Partial<Record<SourceType, { placeholder: string; help: string }>> = {
  appstore_reviews: {
    placeholder: "https://apps.apple.com/us/app/name/id123456789",
    help: "Their App Store listing. The link has to carry the numeric app id (…/id123456789).",
  },
  github_repo: {
    placeholder: "https://github.com/owner/repo",
    help: "The public repository. Nothing on their site points to it, so we can't find it on our own.",
  },
  jobs: {
    placeholder: "https://example.com/careers",
    help: "Their careers page, or the board that hosts it (Greenhouse, Lever, Ashby…).",
  },
  docs: {
    placeholder: "https://docs.example.com",
    help: "Optional. Leave it empty and we'll find their developer docs on our own.",
  },
};

/** The same rejections the API would return, said before the round-trip. */
function urlErrorMessage(sourceType: SourceType, code: string): string {
  switch (code) {
    case "invalid_url":
      return "That doesn't look like a URL.";
    case "must_be_https":
      return "The URL has to start with https://.";
    case "credentials_not_allowed":
      return "Remove the username and password from the URL.";
    case "port_not_allowed":
      return "A custom port isn't allowed.";
    case "appstore_id_missing":
      return "That App Store link is missing its app id (…/id123456789).";
    case "host_not_allowed":
      if (sourceType === "appstore_reviews") return "That has to be an apps.apple.com link.";
      if (sourceType === "github_repo") return "That has to be a github.com repository.";
      if (sourceType === "jobs")
        return "That has to be on their domain, or on a job board we support.";
      return "That page has to be on this competitor's domain.";
    default:
      return "That URL can't be used for this source.";
  }
}

/**
 * The source's name, made a link to the exact page we scrape when we know it
 * (resolved URL / pinned URL). The URL shows on hover (title) and opens in a new
 * tab; the external-link glyph only appears on hover so the row stays calm. Sources
 * with no single page (or nothing captured yet) fall back to plain text.
 */
export function SourceName({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return <span className="w-[132px] shrink-0 truncate text-sm font-medium">{label}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      onClick={(e) => e.stopPropagation()}
      className="group/src flex w-[132px] shrink-0 items-center gap-1 text-sm font-medium hover:underline focus-visible:outline-none focus-visible:underline"
    >
      <span className="truncate">{label}</span>
      <ExternalLink
        size={11}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/src:opacity-100"
      />
    </a>
  );
}

/**
 * One configurable source. The row always exists, whether or not a monitor does —
 * that is what lets it say "this competitor has no such surface" instead of simply
 * omitting the line and leaving the user to wonder.
 */
export function SourceRow({
  sourceType,
  monitor,
  plan,
  targets,
  competitorUrl,
  fallbacks,
  running,
  monitoringPaused,
  onRun,
  onEnable,
  onEdit,
  onSetActive,
  onLockedFrequency,
  onUpgrade,
}: {
  sourceType: SourceType;
  monitor: Monitor | null;
  plan: Plan;
  targets: DetectedTargets | null;
  /** The competitor's own site — what a same-domain URL is checked against. */
  competitorUrl: string | null;
  /** Other sources we ARE collecting — quoted in the blocked message. */
  fallbacks: string[];
  running: boolean;
  monitoringPaused: boolean;
  onRun: (id: string) => void;
  onEnable: (source: SourceType, url?: string) => Promise<void>;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onSetActive: (id: string, active: boolean) => void;
  onLockedFrequency: (freq: MonitorFrequency) => void;
  onUpgrade: (source: SourceType) => void;
}) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const state = sourceState({ sourceType, plan, monitor, targets });
  const status = monitor ? monitorStatus(monitor, running) : "idle";
  const copy = sourceCopy({
    state,
    sourceType,
    failureCategory: monitor?.lastFailureCategory,
    fallbacks,
    minPlanLabel: PLAN_LABELS[minPlanForSource(sourceType)],
    freshness: monitor ? lastScanLabel(monitor, status) : undefined,
  });
  const nextScan =
    monitor && (state === "tracking" || state === "pending")
      ? nextScanLabel(monitor, status, monitoringPaused)
      : null;
  const currentUrl = monitor?.config?.url ?? "";
  // Sources that live on a fixed third-party host can't be derived from the
  // competitor's site, so the API rejects an enable with no URL (`repo_url_required`
  // / `review_url_required`). Ask for it here instead of firing a doomed request and
  // reporting the requirement in a toast the user can't act on.
  const needsUrlToEnable = sourceType === "github_repo" || isReviewSource(sourceType);
  const guidance = URL_GUIDANCE[sourceType];

  function openUrlPanel() {
    setUrlValue(currentUrl);
    setUrlError(null);
    setUrlOpen((v) => !v);
  }

  async function saveUrl() {
    const url = urlValue.trim();
    if (!url) return;
    // Same rule the API enforces (host lock + https + app id), applied before the
    // request so a typo answers inline instead of as a rejection toast.
    const valid = validateMonitorUrl(sourceType, url, competitorUrl);
    if (!valid.ok) {
      setUrlError(urlErrorMessage(sourceType, valid.error));
      return;
    }
    setSaving(true);
    try {
      if (monitor) await onEdit(monitor.id, { url: valid.url });
      else await onEnable(sourceType, valid.url);
      setUrlOpen(false);
      setUrlError(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {monitor ? (
          <SourceStatusIcon status={status} />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40" />
        )}
        <SourceName label={sourceShortLabel(sourceType)} url={monitor?.pageUrl ?? null} />

        <span className={cn("min-w-0 flex-1 text-sm", TONE_CLASS[copy.tone])}>
          {copy.message}
          {nextScan && <span className="text-muted-foreground"> · {nextScan}</span>}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {copy.action === "upgrade" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onUpgrade(sourceType)}
            >
              <Lock size={11} /> Upgrade
            </Button>
          )}

          {copy.action === "enable" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={enabling}
              onClick={async () => {
                if (needsUrlToEnable) {
                  openUrlPanel();
                  return;
                }
                setEnabling(true);
                try {
                  await onEnable(sourceType);
                } finally {
                  setEnabling(false);
                }
              }}
            >
              {enabling ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Enable
            </Button>
          )}

          {copy.action === "fix_url" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openUrlPanel}>
              <Link2 size={11} /> Fix URL
            </Button>
          )}

          {monitor && state !== "locked" && state !== "not_available" && (
            <>
              {copy.action !== "fix_url" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={openUrlPanel}
                  aria-expanded={urlOpen}
                >
                  <Link2 size={11} /> URL
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={running || monitor.isActive === false}
                onClick={() => onRun(monitor.id)}
              >
                {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                Run
              </Button>
              <Switch
                checked={monitor.isActive !== false}
                onCheckedChange={(v) => onSetActive(monitor.id, v)}
                aria-label={`${sourceShortLabel(sourceType)} monitoring`}
              />
            </>
          )}
        </div>
      </div>

      {/* Only a source we actually collect has a cadence to choose. On a paused,
          blocked, broken or unavailable one the segmented control described a
          schedule that isn't running — three buttons of noise per row, on the rows
          that already have the least to say. */}
      {monitor && (state === "tracking" || state === "pending") && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[calc(0.5rem+132px+0.75rem)]">
          {MONITOR_FREQUENCIES.map((freq) => {
            const locked = !planIncludesFrequency(plan, freq);
            return (
              <Button
                key={freq}
                type="button"
                size="sm"
                variant={monitor.frequency === freq ? "secondary" : "ghost"}
                className="h-6 gap-1 text-meta capitalize text-muted-foreground"
                onClick={() =>
                  locked ? onLockedFrequency(freq) : void onEdit(monitor.id, { frequency: freq })
                }
              >
                {locked && <Lock size={9} className="opacity-70" />}
                {freq}
                {locked && (
                  <span className="text-meta uppercase tracking-wide opacity-70">
                    {PLAN_LABELS[minPlanForFrequency(freq)]}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {urlOpen && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-border bg-background p-3 duration-200 ease-out animate-in fade-in-0 slide-in-from-top-1">
          <Label htmlFor={`url-${sourceType}`} className="text-xs">
            {monitor ? "Page URL" : `${sourceShortLabel(sourceType)} URL`}
          </Label>
          <p className="text-xs text-muted-foreground">
            {guidance?.help ?? "Must be on this competitor's domain."}{" "}
            {/* Retargeting clears the previous page's failure record server-side, so
                a source that was blocked or auto-paused comes back on its own. */}
            {monitor &&
              "Saving clears this source's failure history and schedules a fresh scan, and past snapshots are kept."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`url-${sourceType}`}
              value={urlValue}
              autoFocus
              aria-invalid={!!urlError}
              placeholder={guidance?.placeholder ?? "https://…"}
              onChange={(e) => {
                setUrlValue(e.target.value);
                if (urlError) setUrlError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) void saveUrl();
              }}
              className="min-w-[240px] flex-1"
            />
            <Button size="sm" onClick={saveUrl} disabled={saving || !urlValue.trim()}>
              {saving ? "Saving…" : monitor ? "Save" : "Enable"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setUrlOpen(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
          {urlError && <p className="text-xs text-critical">{urlError}</p>}
        </div>
      )}
    </div>
  );
}

export { isConcerning };
