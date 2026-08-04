"use client";

import { useId, useRef, useState } from "react";
import {
  CaretRightIcon,
  ArrowSquareOutIcon,
  InfoIcon,
  SpinnerIcon,
  ClockIcon,
  LockIcon,
  PlayIcon,
  PlusIcon,
} from "@/components/icons";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sourceShortLabel } from "@/lib/source-labels";
import {
  SourceStatusIcon,
  monitorStatus,
  nextScanIn,
  lastScanLabel,
} from "../competitor-detail/monitor-status";
import type { ScrapeActivity } from "../competitor-detail/shared";
import { sourceCopy, isConcerning } from "./source-copy";

// `limited` was `text-warning`, which no token defines — so the one tone that had
// to look different from plain muted text rendered with no color at all. `medium`
// is the existing amber on the severity scale, the only semantic scale we have.
const TONE_CLASS = {
  ok: "text-muted-foreground",
  limited: "text-medium",
  actionable: "text-critical",
  neutral: "text-muted-foreground",
} as const;

/**
 * What a URL means for this source. Most take a page on the competitor's own
 * domain and are auto-discovered, so the field is an override. The ones that live
 * on a fixed third-party host (App Store listing, Shopify listing, GitHub repo)
 * can't be derived from the site at all — they say what they need, since a blank
 * field there is the difference between enabling the source and a rejected request.
 */
const URL_GUIDANCE: Partial<Record<SourceType, { placeholder: string; help: string }>> = {
  appstore_reviews: {
    placeholder: "https://apps.apple.com/us/app/name/id123456789",
    help: "Their App Store listing. The link has to carry the numeric app id (…/id123456789).",
  },
  shopify_reviews: {
    placeholder: "https://apps.shopify.com/their-app",
    help: "Their Shopify App Store listing. We read the reviews merchants leave on it.",
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
  roadmap: {
    placeholder: "https://example.canny.io",
    help: "Optional. Leave it empty and we'll look for their public roadmap portal ourselves.",
  },
  status: {
    placeholder: "https://status.example.com",
    // The scraper reads a Statuspage or Instatus JSON summary and nothing else, so
    // the limit that matters is the VENDOR, not the domain. Said before the field is
    // filled rather than as a rejection afterwards.
    help: "A Statuspage or Instatus page. Their own domain, a vendor host (example.statuspage.io) or a sibling one (example-status.com) all work.",
  },
  changelog: {
    placeholder: "https://example.com/changelog",
    help: "Their release notes. It has to be a page on their own domain.",
  },
  trustpilot_public: {
    placeholder: "https://www.trustpilot.com/review/example.com",
    help: "Their Trustpilot profile. We normally find it from their domain, so you only need this if they're listed under a different one.",
  },
};

/**
 * The line that opens the override on a source we concluded doesn't exist. Framed
 * as what we looked for and missed, never as a correction of the user, so taking
 * the offer feels like adding knowledge rather than fixing our mistake.
 */
const NOT_AVAILABLE_PROMPT: Partial<Record<SourceType, string>> = {
  status: "We found no status page on their domain. If you know of one, name it here.",
  changelog: "We found no changelog on their domain. If you know of one, name it here.",
  docs: "We found no public developer docs. If you know where they are, name them here.",
  github_repo: "Nothing on their site points to a public repo. If you know of one, name it here.",
  roadmap: "We found no public roadmap portal. If you know of one, name it here.",
  appstore_reviews: "We found no App Store listing. If you know of one, name it here.",
  shopify_reviews: "We found no Shopify App Store listing. If you know of one, name it here.",
  trustpilot_public:
    "Trustpilot lists no profile for their domain. If they're listed under a different one, paste that profile here.",
  youtube: "We found no channel linked from their site. If you know of one, name it here.",
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
      if (sourceType === "roadmap")
        return "That has to be on their domain, or a Canny / ProductBoard portal.";
      if (sourceType === "status")
        return "That has to be a Statuspage or Instatus page, on their domain or a status one.";
      if (sourceType === "trustpilot_public")
        return "That has to be a trustpilot.com/review/… profile link.";
      if (sourceType === "youtube") return "That has to be a youtube.com channel link.";
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
      <ArrowSquareOutIcon
        size={16}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/src:opacity-100"
      />
    </a>
  );
}

/**
 * One configurable source. The row always exists, whether or not a monitor does —
 * that is what lets it say "this competitor has no such surface" instead of simply
 * omitting the line and leaving the user to wonder.
 *
 * At rest it is ONE line. Everything that configures the source (cadence, on/off,
 * which page) lives in a drawer, because the frequency control rendered under every
 * collecting row put a dozen buttons permanently on screen on exactly the rows that
 * needed the least attention.
 */
export function SourceRow({
  sourceType,
  monitor,
  plan,
  targets,
  competitorUrl,
  fallbacks,
  activity,
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
  /** Open scrape request, if any: a worker has it, or it is still in the queue. */
  activity: ScrapeActivity;
  monitoringPaused: boolean;
  onRun: (id: string) => void;
  onEnable: (source: SourceType, url?: string) => Promise<void>;
  onEdit: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) => Promise<void>;
  onSetActive: (id: string, active: boolean) => void;
  onLockedFrequency: (freq: MonitorFrequency) => void;
  onUpgrade: (source: SourceType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const drawerId = useId();

  const state = sourceState({ sourceType, plan, monitor, targets });
  // One verdict, computed once by the caller: the server stamps say whether a
  // worker holds the job or it is still waiting, and the optimistic client marker
  // can only ever mean "queued" (a request is tracked from the moment it is sent).
  const status = monitor
    ? monitorStatus(monitor, activity === "scraping", activity === "queued")
    : "idle";
  const busy = activity !== null;
  const copy = sourceCopy({
    state,
    sourceType,
    failureCategory: monitor?.lastFailureCategory,
    fallbacks,
    minPlanLabel: PLAN_LABELS[minPlanForSource(sourceType)],
    freshness: monitor ? lastScanLabel(monitor, status) : undefined,
    homepageOnly: monitor?.pageIsHomepage === true,
  });
  const currentUrl = monitor?.config?.url ?? "";
  // Sources that live on a fixed third-party host can't be derived from the
  // competitor's site, so the API rejects an enable with no URL (`repo_url_required`
  // / `review_url_required`). Ask for it here instead of firing a doomed request and
  // reporting the requirement in a toast the user can't act on.
  const needsUrlToEnable = sourceType === "github_repo" || isReviewSource(sourceType);
  const guidance = URL_GUIDANCE[sourceType];
  const label = sourceShortLabel(sourceType);

  // A locked source has nothing to configure, so its row never opens; the padlock
  // action is the whole offer.
  const expandable = state !== "locked";
  // What the drawer can actually show. A source with no monitor row has no cadence
  // and no on/off — only the question of which page to watch.
  const canSchedule = !!monitor && (state === "tracking" || state === "pending");
  // "Weekly" alone doesn't answer the question the user actually has, which is when
  // we look next. It rides next to the cadence word on the row, and is stated once.
  const nextScanShort = canSchedule ? nextScanIn(monitor, status, monitoringPaused) : null;
  const canToggle = !!monitor && state !== "not_available";
  const showUrlField = copy.action !== "upgrade";
  // "Point us at one" and "Turn on" both submit the same thing, but only the first
  // is overruling a verdict we already published.
  const isOverride = state === "not_available";
  const urlHelp = [
    isOverride
      ? (NOT_AVAILABLE_PROMPT[sourceType] ?? "If you know this surface exists, name it here.")
      : (guidance?.help ?? "Must be on this competitor's domain."),
    // Retargeting clears the previous page's failure record server-side, so a source
    // that was blocked or auto-paused comes back on its own.
    monitor && !isOverride
      ? "Saving clears this source's failure history and schedules a fresh scan, and past snapshots are kept."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  function openWithUrlFocus() {
    setUrlValue(currentUrl);
    setUrlError(null);
    setOpen(true);
    // The field lives inside the drawer, so it exists only after this paint.
    requestAnimationFrame(() => urlRef.current?.focus());
  }

  function toggleOpen() {
    if (!expandable) return;
    if (!open) setUrlValue(currentUrl);
    setUrlError(null);
    setOpen((v) => !v);
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
      setOpen(false);
      setUrlError(null);
    } finally {
      setSaving(false);
    }
  }

  async function enableWithoutUrl() {
    setEnabling(true);
    try {
      await onEnable(sourceType);
    } finally {
      setEnabling(false);
    }
  }

  return (
    <div
      data-open={open || undefined}
      className={cn(
        "group/row transition-colors",
        // A row is a disclosure, so it answers the pointer with a lighter wash of
        // the surface it will settle on once open.
        open ? "bg-surface-2" : expandable && "hover:bg-surface-2/50",
      )}
    >
      {/* The whole line opens the row, padding included. The inner button stays for
          the keyboard and the aria contract, but a pointer landing in the 16px
          gutter used to hit dead space on a row that is entirely a disclosure. */}
      <div
        onClick={toggleOpen}
        className={cn("flex items-center gap-3 px-4 py-2", expandable && "cursor-pointer")}
      >
        <button
          type="button"
          onClick={(e) => {
            // Without this the parent handler fires too and toggles right back.
            e.stopPropagation();
            toggleOpen();
          }}
          aria-expanded={expandable ? open : undefined}
          aria-controls={expandable ? drawerId : undefined}
          disabled={!expandable}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            expandable && "cursor-pointer",
          )}
        >
          {monitor ? (
            <SourceStatusIcon status={status} />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40" />
          )}
          <span className="w-[132px] shrink-0 truncate text-sm font-medium">{label}</span>
          {/* "Scanned 2 days ago" is a status stamp, not prose: it sits a step below
              the messages that ask something of the user (blocked, broken, locked),
              which stay at reading size. */}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              canSchedule ? "text-xs" : "text-sm",
              TONE_CLASS[copy.tone],
            )}
          >
            {copy.message}
          </span>
        </button>

        {/* Actions carry their own click; the row must not also swallow it. */}
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {copy.action === "upgrade" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onUpgrade(sourceType)}
            >
              <LockIcon size={16} /> Upgrade
            </Button>
          )}

          {/* A source we've never turned on can be enabled from the row itself when
              it needs no URL. The ones that do need one open the drawer instead of
              firing a request the API is certain to reject. */}
          {copy.action === "enable" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 group-data-[open]/row:opacity-100"
              disabled={enabling}
              onClick={() => (needsUrlToEnable ? openWithUrlFocus() : void enableWithoutUrl())}
            >
              {enabling ? <SpinnerIcon size={16} className="animate-spin" /> : <PlusIcon size={16} />}
              Turn on
            </Button>
          )}

          {/* The change that ends the dead end. Deliberately the quietest control on
              the page: the sentence beside it is a neutral fact about the competitor,
              and a loud button would turn it back into a gap to be closed. */}
          {copy.action === "point_at_url" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 group-data-[open]/row:opacity-100"
              onClick={openWithUrlFocus}
            >
              Point us at one
            </Button>
          )}

          {copy.action === "fix_url" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openWithUrlFocus}>
              Fix URL
            </Button>
          )}

          {/* A refusal is stated, never enforced on the user: the Run button stays on
              a blocked source. The site may have changed its robots.txt, or the URL
              may now point somewhere open, and only a fresh attempt can find out.
              What stops at a refusal is the SCRAPE, in the worker, not the control. */}
          {monitor && state !== "locked" && state !== "not_available" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 group-data-[open]/row:opacity-100"
              disabled={busy || monitor.isActive === false}
              onClick={() => onRun(monitor.id)}
            >
              {activity === "scraping" ? (
                <SpinnerIcon size={16} className="animate-spin" />
              ) : activity === "queued" ? (
                <ClockIcon size={16} />
              ) : (
                <PlayIcon size={16} />
              )}
              {activity === "queued" ? "Queued" : "Run"}
            </Button>
          )}

          {canSchedule && (
            <span className="hidden text-xs capitalize tabular-nums text-muted-foreground sm:inline">
              {monitor.frequency}
              {nextScanShort && (
                <span className="normal-case text-muted-foreground">
                  {" · "}
                  {nextScanShort === "paused" ? nextScanShort : `next ${nextScanShort}`}
                </span>
              )}
            </span>
          )}

          {expandable && (
            <button
              type="button"
              onClick={toggleOpen}
              tabIndex={-1}
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground"
            >
              <CaretRightIcon
                size={16}
                className={cn("transition-transform duration-200", open && "rotate-90")}
              />
            </button>
          )}
        </div>
      </div>

      {/* Animating a grid track rather than a height means the real height eases and
          every row below travels with it, with no measuring in JS and no guessed
          max-height ceiling (these drawers range from one segmented control to a full
          refusal explanation). `min-h-0` on the clip is what lets the track shrink
          below its content — without it the row snaps open. */}
      {expandable && (
        <div
          id={drawerId}
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className={cn(
                "flex flex-wrap gap-x-8 gap-y-4 px-4 pb-4 pl-[calc(0.5rem+132px+0.75rem)] pt-1",
                "transition-opacity duration-200 motion-reduce:transition-none",
                open ? "opacity-100 delay-75" : "opacity-0",
              )}
            >
              {canSchedule && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">How often</p>
                  {/* One track, one raised segment: three loose buttons read as three
                      independent choices, when it is a single setting with three
                      positions. The next scan is already stated on the row, so the
                      drawer doesn't repeat it. */}
                  <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
                    {MONITOR_FREQUENCIES.map((freq) => {
                      const locked = !planIncludesFrequency(plan, freq);
                      const selected = monitor.frequency === freq;
                      return (
                        <button
                          key={freq}
                          type="button"
                          aria-pressed={selected}
                          className={cn(
                            "inline-flex h-6 items-center gap-1 rounded px-2.5 text-xs capitalize",
                            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "bg-surface text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() =>
                            locked
                              ? onLockedFrequency(freq)
                              : void onEdit(monitor.id, { frequency: freq })
                          }
                        >
                          {locked && <LockIcon size={16} className="opacity-70" />}
                          {freq}
                          {locked && (
                            <span className="text-meta uppercase tracking-wide opacity-70">
                              {PLAN_LABELS[minPlanForFrequency(freq)]}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {canToggle && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Monitoring</p>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={monitor.isActive !== false}
                      onCheckedChange={(v) => onSetActive(monitor.id, v)}
                      aria-label={`${label} monitoring`}
                    />
                    {/* A switch under a bare "Monitoring" heading doesn't say which
                        way it is set. The word does. */}
                    <span className="text-sm text-muted-foreground">
                      {monitor.isActive === false ? "Off" : "On"}
                    </span>
                  </div>
                </div>
              )}

              {/* A refusal is re-probed on a schedule, so saying so turns a row with
                  no controls into something that is still being watched. */}
              {isConcerning(state) && state !== "fixable" && (
                <p className="w-full max-w-[68ch] border-l-2 border-border pl-3 text-sm text-muted-foreground">
                  {copy.message} We re-check this every couple of weeks in case it lifts.
                </p>
              )}

              {showUrlField && (
                <div className="min-w-[280px] flex-1">
                  {/* The rule for this field (which host, what a save costs) is worth
                      two sentences and worth reading once. As a permanent paragraph
                      it was the tallest thing in the drawer on every row; behind the
                      label it stays one keystroke or one hover away. */}
                  <div className="mb-1.5 flex items-center gap-1">
                    <Label htmlFor={`url-${sourceType}`} className="text-xs">
                      {isOverride || !monitor ? `${label} URL` : "Page URL"}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="What this URL has to be"
                          className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <InfoIcon size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[44ch]">{urlHelp}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id={`url-${sourceType}`}
                      ref={urlRef}
                      value={urlValue}
                      aria-invalid={!!urlError}
                      placeholder={guidance?.placeholder ?? "https://…"}
                      onChange={(e) => {
                        setUrlValue(e.target.value);
                        if (urlError) setUrlError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !saving) void saveUrl();
                      }}
                      className="min-w-[220px] flex-1"
                    />
                    <Button size="sm" onClick={saveUrl} disabled={saving || !urlValue.trim()}>
                      {saving ? "Saving…" : monitor ? "Save" : "Turn on"}
                    </Button>
                  </div>
                  {urlError && <p className="mt-1.5 text-xs text-critical">{urlError}</p>}
                  {/* The row summary became a disclosure button, so the source name
                      can no longer be the link to the page we scrape (an anchor
                      inside a button is invalid). It belongs next to the field that
                      sets it anyway: this is the RESOLVED page, which is not always
                      the one typed above. */}
                  {monitor?.pageUrl && (
                    <a
                      href={monitor.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={monitor.pageUrl}
                      className="mt-1.5 inline-flex max-w-full items-center gap-1 text-xs text-link hover:underline focus-visible:outline-none focus-visible:underline"
                    >
                      <span className="truncate">Open the page we scrape</span>
                      <ArrowSquareOutIcon size={14} className="shrink-0" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { isConcerning };
