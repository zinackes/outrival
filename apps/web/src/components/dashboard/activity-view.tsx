"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { Activity, ChevronRight, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  type ActivitySource,
  type ActivityUpcoming,
  type ActivityEvent,
  type ActivityChange,
  type ActivityCaptured,
  type ActivityStatusFilter,
} from "@/lib/api";
import {
  activityHealthQuery,
  activityTimelineQuery,
  ACTIVITY_PAGE_SIZE,
} from "@/lib/queries";
import { sourceLabel } from "@/lib/source-labels";
import { formatDateTime } from "@/lib/format-date";
import { competitorNameColor } from "@/lib/competitor-color";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageHead } from "./page-head";
import { useSetAskContext } from "./ask-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = ACTIVITY_PAGE_SIZE;

// The four user-facing outcomes, derived from the raw run status below. The raw
// scrape_runs.status="success" covers three different things — a real change, a
// monitor's baseline capture, and a sub-threshold content shift — so a flat
// status→label map would mislabel a first scrape as "Change detected".
const OUTCOME_META: Record<ActivityStatusFilter, { label: string; color: string }> = {
  change: { label: "Change detected", color: "var(--positive)" },
  first_capture: { label: "First capture", color: "var(--link)" },
  no_change: { label: "No change", color: "var(--muted-foreground)" },
  failed: { label: "Couldn't reach", color: "var(--critical)" },
};

const OUTCOME_ORDER: ActivityStatusFilter[] = [
  "change",
  "first_capture",
  "no_change",
  "failed",
];

// Map a run to its outcome: a successful run is a real change only when it carries
// a change row; the first-ever capture (no diff possible) is "First capture"; a
// success that produced neither (content shifted but nothing material) folds into
// "No change", alongside the dedup no-change runs.
function eventOutcome(e: ActivityEvent): ActivityStatusFilter {
  if (e.status === "failed") return "failed";
  if (e.status === "success") {
    if (e.changeId) return "change";
    if (e.isFirstCapture) return "first_capture";
  }
  return "no_change";
}

function rel(iso: string | null): string {
  if (!iso) return "never";
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

function duration(ms: number): string {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Absolute date + time for the "When" hover tooltip. Clock adapts to the viewer's
// region (24h in FR, 12h in US); text stays English. See lib/format-date.
function absDateTime(iso: string): string {
  return formatDateTime(iso);
}


function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
      aria-hidden
    />
  );
}

// Readable label per structured-diff kind (homepage). Sentence case, not an
// uppercase mono eyebrow — these read as plain field names, not tags.
const KIND_LABEL: Record<string, string> = {
  hero_headline_changed: "Headline",
  hero_subheadline_changed: "Subheadline",
  hero_cta_changed: "Call-to-action",
  section_added: "New section",
  section_removed: "Section removed",
  section_renamed: "Section renamed",
  section_body_changed: "Section updated",
  navigation_changed: "Navigation",
  meta_changed: "Branding",
  social_proof_changed: "Social proof",
  visual_redesign: "Visual redesign",
  numeric_claim_changed: "Metric",
  customer_logo_added: "New customer",
  customer_logo_removed: "Customer removed",
  testimonial_added: "New testimonial",
  testimonial_removed: "Testimonial removed",
};

// Kinds with no natural before/after — show a plain phrase instead of an arrow.
const STATIC_PHRASE: Record<string, string> = {
  visual_redesign: "The homepage was visually redesigned",
  section_reordered: "Sections were reordered",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "Change";
}

// "sections[pricing]" → "pricing" — a readable subject for section_* kinds that
// carry no before/after value of their own.
function sectionName(field: string): string | null {
  const m = field.match(/sections?\[([^\]]+)\]/i);
  return m ? m[1]!.replace(/[_-]+/g, " ") : null;
}

// A row can be expanded when there's something worth showing. "change" rows need
// real change detail; "first_capture" and "no_change" rows always expand — they
// carry an explanation + a link to the live page so a quiet run is never a dead
// end. "failed" stays collapsed (its status already says it couldn't be reached).
function isExpandable(e: ActivityEvent): boolean {
  const outcome = eventOutcome(e);
  if (outcome === "first_capture" || outcome === "no_change") return true;
  if (outcome === "change") {
    return Boolean(
      (e.structuredChanges && e.structuredChanges.length > 0) ||
        e.humanChangeBefore ||
        e.humanChangeAfter ||
        e.changeSummary,
    );
  }
  return false;
}

// One labeled before→after line. Renders the arrow only when both sides exist;
// degrades to a single value (added/removed) or a static phrase otherwise.
function ChangeLine({ change }: { change: ActivityChange }) {
  const before = change.before?.trim() || null;
  const after = change.after?.trim() || null;
  const subject = sectionName(change.field);

  let body: ReactNode;
  if (before && after) {
    body = (
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-muted-foreground">{before}</span>
        <span className="text-muted-foreground" aria-hidden>
          →
        </span>
        <span className="text-foreground">{after}</span>
      </span>
    );
  } else if (after) {
    body = <span className="text-foreground">{after}</span>;
  } else if (before) {
    body = <span className="text-muted-foreground line-through">{before}</span>;
  } else if (subject) {
    body = <span className="text-foreground capitalize">{subject}</span>;
  } else {
    body = (
      <span className="text-muted-foreground">
        {STATIC_PHRASE[change.kind] ?? "Updated"}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-32 shrink-0 text-meta text-muted-foreground">
        {kindLabel(change.kind)}
      </span>
      <div className="min-w-0 flex-1 text-sm">{body}</div>
    </div>
  );
}

// Precise, readable breakdown of what a run found: typed homepage changes first
// (richest), else the AI-distilled plain before/after, else the summary.
function ChangeDetail({ event }: { event: ActivityEvent }) {
  const changes = event.structuredChanges ?? [];
  const hasHuman = Boolean(event.humanChangeBefore || event.humanChangeAfter);

  if (changes.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {changes.map((c, i) => (
          <ChangeLine key={`${c.kind}-${c.field}-${i}`} change={c} />
        ))}
      </div>
    );
  }

  if (hasHuman) {
    return (
      <ChangeLine
        change={{
          kind: "",
          field: "",
          before: event.humanChangeBefore ?? null,
          after: event.humanChangeAfter ?? null,
        }}
      />
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      {event.changeSummary ?? "No detail captured for this change."}
    </p>
  );
}

// "View live page" — opens the exact page this run inspected (snapshot resolved
// URL, else the competitor site). Hidden when no URL is known (rare).
function LivePageLink({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-link hover:underline"
    >
      <ExternalLink className="size-3.5" aria-hidden />
      View live page
    </a>
  );
}

// Detail for a quiet run (no change to show): explain what happened so the row
// isn't a dead end, plus a link out to the page we actually checked.
function QuietRunDetail({
  outcome,
  event,
}: {
  outcome: ActivityStatusFilter;
  event: ActivityEvent;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        {outcome === "first_capture"
          ? "First time we captured this page. We saved it as the baseline — every future check is compared against it, and anything that changes shows up here."
          : "We checked this page and it matches our last capture — nothing changed."}
      </p>
      {outcome === "no_change" && event.lastChangedAt && (
        <p className="text-muted-foreground">
          Last actual change{" "}
          <span className="tabular-nums">{rel(event.lastChangedAt)}</span>.
        </p>
      )}
      <LivePageLink url={event.url} />
    </div>
  );
}

// ── Captured data (jobs / pricing / reviews) ──────────────────────────────────
// What a data source actually held on a run — the value a baseline or no-change
// row otherwise hides. Shown as a one-line summary in the "Captured" column, with
// a breakdown in the expanded panel.

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
const PERIOD_SHORT: Record<string, string> = { monthly: "mo", yearly: "yr" };

function fmtPrice(value: number | null, currency: string | null): string {
  if (value == null) return "";
  const n = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const sym = currency ? CURRENCY_SYMBOL[currency] : undefined;
  return sym ? `${sym}${n}` : currency ? `${n} ${currency}` : n;
}

// The single line for the "Captured" column. null → render "Nothing found"
// (and no "View more": a null summary means there's no payload to break down).
function capturedSummary(c: ActivityCaptured): string | null {
  if (c.kind === "jobs") {
    if (c.total === 0) return null;
    const roles = `${c.total} open role${c.total > 1 ? "s" : ""}`;
    return c.teams > 1 ? `${roles} · ${c.teams} teams` : roles;
  }
  if (c.kind === "pricing") {
    if (c.planCount === 0) return null;
    const plans = `${c.planCount} plan${c.planCount > 1 ? "s" : ""}`;
    if (c.minPrice == null) return plans; // all quote-based tiers
    const range =
      c.maxPrice != null && c.maxPrice !== c.minPrice
        ? `${fmtPrice(c.minPrice, c.currency)}–${fmtPrice(c.maxPrice, c.currency)}`
        : fmtPrice(c.minPrice, c.currency);
    return `${plans} · ${range}`;
  }
  if (c.score == null) return null;
  const stars = `${c.score.toFixed(1)}★`;
  return c.reviewCount > 0 ? `${stars} · ${c.reviewCount.toLocaleString()} reviews` : stars;
}

// "Captured" cell content: a dash for non-data sources, "Nothing found" for a
// data source whose extraction came back empty, else the summary line plus a
// "View more" that opens the breakdown modal. A non-null summary always implies a
// real payload, so the link is shown whenever there's a summary.
function CapturedCell({
  captured,
  onView,
}: {
  captured: ActivityCaptured | null | undefined;
  onView: () => void;
}) {
  if (!captured) return <span className="text-muted-foreground">—</span>;
  const summary = capturedSummary(captured);
  if (!summary) return <span className="text-muted-foreground">Nothing found</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums text-foreground">{summary}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onView();
        }}
        className="shrink-0 text-xs text-link hover:underline"
      >
        View more
      </button>
    </span>
  );
}

const REVIEW_SUBS: Array<{ key: keyof NonNullable<Extract<ActivityCaptured, { kind: "reviews" }>["subScores"]>; label: string }> = [
  { key: "easeOfUse", label: "Ease of use" },
  { key: "support", label: "Support" },
  { key: "features", label: "Features" },
  { key: "value", label: "Value" },
];

// The expanded breakdown of a run's captured data: departments, plans, or scores.
function CapturedDetail({ captured }: { captured: ActivityCaptured }) {
  if (captured.kind === "jobs") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">
          {captured.total} open role{captured.total > 1 ? "s" : ""} across {captured.teams} team
          {captured.teams > 1 ? "s" : ""}.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {captured.byDept.map((d) => (
            <li key={d.department} className="text-muted-foreground">
              <span className="text-foreground">{d.department}</span>{" "}
              <span className="tabular-nums">{d.count}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (captured.kind === "pricing") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">
          {captured.planCount} pricing plan{captured.planCount > 1 ? "s" : ""} captured.
        </p>
        <ul className="flex flex-col gap-0.5">
          {captured.plans.map((p, i) => (
            <li
              key={`${p.planName}-${i}`}
              className="flex items-baseline justify-between gap-4"
            >
              <span className="min-w-0 truncate text-foreground">{p.planName}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {p.price != null
                  ? `${fmtPrice(p.price, p.currency)}/${PERIOD_SHORT[p.billingPeriod] ?? p.billingPeriod}`
                  : "Custom"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        <span className="text-foreground tabular-nums">{captured.score?.toFixed(1)}★</span>
        {captured.reviewCount > 0 && (
          <>
            {" "}
            from <span className="tabular-nums">{captured.reviewCount.toLocaleString()}</span>{" "}
            reviews
          </>
        )}
      </p>
      {captured.subScores && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {REVIEW_SUBS.map(({ key, label }) => {
            const v = captured.subScores![key];
            if (v == null) return null;
            return (
              <li key={key} className="text-muted-foreground">
                {label} <span className="text-foreground tabular-nums">{v.toFixed(1)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Routes an expanded row to the right detail: real change breakdown, or a quiet
// run explanation (first capture / no change). The captured-data breakdown lives
// in its own modal (opened from the "Captured" column), not here.
function RunDetail({ event }: { event: ActivityEvent }) {
  const outcome = eventOutcome(event);
  if (outcome === "change") return <ChangeDetail event={event} />;
  return <QuietRunDetail outcome={outcome} event={event} />;
}

// User-facing activity: every scrape Outrival ran for the org — including the
// no-change runs and failures the Signals feed never surfaces, and what each
// "change detected" run actually found. Filterable by competitor, source, status.
export function ActivityView() {
  useSetAskContext({ kind: "view", label: "Activity timeline" });

  // Deep-link support: the competitor page links here pre-filtered
  // (?competitorId=…). Seed the filters from the URL once on mount; the user can
  // change them freely afterward (we don't push back to the URL).
  const searchParams = useSearchParams();
  const urlCompetitor = searchParams.get("competitorId") ?? "all";
  const urlSource = searchParams.get("source") ?? "all";
  const urlStatusRaw = searchParams.get("status") ?? "all";
  const urlStatus = OUTCOME_ORDER.includes(urlStatusRaw as ActivityStatusFilter)
    ? urlStatusRaw
    : "all";

  // patch-28 — active product scope (cookie-backed switcher, URL ?product= overrides).
  const productId = useProductScope() ?? undefined;

  // Server-seeded on first paint (activity/page.tsx): health (filter options) +
  // the page-1 unfiltered timeline. A URL filter produces a different timeline key,
  // so useQuery fetches that filtered page instead of the seeded unfiltered one.
  const healthQ = useQuery(activityHealthQuery(productId));
  const sources = healthQ.data?.sources ?? null;
  const upcoming = healthQ.data?.upcoming ?? [];

  const [page, setPage] = useState(1);
  const [competitor, setCompetitor] = useState(urlCompetitor);
  const [source, setSource] = useState(urlSource);
  const [status, setStatus] = useState(urlStatus);

  // Any filter change resets to page 1 in the same handler as the value change,
  // so the fetch effect (keyed on filters + page) fires exactly once.
  function onFilter(setter: (v: string) => void) {
    return (v: string) => {
      setter(v);
      setPage(1);
    };
  }

  // The run whose captured-data breakdown is open in the modal (null = closed).
  const [detailEvent, setDetailEvent] = useState<ActivityEvent | null>(null);

  // Rows expanded to reveal their precise change breakdown, keyed by row id.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const competitorOptions = useMemo(() => {
    if (!sources) return [];
    const m = new Map<string, string>();
    for (const s of sources) m.set(s.competitorId, s.competitorName);
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sources]);

  const sourceOptions = useMemo(() => {
    if (!sources) return [];
    return [...new Set(sources.map((s) => s.sourceType))].sort();
  }, [sources]);

  const filterParams = useMemo(
    () => ({
      competitorId: competitor !== "all" ? competitor : undefined,
      sourceType: source !== "all" ? source : undefined,
      status: status !== "all" ? (status as ActivityStatusFilter) : undefined,
    }),
    [competitor, source, status],
  );

  // One page server-side; key on page + filters. keepPreviousData keeps the prior
  // rows visible (dimmed) during a fetch instead of flashing — only the very first
  // load shows the empty/Loading state.
  const timelineQ = useQuery({
    ...activityTimelineQuery(page, filterParams, productId),
    placeholderData: keepPreviousData,
  });
  const events = timelineQ.data?.events ?? null;
  const total = timelineQ.data?.total ?? 0;
  const loading = timelineQ.isFetching;

  const isFiltered = competitor !== "all" || source !== "all" || status !== "all";

  // Soonest scheduled run (upcoming is already sorted soonest-first); the rest sit
  // behind a "+N more" popover so the section is a single line, not a tall card.
  const nextCheck = upcoming[0] ?? null;

  // The DOM only ever holds PAGE_SIZE rows, so the table stays light no matter how
  // deep the history.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Collapse any expanded detail rows when the page or filters change.
  useEffect(() => {
    setExpanded(new Set());
  }, [filterParams, page]);

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        flush
        icon={<Activity size={18} className="text-muted-foreground" aria-hidden />}
        title="Activity"
        sub="What Outrival has been doing for you — every source we check, kept fresh in the background."
      />

      {sources && sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No monitored sources yet. Add a competitor to start tracking.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {nextCheck && (
            <TooltipProvider delayDuration={150}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 font-medium text-muted-foreground">
                    Next check
                  </span>
                  <span aria-hidden className="text-muted-foreground">
                    ·
                  </span>
                  <span className="min-w-0 truncate">
                    <Link
                      href={`/dashboard/competitors/${nextCheck.competitorId}`}
                      className="font-medium hover:underline"
                      style={competitorNameColor(nextCheck.competitorColor)}
                    >
                      {nextCheck.competitorName}
                    </Link>
                    <span className="text-muted-foreground">
                      {" · "}
                      {sourceLabel(nextCheck.sourceType)}{" "}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default tabular-nums">
                            {rel(nextCheck.nextRunAt)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {absDateTime(nextCheck.nextRunAt)}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </span>
                </span>

                {upcoming.length > 1 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                      >
                        +{upcoming.length - 1} more
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-2">
                      <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
                        Next checks
                      </div>
                      <ul className="flex flex-col">
                        {upcoming.map((u) => (
                          <li
                            key={u.monitorId}
                            className="flex items-baseline justify-between gap-3 rounded px-1 py-1 text-sm"
                          >
                            <span className="min-w-0 truncate">
                              <Link
                                href={`/dashboard/competitors/${u.competitorId}`}
                                className="font-medium hover:underline"
                                style={competitorNameColor(u.competitorColor)}
                              >
                                {u.competitorName}
                              </Link>
                              <span className="text-muted-foreground">
                                {" · "}
                                {sourceLabel(u.sourceType)}
                              </span>
                            </span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="shrink-0 cursor-default text-xs text-muted-foreground tabular-nums">
                                  {rel(u.nextRunAt)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {absDateTime(u.nextRunAt)}
                              </TooltipContent>
                            </Tooltip>
                          </li>
                        ))}
                      </ul>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </TooltipProvider>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Select value={competitor} onValueChange={onFilter(setCompetitor)}>
              <SelectTrigger size="sm" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All competitors</SelectItem>
                {competitorOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={source} onValueChange={onFilter(setSource)}>
              <SelectTrigger size="sm" className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sourceOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {sourceLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={onFilter(setStatus)}>
              <SelectTrigger size="sm" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {OUTCOME_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="inline-flex items-center gap-1.5">
                      <Dot color={OUTCOME_META[s].color} />
                      {OUTCOME_META[s].label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {events === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isFiltered
                ? "No activity matches these filters."
                : "No activity yet."}
            </p>
          ) : (
            <>
              <div
                className={cn(
                  "overflow-hidden rounded-lg border border-border transition-opacity",
                  loading && "opacity-60",
                )}
                aria-busy={loading}
              >
                <TooltipProvider delayDuration={150}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="text-xs text-muted-foreground">Competitor</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Source</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                      <TableHead className="text-xs text-muted-foreground">What changed</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Captured</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">
                        Duration
                      </TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e, i) => {
                      const outcome = eventOutcome(e);
                      const meta = OUTCOME_META[outcome];
                      const key = `${e.competitorId}-${e.recordedAt}-${i}`;
                      const expandable = isExpandable(e);
                      const isOpen = expanded.has(key);
                      const relText = rel(e.recordedAt);
                      return (
                        <Fragment key={key}>
                          <TableRow
                            className={cn(
                              expandable && "cursor-pointer",
                              isOpen && "bg-muted/40 hover:bg-muted/40",
                            )}
                            onClick={expandable ? () => toggleRow(key) : undefined}
                            onKeyDown={
                              expandable
                                ? (ev) => {
                                    if (ev.key === "Enter" || ev.key === " ") {
                                      ev.preventDefault();
                                      toggleRow(key);
                                    }
                                  }
                                : undefined
                            }
                            role={expandable ? "button" : undefined}
                            tabIndex={expandable ? 0 : undefined}
                            aria-expanded={expandable ? isOpen : undefined}
                          >
                            <TableCell className="w-8 pr-0">
                              {expandable && (
                                <ChevronRight
                                  className={cn(
                                    "size-3.5 text-muted-foreground transition-transform",
                                    isOpen && "rotate-90",
                                  )}
                                  aria-hidden
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/dashboard/competitors/${e.competitorId}`}
                                className="font-medium hover:underline"
                                style={competitorNameColor(e.competitorColor)}
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                {e.competitorName}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {sourceLabel(e.sourceType)}
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5">
                                <Dot color={meta.color} />
                                <span className="text-muted-foreground">{meta.label}</span>
                              </span>
                            </TableCell>
                            <TableCell
                              className="max-w-[420px] truncate text-muted-foreground"
                              title={outcome === "change" ? (e.changeSummary ?? undefined) : undefined}
                            >
                              {outcome === "change"
                                ? (e.changeSummary ?? "—")
                                : outcome === "first_capture"
                                  ? "Baseline snapshot saved"
                                  : "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              <CapturedCell
                                captured={e.captured}
                                onView={() => setDetailEvent(e)}
                              />
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                              {duration(e.durationMs)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-default">{relText}</span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {absDateTime(e.recordedAt)}
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={8} className="bg-muted/40 py-3 pl-10 pr-4">
                                <RunDetail event={e} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
                </TooltipProvider>
              </div>
              <DataTablePagination
                page={page}
                pageCount={pageCount}
                onPageChange={setPage}
                total={total}
                pageSize={PAGE_SIZE}
                disabled={loading}
              />
            </>
          )}
        </div>
      )}

      <Dialog
        open={!!detailEvent}
        onOpenChange={(open) => !open && setDetailEvent(null)}
      >
        <DialogContent className="sm:max-w-md">
          {detailEvent && (
            <>
              <DialogHeader>
                <DialogTitle>
                  <span style={competitorNameColor(detailEvent.competitorColor)}>
                    {detailEvent.competitorName}
                  </span>{" "}
                  · {sourceLabel(detailEvent.sourceType)}
                </DialogTitle>
                <DialogDescription>
                  Captured {absDateTime(detailEvent.recordedAt)}
                </DialogDescription>
              </DialogHeader>
              {detailEvent.captured && (
                <CapturedDetail captured={detailEvent.captured} />
              )}
              <LivePageLink url={detailEvent.url} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
