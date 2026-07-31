"use client";

import { useEffect, useId, useState } from "react";
import {
  FileMagnifyingGlassIcon,
  PlusIcon,
  LockIcon,
  SpinnerIcon,
  ClockIcon,
  PlayIcon,
  TrashIcon,
  ArrowSquareOutIcon,
  CaretRightIcon,
  LinkIcon,
} from "@/components/icons";
import {
  PLAN_LABELS,
  CUSTOM_MONITOR_HINTS,
  MONITOR_FREQUENCIES,
  customMonitorLimit,
  minPlanForCustomMonitors,
  minPlanForFrequency,
  planIncludesFrequency,
  validateCustomMonitorUrl,
  normalizeHostname,
  type MonitorFrequency,
  type Plan,
  type CustomMonitorHint,
} from "@outrival/shared";
import type { Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import type { CustomAddResult } from "../competitor-detail/use-monitor-actions";
import { scrapeActivity, type ScrapeActivity } from "../competitor-detail/shared";
import {
  SourceStatusIcon,
  lastScanLabel,
  monitorStatus,
  nextScanIn,
} from "../competitor-detail/monitor-status";

export interface CustomSourcesProps {
  competitorUrl: string;
  plan: Plan;
  monitors: Monitor[];
  scrapingIds: Set<string>;
  monitoringPaused: boolean;
  onRun: (id: string) => void;
  onAdd: (input: {
    url: string;
    label: string;
    hint: CustomMonitorHint;
  }) => Promise<CustomAddResult>;
  onEdit: (id: string, patch: { frequency?: MonitorFrequency }) => Promise<void>;
  onSetActive: (id: string, active: boolean) => void;
  onDelete: (monitorId: string) => Promise<void>;
  onLockedFrequency: (freq: MonitorFrequency) => void;
  // Free plan can't watch custom pages at all — route the CTA to the paywall.
  onLocked: () => void;
}

const HINT_LABELS: Record<CustomMonitorHint, string> = {
  product: "Product / feature",
  security: "Security / trust",
  legal: "Legal / terms",
  team: "Team / about",
  docs: "Docs",
  other: "Other",
};

/**
 * The "Watch a custom page" management surface: which arbitrary pages of this
 * competitor's own domain we track, and the per-plan quota on them. The changes
 * these pages produce are read in the Product & Positioning feed, not here — this
 * page decides WHAT we collect, the tabs show what we found.
 */
export function CustomSources({
  competitorUrl,
  plan,
  monitors,
  scrapingIds,
  monitoringPaused,
  onRun,
  onAdd,
  onEdit,
  onSetActive,
  onDelete,
  onLockedFrequency,
  onLocked,
}: CustomSourcesProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const customMonitors = monitors.filter((m) => m.sourceType === "custom");
  const limit = customMonitorLimit(plan);
  const used = customMonitors.length;
  const locked = limit === 0;
  const atLimit = used >= limit;

  // Free plan: no list, just the upsell.
  if (locked && customMonitors.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center">
        <FileMagnifyingGlassIcon size={20} className="text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Watch a custom page</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Track any page on this competitor&apos;s site: pricing FAQs, a security or
          trust page, terms of service, a specific docs page. Available from the{" "}
          {PLAN_LABELS[minPlanForCustomMonitors()]} plan.
        </p>
        <Button size="sm" onClick={onLocked}>
          <LockIcon size={16} /> Upgrade to watch pages
        </Button>
      </Card>
    );
  }

  const openAdd = () => (locked ? onLocked() : setDialogOpen(true));

  return (
    <div className="flex flex-col gap-4">
      <TabCard>
        <TabSection>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-content font-semibold tracking-tight text-foreground">
                Custom pages
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {used}/{limit}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 text-xs"
              onClick={openAdd}
              disabled={atLimit && !locked}
              title={
                atLimit && !locked
                  ? `You're watching the maximum ${limit} pages for this competitor on the ${PLAN_LABELS[plan]} plan.`
                  : undefined
              }
            >
              <PlusIcon size={16} /> Watch a page
            </Button>
          </div>
        </TabSection>

        {customMonitors.length === 0 ? (
          <TabSection>
            <p className="text-sm text-muted-foreground">
              Nothing custom watched yet. Add a page on{" "}
              <span className="font-mono">{normalizeHostname(competitorUrl) ?? "this domain"}</span>{" "}
              to track changes on it.
            </p>
          </TabSection>
        ) : (
          // Full-bleed rows, not a padded list: each page reads exactly like a row
          // of the sources sheet above (status icon, one line, a drawer), it just
          // lives inside this card because watching pages has its own quota + add
          // flow. One wrapper child so the TabCard divider stays at the header.
          <div className="py-1">
            {customMonitors.map((m) => (
              <CustomMonitorRow
                key={m.id}
                monitor={m}
                plan={plan}
                activity={scrapeActivity(m, scrapingIds.has(m.id))}
                monitoringPaused={monitoringPaused}
                onRun={onRun}
                onEdit={onEdit}
                onSetActive={onSetActive}
                onDelete={onDelete}
                onLockedFrequency={onLockedFrequency}
              />
            ))}
            {atLimit && !locked && (
              <p className="px-4 pb-2 pt-1 text-xs text-muted-foreground">
                You&apos;ve reached the {limit}-page limit for this competitor.{" "}
                <button
                  type="button"
                  onClick={onLocked}
                  className="text-link underline-offset-2 hover:underline"
                >
                  Upgrade for more
                </button>
                .
              </p>
            )}
          </div>
        )}
      </TabCard>

      <AddCustomDialog
        open={dialogOpen}
        competitorUrl={competitorUrl}
        onClose={() => setDialogOpen(false)}
        onAdd={onAdd}
      />
    </div>
  );
}

/**
 * One watched page, in the exact grammar of a SourceRow: status icon, name, a
 * freshness stamp, hover-revealed Run, cadence + next scan, and a drawer for
 * everything that configures it. The differences are what a custom page IS: the
 * name is the user's label, the URL is fixed at creation (editing it through the
 * generic monitor PATCH would drop label + hint from the config), and the drawer
 * carries the remove action instead of a URL field.
 */
function CustomMonitorRow({
  monitor,
  plan,
  activity,
  monitoringPaused,
  onRun,
  onEdit,
  onSetActive,
  onDelete,
  onLockedFrequency,
}: {
  monitor: Monitor;
  plan: Plan;
  /** Open scrape request, if any: a worker has it, or it is still in the queue. */
  activity: ScrapeActivity;
  monitoringPaused: boolean;
  onRun: (id: string) => void;
  onEdit: (id: string, patch: { frequency?: MonitorFrequency }) => Promise<void>;
  onSetActive: (id: string, active: boolean) => void;
  onDelete: (monitorId: string) => Promise<void>;
  onLockedFrequency: (freq: MonitorFrequency) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const drawerId = useId();

  const busy = activity !== null;
  const status = monitorStatus(monitor, activity === "scraping", activity === "queued");
  const url = monitor.config?.url ?? "";
  const label = monitor.config?.label ?? "Custom page";
  const hint = monitor.config?.hint;
  const nextScanShort = nextScanIn(monitor, status, monitoringPaused);

  return (
    <div
      data-open={open || undefined}
      className={cn(
        "group/row transition-colors",
        open ? "bg-surface-2" : "hover:bg-surface-2/50",
      )}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-3 px-4 py-2"
      >
        <button
          type="button"
          onClick={(e) => {
            // Without this the parent handler fires too and toggles right back.
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-controls={drawerId}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <SourceStatusIcon status={status} />
          <span title={label} className="w-[132px] shrink-0 truncate text-sm font-medium">
            {label}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              status === "failed" ? "text-critical" : "text-muted-foreground",
            )}
          >
            {lastScanLabel(monitor, status)}
          </span>
        </button>

        {/* Actions carry their own click; the row must not also swallow it. */}
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
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

          <span className="hidden text-xs capitalize tabular-nums text-muted-foreground sm:inline">
            {monitor.frequency}
            {nextScanShort && (
              <span className="normal-case text-muted-foreground">
                {" · "}
                {nextScanShort === "paused" ? nextScanShort : `next ${nextScanShort}`}
              </span>
            )}
          </span>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            tabIndex={-1}
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground"
          >
            <CaretRightIcon
              size={16}
              className={cn("transition-transform duration-200", open && "rotate-90")}
            />
          </button>
        </div>
      </div>

      {/* Same drawer mechanics as SourceRow: the grid track animates, so the real
          height eases and the rows below travel with it. */}
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
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">How often</p>
              <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
                {MONITOR_FREQUENCIES.map((freq) => {
                  const freqLocked = !planIncludesFrequency(plan, freq);
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
                        freqLocked
                          ? onLockedFrequency(freq)
                          : void onEdit(monitor.id, { frequency: freq })
                      }
                    >
                      {freqLocked && <LockIcon size={16} className="opacity-70" />}
                      {freq}
                      {freqLocked && (
                        <span className="text-meta uppercase tracking-wide opacity-70">
                          {PLAN_LABELS[minPlanForFrequency(freq)]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Monitoring</p>
              <div className="flex items-center gap-2">
                <Switch
                  checked={monitor.isActive !== false}
                  onCheckedChange={(v) => onSetActive(monitor.id, v)}
                  aria-label={`${label} monitoring`}
                />
                <span className="text-sm text-muted-foreground">
                  {monitor.isActive === false ? "Off" : "On"}
                </span>
              </div>
            </div>

            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Page</p>
              <div className="flex flex-col gap-1">
                {hint && (
                  <span className="text-sm text-muted-foreground">{HINT_LABELS[hint]}</span>
                )}
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={url}
                    className="inline-flex max-w-full items-center gap-1 text-xs text-link hover:underline focus-visible:outline-none focus-visible:underline"
                  >
                    <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
                    <ArrowSquareOutIcon size={14} className="shrink-0" />
                  </a>
                )}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Remove</p>
              {confirming ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await onDelete(monitor.id);
                    } finally {
                      setDeleting(false);
                      setConfirming(false);
                    }
                  }}
                >
                  {deleting ? <SpinnerIcon size={16} className="animate-spin" /> : null}
                  Remove this page?
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-critical"
                  onClick={() => setConfirming(true)}
                >
                  <TrashIcon size={16} /> Stop watching
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddCustomDialog({
  open,
  competitorUrl,
  onClose,
  onAdd,
}: {
  open: boolean;
  competitorUrl: string;
  onClose: () => void;
  onAdd: CustomSourcesProps["onAdd"];
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [hint, setHint] = useState<CustomMonitorHint>("product");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel("");
      setUrl("");
      setHint("product");
      setBusy(false);
      setServerError(null);
    }
  }, [open]);

  const domain = normalizeHostname(competitorUrl);
  const trimmedUrl = url.trim();
  const trimmedLabel = label.trim();
  const urlValid = trimmedUrl.length > 0 && validateCustomMonitorUrl(trimmedUrl, competitorUrl).ok;
  const canSubmit = !busy && trimmedLabel.length > 0 && urlValid;

  async function submit() {
    setBusy(true);
    setServerError(null);
    try {
      const res = await onAdd({ url: trimmedUrl, label: trimmedLabel, hint });
      if (res.ok) {
        onClose();
      } else {
        setServerError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Watch a custom page</DialogTitle>
          <DialogDescription>
            Track any page on {domain ?? "this competitor's domain"}, and we&apos;ll capture
            changes and surface them as signals. Subdomains are fine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Label</p>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Security page"
              maxLength={60}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Page URL</p>
            <div className="relative">
              <LinkIcon
                size={16}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (serverError) setServerError(null);
                }}
                placeholder={`https://${domain ?? "example.com"}/security`}
                inputMode="url"
                autoComplete="off"
                className="pl-8"
                aria-invalid={trimmedUrl !== "" && !urlValid}
              />
            </div>
            {trimmedUrl !== "" && !urlValid ? (
              <p className="text-xs text-critical">
                Must be an https page on {domain ?? "the competitor's domain"}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Must be on {domain ?? "the competitor's domain"} (subdomains allowed).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Page type</p>
            <Select value={hint} onValueChange={(v) => setHint(v as CustomMonitorHint)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_MONITOR_HINTS.map((h) => (
                  <SelectItem key={h} value={h}>
                    {HINT_LABELS[h]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Helps us judge how important a change on this page is.
            </p>
          </div>

          {serverError && <p className="text-xs text-critical">{serverError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit}>
            {busy && <SpinnerIcon size={16} className="animate-spin" />}
            Watch page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
