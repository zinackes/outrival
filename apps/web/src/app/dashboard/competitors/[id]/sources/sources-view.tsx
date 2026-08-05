"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeftIcon, CaretRightIcon, LockIcon, SpinnerIcon, PlayIcon } from "@/components/icons";
import {
  ALL_CONFIGURABLE_SOURCES,
  ATTENTION_OF,
  AUTOMATIC_SOURCES,
  CONFIGURABLE_SOURCES,
  PLAN_LABELS,
  RIBBON_ATTENTIONS,
  SOURCE_GROUPS,
  SOURCE_GROUP_LABELS,
  automaticFrequencyOptions,
  automaticSourceFrequencies,
  buildCoverage,
  minPlanForFeature,
  planIncludesFeature,
  sourceState,
  validateMonitorUrl,
  type DetectedTargets,
  type MonitorFrequency,
  type Plan,
  type SourceAttention,
  type SourceState,
  type SourceType,
} from "@outrival/shared";
import { api, type Monitor, type TechStackData } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PaywallDialog } from "@/components/outrival/paywall-dialog";
import { PausedMonitors } from "@/components/outrival/monitor-alternatives";
import { competitorNameColor } from "@/lib/competitor-color";
import { feedItemMotion } from "@/lib/motion";
import { sourceShortLabel } from "@/lib/source-labels";
import { ListError } from "@/components/outrival/list-error";
import { toastApiError } from "@/lib/error-helpers";
import { useCompetitorScopeGuard } from "@/hooks/use-competitor-scope-guard";
import CompetitorDetailLoading from "../detail-skeleton";
import { scrapeActivity } from "../competitor-detail/shared";
import { lastScanLabel, monitorStatus, nextScanIn } from "../competitor-detail/monitor-status";
import { useMonitorActions } from "../competitor-detail/use-monitor-actions";
import { CustomSources } from "./custom-sources";
import { SourceRow, SourceName } from "./source-row";
import { sourceCopy } from "./source-copy";

const label = (s: SourceType) => sourceShortLabel(s).toLowerCase();

/**
 * How each attention group presents itself. The three ways a source can be off are
 * three different facts with three different answers, and only ONE of them is a
 * task — so they get three headings instead of one, and the heading says out loud
 * whether there is anything to do.
 */
const ATTENTION_META: Record<
  SourceAttention,
  { chip: string; swatch: string; heading?: string; aside?: string; tone?: string }
> = {
  // The two groups that need no heading: their rows sit under the catalog groups
  // the user already thinks in (Web & content, Pricing, …).
  collecting: { chip: "collecting", swatch: "bg-positive" },
  idle: { chip: "not set up", swatch: "bg-border-strong" },

  fixable: {
    chip: "needs a new URL",
    swatch: "bg-critical",
    heading: "Needs a new URL",
    aside: "You can fix this one",
    tone: "text-critical",
  },
  closed: {
    chip: "closed to us",
    swatch: "bg-medium",
    heading: "Closed to us",
    aside: "Nothing to do, we don't force a closed door",
    tone: "text-medium",
  },
  unavailable: {
    chip: "no such surface",
    swatch: "border border-muted-foreground/60",
    heading: "No such surface",
    aside: "Add one if you know better",
  },
};

/** Chip order: what asks for something, then what works, then what doesn't. */
const CHIP_ORDER: readonly SourceAttention[] = [
  "collecting",
  "fixable",
  "closed",
  "idle",
  "unavailable",
];

function detectedTargetsOf(techStack: TechStackData): DetectedTargets | null {
  const profile = techStack.platformProfile;
  if (!profile) return null;
  return { statusPage: !!profile.statusPage?.value, changelog: !!profile.changelog?.value };
}

/** A group heading inside the single sheet, replacing what used to be a whole Card. */
export function GroupLabel({
  children,
  aside,
  tone,
}: {
  children: React.ReactNode;
  aside?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline gap-2.5 px-4 pb-1.5 pt-4">
      <h2
        className={cn(
          "text-meta font-semibold uppercase tracking-[0.06em]",
          tone ?? "text-muted-foreground",
        )}
      >
        {children}
      </h2>
      {aside && <span className="text-meta text-muted-foreground">{aside}</span>}
      <span className="h-px flex-1 self-center bg-border" />
    </div>
  );
}

/**
 * A block of read-only rows that carries no decision, collapsed to one line. Seven
 * always-on sources took a seventh of the page while offering nothing to change.
 */
function CollapsedBlock({
  title,
  summary,
  cta,
  children,
}: {
  title: string;
  summary: string;
  cta: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="shrink-0 text-sm font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summary}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {open ? "Hide" : cta}
          <CaretRightIcon
            size={16}
            className={cn("transition-transform duration-200", open && "rotate-90")}
          />
        </span>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-[var(--duration-standard)] ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border">{children}</div>
        </div>
      </div>
    </Card>
  );
}

/**
 * The one always-on source a user can overrule. YouTube is discovered from a link
 * on the competitor's site, so a company that has a channel but doesn't link it
 * reads as "no channel" forever. The monitor already exists (it ran and threw), so
 * this retargets it rather than enabling anything.
 *
 * Deliberately inline and tiny: the only thing this block configures is a cadence,
 * and one source having a URL escape hatch must not turn it into a second Sources
 * page.
 */
function PinChannel({
  monitor,
  onEdit,
}: {
  monitor: Monitor;
  onEdit: (id: string, patch: { url?: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const url = value.trim();
    if (!url) return;
    const valid = validateMonitorUrl("youtube", url, null);
    if (!valid.ok) {
      setError("That has to be a youtube.com channel link.");
      return;
    }
    setSaving(true);
    try {
      await onEdit(monitor.id, { url: valid.url });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-7 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        Point us at one
      </Button>
    );
  }
  return (
    <div className="mt-1 w-full">
      <div className="flex flex-wrap gap-2">
        <Input
          autoFocus
          value={value}
          aria-label="YouTube channel URL"
          aria-invalid={!!error}
          placeholder="https://www.youtube.com/@example"
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !saving) void save();
          }}
          className="min-w-[220px] flex-1"
        />
        <Button size="sm" onClick={save} disabled={saving || !value.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-critical">{error}</p>}
    </div>
  );
}

/**
 * How often we look at an always-on source. Same one-track segmented control as a
 * configurable row's drawer, because it is the same setting — the difference is
 * WHICH positions exist, and that is the source's own ceiling
 * (automaticSourceFrequencies), not the tier's.
 *
 * Below pro the track still renders, locked: these rows were an unexplained "watched
 * weekly" for every plan, and a padlock on the cadence says what the upgrade buys far
 * better than a sentence in the block summary.
 */
function AlwaysOnCadence({
  sourceType,
  monitor,
  plan,
  monitoringPaused,
  scraping,
  queued,
  onEdit,
  onLocked,
}: {
  sourceType: SourceType;
  monitor: Monitor;
  plan: Plan;
  monitoringPaused: boolean;
  scraping: boolean;
  queued: boolean;
  onEdit: (id: string, patch: { frequency?: MonitorFrequency }) => Promise<void>;
  onLocked: () => void;
}) {
  const segments = automaticSourceFrequencies(sourceType);
  const allowed = automaticFrequencyOptions(plan, sourceType);
  const locked = allowed.length === 0;
  const next = nextScanIn(monitor, monitorStatus(monitor, scraping, queued), monitoringPaused);

  return (
    <div className="ml-auto flex items-center gap-2">
      <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
        {segments.map((freq) => {
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
              onClick={() => (locked ? onLocked() : void onEdit(monitor.id, { frequency: freq }))}
            >
              {locked && selected && <LockIcon size={14} className="opacity-70" />}
              {freq}
            </button>
          );
        })}
      </div>
      {locked ? (
        <span className="text-meta uppercase tracking-wide text-muted-foreground">
          {PLAN_LABELS[minPlanForFeature("alwaysOnCadence")]}
        </span>
      ) : (
        next && (
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
            {next === "paused" ? next : `next ${next}`}
          </span>
        )
      )}
    </div>
  );
}

/**
 * Everything that governs what we collect on one competitor. Split out of the
 * detail page so the tabs are purely for reading and this is purely for deciding.
 *
 * The page is scanned to find what needs a decision, not read in catalog order, so
 * it is ONE sheet ranked by attention rather than eight cards ranked by taxonomy.
 */
export function SourcesView({ id }: { id: string }) {
  const {
    data,
    error,
    scrapingIds,
    runningAll,
    paywall,
    setPaywall,
    refresh,
    requestRunMonitor,
    runAllMonitors,
    enableMonitor,
    editMonitor,
    setMonitorActive,
    addCustomMonitor,
    removeCustomMonitor,
  } = useMonitorActions(id);
  const [techScraping, setTechScraping] = useState(false);
  const [filter, setFilter] = useState<SourceAttention | null>(null);
  // Switching the product scope to one that doesn't track this competitor leaves
  // here for that product's roster.
  useCompetitorScopeGuard(id, data?.competitor.name);

  // Dev-only: force a tech-stack scan. The job updates techStackScrapedAt + entries,
  // so a timed refresh surfaces the result — no monitor-keyed polling like a source.
  async function scrapeTechStack() {
    setTechScraping(true);
    try {
      await api.scrapeTechStack(id);
      setTimeout(() => {
        void refresh();
        setTechScraping(false);
      }, 8000);
    } catch (e) {
      toastApiError(e, { title: "Couldn't trigger the tech-stack scan" });
      setTechScraping(false);
    }
  }

  const monitors = data?.monitors;
  const plan = data?.plan;
  const techStack = data?.techStack;
  const targets = techStack ? detectedTargetsOf(techStack) : null;

  // One classification pass, read by the ribbon, the chips and every group.
  const states = useMemo(() => {
    if (!monitors || !plan) return null;
    const bySource = new Map(monitors.map((m) => [m.sourceType, m]));
    return ALL_CONFIGURABLE_SOURCES.map((sourceType) => {
      const state = sourceState({
        sourceType,
        plan,
        monitor: bySource.get(sourceType) ?? null,
        targets,
      });
      return { sourceType, state, attention: ATTENTION_OF[state] };
    });
  }, [monitors, plan, targets]);

  if (error && !data) {
    return (
      <div className="mt-10">
        <ListError error={error} onRetry={refresh} />
      </div>
    );
  }
  if (!data || !states || !plan || !techStack || !monitors) return <CompetitorDetailLoading />;

  const { competitor, automaticMonitors } = data;
  const bySource = new Map(monitors.map((m) => [m.sourceType, m]));
  // Scraping vs queued in one call. The tracking set alone can't tell them apart:
  // it holds queued jobs too, so using it as "running" made every waiting source
  // claim a scan was under way.
  const activityOf = (m: Monitor) => scrapeActivity(m, scrapingIds.has(m.id));

  const coverage = buildCoverage(states);
  // Quoted in the blocked message so a protected surface reads as "we route around
  // it", not "we're stuck".
  const fallbacks = [...coverage.tracked, ...coverage.pending].map(label);

  const countOf = (a: SourceAttention) => states.filter((s) => s.attention === a).length;
  const applicable = states.filter((s) => s.attention !== "unavailable").length;
  const visible = (attention: SourceAttention) => filter === null || filter === attention;

  const renderRow = (sourceType: SourceType, state: SourceState) => {
    const monitor = bySource.get(sourceType) ?? null;
    return (
      <SourceRow
        key={sourceType}
        sourceType={sourceType}
        monitor={monitor}
        plan={plan}
        targets={targets}
        competitorUrl={competitor.url}
        fallbacks={fallbacks.filter((f) => f !== label(sourceType))}
        activity={monitor ? activityOf(monitor) : null}
        monitoringPaused={competitor.monitoringPaused || Boolean(competitor.pausedByPlan)}
        onRun={requestRunMonitor}
        onEnable={enableMonitor}
        onEdit={editMonitor}
        onSetActive={setMonitorActive}
        onLockedFrequency={(frequency) =>
          setPaywall({ code: "plan_locked_frequency", frequency, plan })
        }
        onUpgrade={(source) => setPaywall({ code: "plan_locked_source", source, plan })}
      />
    );
  };

  /** The rows of one attention group, in catalog order. */
  const groupRows = (attention: SourceAttention) =>
    states.filter((s) => s.attention === attention).map((s) => renderRow(s.sourceType, s.state));

  const chips = CHIP_ORDER.map((key) => ({ key, count: countOf(key), ...ATTENTION_META[key] })).filter(
    (c) => c.count > 0,
  );

  const automaticSummary = AUTOMATIC_SOURCES.map((s) => sourceShortLabel(s)).join(", ");
  // These rows are seeded and free on every plan; from pro up each one also carries a
  // cadence. The summary has to say which of the two is true here, because the block
  // is collapsed and the padlock inside it is the only other place that says so.
  const canTuneAlwaysOn = planIncludesFeature(plan, "alwaysOnCadence");
  const automaticSummaryLine = canTuneAlwaysOn
    ? `Watched for free, cadence yours to set: ${automaticSummary}, tech stack.`
    : `Watched for free, nothing to configure: ${automaticSummary}, tech stack.`;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              href={`/dashboard/competitors/${id}`}
              aria-label="Back to competitor"
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeftIcon size={16} />
            </Link>
            <div className="min-w-0">
              <h1 className="m-0 text-title font-bold leading-tight tracking-tight">Sources</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                What we collect on{" "}
                <span style={competitorNameColor(competitor.color)}>{competitor.name}</span>
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => void runAllMonitors()}
            disabled={runningAll}
            className="h-8 shrink-0 text-xs"
          >
            {runningAll ? <SpinnerIcon size={16} className="animate-spin" /> : <PlayIcon size={16} />}
            Scan all
          </Button>
        </div>

        {/* The coverage headline as a shape. Its denominator is the APPLICABLE
            sources only: `not_available` gets a chip but no segment, because a
            surface a competitor doesn't have was never a gap. That exclusion is the
            whole statement, so it carries no caption. */}
        {applicable > 0 && (
          <div
            className="flex h-2 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={RIBBON_ATTENTIONS.filter((a) => countOf(a) > 0)
              .map((a) => `${countOf(a)} ${ATTENTION_META[a].chip}`)
              .join(", ")}
          >
            {RIBBON_ATTENTIONS.filter((a) => countOf(a) > 0).map((a) => (
              <span
                key={a}
                style={{ flexGrow: countOf(a) }}
                className={cn(
                  "block transition-opacity duration-200",
                  ATTENTION_META[a].swatch,
                  filter !== null && filter !== a && "opacity-20",
                )}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={filter === c.key}
              onClick={() => setFilter((f) => (f === c.key ? null : c.key))}
              className={cn(
                "inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === c.key
                  ? "border-border-strong bg-surface-2 text-foreground"
                  : "border-border text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <span className={cn("h-[7px] w-[7px] rounded-full", c.swatch)} />
              <span className="font-semibold tabular-nums text-foreground">{c.count}</span>
              {c.chip}
            </button>
          ))}
        </div>

        {/* A source we auto-paused after repeated failures keeps its recovery card
            (set a URL / enter the data / resume) — the row above states the problem,
            this offers the diagnosis-specific way out. */}
        <PausedMonitors
          monitors={monitors.filter((m) => m.markedUnscrapable)}
          onResolved={refresh}
        />

        {/* Picking a chip swaps most of the sheet at once, so the groups it drops
            leave and the ones it keeps travel to their new place, on the same spring
            as the competitors list. The sheet used to be re-keyed on the chip and
            faded in whole, which cost every open drawer on every filter click. */}
        <Card className="overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            {/* Pinned above the taxonomy: the only group that asks for something. */}
            {countOf("fixable") > 0 && visible("fixable") && (
              <motion.div key="fixable" {...feedItemMotion} layout="position">
                <GroupLabel aside={ATTENTION_META.fixable.aside} tone={ATTENTION_META.fixable.tone}>
                  {ATTENTION_META.fixable.heading}
                </GroupLabel>
                {groupRows("fixable")}
              </motion.div>
            )}

            {/* Everything applicable and workable, still in catalog order — a source's
                group is how the user thinks about it, so it survives the reranking. */}
            {SOURCE_GROUPS.map((group) => {
              const rows = states.filter(
                (s) =>
                  CONFIGURABLE_SOURCES[group].includes(s.sourceType) &&
                  (s.attention === "collecting" || s.attention === "idle") &&
                  visible(s.attention),
              );
              if (rows.length === 0) return null;
              return (
                <motion.div key={group} {...feedItemMotion} layout="position">
                  <GroupLabel>{SOURCE_GROUP_LABELS[group]}</GroupLabel>
                  {rows.map((s) => renderRow(s.sourceType, s.state))}
                </motion.div>
              );
            })}

            {/* A refusal is not a task. Amber, its own heading, and a subtitle that
                says there is nothing to do — otherwise the page contradicts the
                sentence printed inside these very rows. */}
            {countOf("closed") > 0 && visible("closed") && (
              <motion.div key="closed" {...feedItemMotion} layout="position">
                <GroupLabel aside={ATTENTION_META.closed.aside} tone={ATTENTION_META.closed.tone}>
                  {ATTENTION_META.closed.heading}
                </GroupLabel>
                {groupRows("closed")}
              </motion.div>
            )}

            {/* The group that used to be a dead end. Neutral tone, and now an offer. */}
            {countOf("unavailable") > 0 && visible("unavailable") && (
              <motion.div key="unavailable" {...feedItemMotion} layout="position">
                <GroupLabel aside={ATTENTION_META.unavailable.aside}>
                  {ATTENTION_META.unavailable.heading}
                </GroupLabel>
                {groupRows("unavailable")}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Deliberately NOT collapsed like the read-only block below: this one holds
            a real action (watch a page), a quota, and the free-plan upsell. Hiding a
            feature behind a disclosure is a different mistake from showing noise. */}
        <CustomSources
          competitorUrl={competitor.url ?? ""}
          plan={plan}
          monitors={monitors}
          scrapingIds={scrapingIds}
          monitoringPaused={competitor.monitoringPaused || Boolean(competitor.pausedByPlan)}
          onRun={requestRunMonitor}
          onAdd={addCustomMonitor}
          onEdit={editMonitor}
          onSetActive={setMonitorActive}
          onDelete={removeCustomMonitor}
          onLockedFrequency={(frequency) =>
            setPaywall({ code: "plan_locked_frequency", frequency, plan })
          }
          onLocked={() =>
            setPaywall({ code: "plan_limit_custom_monitors", plan, used: 0, limit: 0 })
          }
        />

        <CollapsedBlock title="Always on" summary={automaticSummaryLine} cta="Show">
          <ul className="divide-y divide-border">
            {AUTOMATIC_SOURCES.map((sourceType) => {
              const monitor =
                automaticMonitors.find((m) => m.sourceType === sourceType) ?? null;
              // An automatic source can also be "not applicable" — a competitor with
              // no YouTube channel. Report that neutrally here too, so the read-only
              // list never blames a failure the classifier calls a non-event.
              const state = sourceState({ sourceType, plan, monitor, targets });
              const message =
                state === "not_available"
                  ? sourceCopy({ state, sourceType }).message
                  : monitor
                    ? lastScanLabel(
                        monitor,
                        monitorStatus(
                          monitor,
                          activityOf(monitor) === "scraping",
                          activityOf(monitor) === "queued",
                        ),
                      )
                    : "Not seeded yet";
              return (
                <li
                  key={sourceType}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
                >
                  <SourceName
                    label={sourceShortLabel(sourceType)}
                    url={monitor?.pageUrl ?? null}
                  />
                  {/* Same split as the configurable rows: a freshness stamp is meta,
                      "they don't have this surface" is read. */}
                  <span
                    className={cn(
                      "text-muted-foreground",
                      state === "not_available" ? "text-sm" : "text-xs",
                    )}
                  >
                    {message}
                  </span>
                  {sourceType === "youtube" && state === "not_available" && monitor && (
                    <PinChannel monitor={monitor} onEdit={editMonitor} />
                  )}
                  {/* Only where a schedule is a real thing to state. A source we've
                      never run, one the site refuses, or one this competitor simply
                      doesn't have has no next scan to move. */}
                  {monitor && (state === "tracking" || state === "pending") && (
                    <AlwaysOnCadence
                      sourceType={sourceType}
                      monitor={monitor}
                      plan={plan}
                      monitoringPaused={
                        competitor.monitoringPaused || Boolean(competitor.pausedByPlan)
                      }
                      scraping={activityOf(monitor) === "scraping"}
                      queued={activityOf(monitor) === "queued"}
                      onEdit={editMonitor}
                      onLocked={() =>
                        setPaywall({ code: "plan_locked_feature", feature: "alwaysOnCadence", plan })
                      }
                    />
                  )}
                </li>
              );
            })}
            {/* Tech stack isn't a monitor — it runs on its own monthly cron keyed on
                competitors.tech_stack_scraped_at — so it has no toggle or schedule
                here either. The Run button is dev-only (stripped from production
                bundles; /api/dev is likewise unmounted in prod). */}
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="w-[132px] shrink-0 truncate text-sm font-medium">Tech stack</span>
              <span className="text-xs text-muted-foreground">
                {techScraping
                  ? "Scanning…"
                  : techStack.lastScrapedAt
                    ? `Scanned ${formatDistanceToNow(new Date(techStack.lastScrapedAt), { addSuffix: true })}`
                    : "Never scanned"}
              </span>
              {process.env.NODE_ENV !== "production" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 text-xs"
                  onClick={scrapeTechStack}
                  disabled={techScraping}
                >
                  {techScraping ? (
                    <SpinnerIcon size={16} className="animate-spin" />
                  ) : (
                    <PlayIcon size={16} />
                  )}
                  Run
                </Button>
              )}
            </li>
          </ul>
        </CollapsedBlock>

        <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      </div>
    </TooltipProvider>
  );
}
