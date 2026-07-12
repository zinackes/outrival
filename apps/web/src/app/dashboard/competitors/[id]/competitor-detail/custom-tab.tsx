"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  FileSearch,
  Plus,
  Lock,
  Loader2,
  Play,
  Trash2,
  ExternalLink,
  Link2,
} from "lucide-react";
import {
  PLAN_LABELS,
  CUSTOM_MONITOR_HINTS,
  customMonitorLimit,
  minPlanForCustomMonitors,
  validateCustomMonitorUrl,
  normalizeHostname,
  type Plan,
  type CustomMonitorHint,
} from "@outrival/shared";
import type { ChangeRow, CompetitorSignal, Monitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { ChangeCard } from "./changes";

// Result of an add attempt: `ok` closes the dialog, otherwise the message is
// shown inline so the user can fix the URL without losing what they typed.
export type CustomAddResult = { ok: true } | { ok: false; message: string };

export interface CustomTabProps {
  competitorUrl: string;
  plan: Plan;
  monitors: Monitor[];
  scrapingIds: Set<string>;
  changes: ChangeRow[];
  signals: CompetitorSignal[];
  onRun: (id: string) => void;
  onRefresh?: () => void;
  onAddCustom: (input: {
    url: string;
    label: string;
    hint: CustomMonitorHint;
  }) => Promise<CustomAddResult>;
  onDelete: (monitorId: string) => Promise<void>;
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

export function CustomTab({
  competitorUrl,
  plan,
  monitors,
  scrapingIds,
  changes,
  signals,
  onRun,
  onRefresh,
  onAddCustom,
  onDelete,
  onLocked,
}: CustomTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const customMonitors = monitors.filter((m) => m.sourceType === "custom");
  const limit = customMonitorLimit(plan);
  const used = customMonitors.length;
  const locked = limit === 0;
  const atLimit = used >= limit;

  const customChanges = changes.filter((c) => c.sourceType === "custom");
  const insightByChangeId = new Map<string, string>();
  for (const s of signals) {
    if (s.changeId) insightByChangeId.set(s.changeId, s.insight);
  }

  // Free plan: no list, just the upsell.
  if (locked && customMonitors.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center">
        <FileSearch size={20} className="text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Watch a custom page</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Track any page on this competitor&apos;s site — pricing FAQs, a security or
          trust page, terms of service, a specific docs page. Available from the{" "}
          {PLAN_LABELS[minPlanForCustomMonitors()]} plan.
        </p>
        <Button size="sm" onClick={onLocked}>
          <Lock size={12} /> Upgrade to watch pages
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
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
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
              <Plus size={12} /> Watch a page
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
          <TabSection>
            <ul className="flex flex-col divide-y divide-border">
              {customMonitors.map((m) => (
                <CustomMonitorRow
                  key={m.id}
                  monitor={m}
                  running={scrapingIds.has(m.id)}
                  onRun={onRun}
                  onDelete={onDelete}
                />
              ))}
            </ul>
            {atLimit && !locked && (
              <p className="mt-3 text-xs text-muted-foreground">
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
          </TabSection>
        )}
      </TabCard>

      {customChanges.length > 0 && (
        <TabCard>
          <TabSection title="Recent changes" icon={FileSearch}>
            <ul className="flex flex-col divide-y divide-border">
              {customChanges.map((c) => (
                <li key={c.id} className="py-3.5 first:pt-0 last:pb-0">
                  <ChangeCard
                    change={c}
                    onRefresh={onRefresh}
                    fallbackUrl={competitorUrl}
                    insight={insightByChangeId.get(c.id)}
                  />
                </li>
              ))}
            </ul>
          </TabSection>
        </TabCard>
      )}

      <AddCustomDialog
        open={dialogOpen}
        competitorUrl={competitorUrl}
        onClose={() => setDialogOpen(false)}
        onAddCustom={onAddCustom}
      />
    </div>
  );
}

function CustomMonitorRow({
  monitor,
  running,
  onRun,
  onDelete,
}: {
  monitor: Monitor;
  running: boolean;
  onRun: (id: string) => void;
  onDelete: (monitorId: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const url = monitor.config?.url ?? "";
  const label = monitor.config?.label ?? "Custom page";
  const hint = monitor.config?.hint;

  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
          {hint && (
            <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-meta text-muted-foreground">
              {HINT_LABELS[hint]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 font-mono hover:text-foreground"
            >
              <span className="truncate">{url}</span>
              <ExternalLink size={11} className="shrink-0" />
            </a>
          )}
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="shrink-0">
            {monitor.lastRunAt
              ? `Checked ${formatDistanceToNow(new Date(monitor.lastRunAt), { addSuffix: true })}`
              : "Not scraped yet"}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant={running ? "secondary" : "outline"}
          className="h-7 text-xs"
          onClick={() => onRun(monitor.id)}
          disabled={running}
        >
          {running ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Scraping…
            </>
          ) : (
            <>
              <Play size={12} /> Scrape
            </>
          )}
        </Button>
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
            {deleting ? <Loader2 size={12} className="animate-spin" /> : null}
            Remove?
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground hover:text-critical"
            aria-label="Remove this custom page"
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </li>
  );
}

function AddCustomDialog({
  open,
  competitorUrl,
  onClose,
  onAddCustom,
}: {
  open: boolean;
  competitorUrl: string;
  onClose: () => void;
  onAddCustom: CustomTabProps["onAddCustom"];
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
      const res = await onAddCustom({ url: trimmedUrl, label: trimmedLabel, hint });
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
            Track any page on {domain ?? "this competitor's domain"} — we&apos;ll capture
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
              <Link2
                size={14}
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
            {busy && <Loader2 size={12} className="animate-spin" />}
            Watch page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
