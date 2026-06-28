"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  Columns3,
  Rows3,
  Check,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Download,
  Copy,
  ExternalLink,
} from "lucide-react";
import {
  api,
  type Competitor,
  type CompareColumn,
  type ProductSummary,
} from "@/lib/api";
import { productsListQuery, competitorsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const MAX = 6;

// Deferred-removal window: a removed column stays mounted this long so its exit
// animation can play before the row actually drops it from `selected`. The enter
// window matches its animation so a freshly-added column stops being "entering"
// right as the animation ends (kept in sync with the durations in colAnimClass).
const COLUMN_EXIT_MS = 200;
const COLUMN_ENTER_MS = 300;

// Reduced-motion users skip the deferred-removal delay (the exit animation is
// gated by motion-safe, so without the delay the column just vanishes instantly).
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// A rendered column. Derived from `selected` (not the fetched matrix) so add/
// remove is instant; `data` is the loaded column when available, else the column
// is `pending` (shimmer cells) until the refetch returns. `entering`/`exiting`
// drive the per-cell enter/exit animation on a list change.
interface DisplayCol {
  id: string;
  name: string;
  mine: boolean;
  data: CompareColumn | null;
  pending: boolean;
  entering: boolean;
  exiting: boolean;
}

// Per-column enter/exit animation classes, applied to every <th>/<td> of the
// column so the whole column animates together (a column isn't a single element,
// so AnimatePresence can't own it — plain CSS keyed on the column flags does).
// motion-safe so reduced-motion users get neither. Durations mirror
// COLUMN_ENTER_MS / COLUMN_EXIT_MS.
function colAnimClass(col: { entering: boolean; exiting: boolean }): string {
  if (col.exiting)
    return "motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-right-2 motion-safe:fill-mode-forwards motion-safe:duration-200";
  if (col.entering)
    return "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-300";
  return "";
}

const SEV_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

function money(value: number, currency: string | null): string {
  if (!currency) return String(Math.round(value));
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function pricingText(c: CompareColumn): string {
  if (!c.pricing) return "—";
  const { entry, top, currency, billingPeriod } = c.pricing;
  // entry/top are null only when every captured tier is quote-based.
  if (entry == null || top == null) return "Custom";
  const band = entry === top ? money(entry, currency) : `${money(entry, currency)}–${money(top, currency)}`;
  return billingPeriod ? `${band} / ${billingPeriod}` : band;
}

function hiringText(c: CompareColumn): string {
  if (!c.hiring) return "—";
  const dept = c.hiring.topDepartment ? ` · ${c.hiring.topDepartment}` : "";
  return `${c.hiring.totalOpen} open${dept}`;
}

function reviewsText(c: CompareColumn): string {
  if (c.reviews.length === 0) return "—";
  return c.reviews.map((r) => `${r.source} ${r.score.toFixed(1)}/5`).join("  ·  ");
}

function platformValues(c: CompareColumn): string[] {
  if (!c.platform) return [];
  return [c.platform.framework, c.platform.cms, c.platform.hosting, c.platform.ats].filter(
    (v): v is string => Boolean(v),
  );
}

// Average review score across a competitor's sources — used for the "best score"
// highlight (the one comparison where "winning" is unambiguous).
function avgReview(c: CompareColumn): number | null {
  if (c.reviews.length === 0) return null;
  return c.reviews.reduce((s, r) => s + r.score, 0) / c.reviews.length;
}

// A comparison row. `compact` is the at-a-glance cell; `detail` (when present)
// makes the row expandable to the richer per-plan / per-department / sub-score
// view. `csv` is the flat value for export. `best` returns the winning column
// ids to highlight (only defined where "best" is unambiguous).
interface Row {
  key: string;
  label: string;
  compact: (c: CompareColumn) => ReactNode;
  detail?: (c: CompareColumn) => ReactNode;
  csv: (c: CompareColumn) => string;
  best?: (cols: CompareColumn[]) => Set<string>;
}

const dash = <span className="text-muted-foreground">—</span>;

// Shared cell type styles. Data (prices, counts, scores) is mono per the
// machine-truth rule; labels inside a detail block are the small sans label.
const dataCell = "font-mono text-dense tabular-nums";
const detailKey = "text-muted-foreground text-xs";

// Opaque "you"-column tint (CSS vars only). Opaque — not an alpha fill — so the
// frozen column never shows the scrolling content bleeding through underneath it.
const YOU_STICKY_BG = "bg-[color-mix(in_oklch,var(--primary)_5%,var(--background))]";

const ROWS: Row[] = [
  {
    key: "positioning",
    label: "Positioning",
    compact: (c) => (
      <div className="space-y-1.5">
        {c.positioning.category && <Badge variant="outline">{c.positioning.category}</Badge>}
        {c.positioning.summary ? (
          <p className="text-muted-foreground line-clamp-3 text-sm leading-snug">
            {c.positioning.summary}
          </p>
        ) : (
          !c.positioning.category && dash
        )}
      </div>
    ),
    csv: (c) =>
      [c.positioning.category, c.positioning.summary].filter(Boolean).join(" — ") || "—",
  },
  {
    key: "pricing",
    label: "Pricing",
    compact: (c) => <span className={dataCell}>{pricingText(c)}</span>,
    detail: (c) =>
      c.pricing && c.pricing.plans.length > 0 ? (
        <div className="space-y-1.5">
          {c.pricing.plans.map((p, i) => (
            <div key={`${p.name}-${i}`} className="flex items-baseline justify-between gap-3">
              <span className={cn(detailKey, "truncate")}>{p.name || "—"}</span>
              <span className={dataCell}>
                {p.price == null ? (
                  "Custom"
                ) : (
                  <>
                    {money(p.price, c.pricing!.currency)}
                    {p.billingPeriod && (
                      <span className="text-muted-foreground">/{p.billingPeriod}</span>
                    )}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        dash
      ),
    csv: pricingText,
  },
  {
    key: "hiring",
    label: "Hiring",
    compact: (c) => <span className={dataCell}>{hiringText(c)}</span>,
    detail: (c) =>
      c.hiring && c.hiring.departments.length > 0 ? (
        <div className="space-y-1.5">
          {c.hiring.departments.map((d, i) => (
            <div key={`${d.department}-${i}`} className="flex items-baseline justify-between gap-3">
              <span className={cn(detailKey, "truncate")}>{d.department || "—"}</span>
              <span className={dataCell}>{d.count}</span>
            </div>
          ))}
        </div>
      ) : (
        dash
      ),
    csv: hiringText,
  },
  {
    key: "reviews",
    label: "Reviews",
    compact: (c) => <span className={dataCell}>{reviewsText(c)}</span>,
    detail: (c) =>
      c.reviews.length > 0 ? (
        <div className="space-y-2">
          {c.reviews.map((r) => (
            <div key={r.source} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs">{r.source}</span>
                <span className={dataCell}>
                  {r.score.toFixed(1)}/5
                  <span className="text-muted-foreground"> · {r.reviewCount}</span>
                </span>
              </div>
              {r.sub && (
                <div className="text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-meta tabular-nums">
                  <span>ease {r.sub.ease.toFixed(1)}</span>
                  <span>support {r.sub.support.toFixed(1)}</span>
                  <span>features {r.sub.features.toFixed(1)}</span>
                  <span>value {r.sub.value.toFixed(1)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        dash
      ),
    csv: reviewsText,
    best: (cols) => {
      const scored = cols
        .map((c) => ({ id: c.id, avg: avgReview(c) }))
        .filter((x): x is { id: string; avg: number } => x.avg !== null);
      if (scored.length < 2) return new Set();
      const max = Math.max(...scored.map((x) => x.avg));
      return new Set(scored.filter((x) => x.avg === max).map((x) => x.id));
    },
  },
  {
    key: "tech",
    label: "Notable tech",
    compact: (c) =>
      c.tech.length === 0 ? (
        dash
      ) : (
        <div className="flex flex-wrap gap-1">
          {c.tech.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      ),
    csv: (c) => (c.tech.length ? c.tech.join(", ") : "—"),
  },
  {
    key: "platform",
    label: "Stack",
    compact: (c) => {
      const vals = platformValues(c);
      return vals.length === 0 ? (
        dash
      ) : (
        <div className="flex flex-wrap gap-1">
          {vals.map((v) => (
            <Badge key={v} variant="secondary">
              {v}
            </Badge>
          ))}
        </div>
      );
    },
    detail: (c) =>
      c.platform ? (
        <div className="space-y-1.5">
          {(
            [
              ["Framework", c.platform.framework],
              ["CMS", c.platform.cms],
              ["Hosting", c.platform.hosting],
              ["ATS", c.platform.ats],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <span className={detailKey}>{k}</span>
              <span className="font-mono text-dense">{v ?? "—"}</span>
            </div>
          ))}
        </div>
      ) : (
        dash
      ),
    csv: (c) => {
      const vals = platformValues(c);
      return vals.length ? vals.join(", ") : "—";
    },
  },
  {
    key: "website",
    label: "Website",
    compact: (c) =>
      c.url ? (
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-dense text-[var(--link)] hover:underline"
        >
          <span className="max-w-[12rem] truncate">{prettyHost(c.url)}</span>
          <ExternalLink size={12} className="shrink-0" aria-hidden />
        </a>
      ) : (
        dash
      ),
    csv: (c) => c.url ?? "—",
  },
  {
    key: "latestSignal",
    label: "Latest signal",
    compact: (c) =>
      c.latestSignal ? (
        <span className="flex items-center gap-2">
          <Badge variant={SEV_VARIANT[c.latestSignal.severity] ?? "outline"}>
            {c.latestSignal.severity}
          </Badge>
          <span className="text-muted-foreground font-mono text-meta">
            {shortDate(c.latestSignal.createdAt)}
          </span>
        </span>
      ) : (
        dash
      ),
    csv: (c) =>
      c.latestSignal
        ? `${c.latestSignal.severity} (${shortDate(c.latestSignal.createdAt)})`
        : "—",
  },
];

const ALL_ROW_KEYS = ROWS.map((r) => r.key);

// Row grouping for the table body — a caption row is drawn when the group changes.
// Positioning leads with no caption ("" group); the rest chunk into scannable bands.
const ROW_GROUP: Record<string, string> = {
  positioning: "",
  pricing: "Metrics",
  hiring: "Metrics",
  reviews: "Metrics",
  tech: "Stack",
  platform: "Stack",
  website: "Details",
  latestSignal: "Details",
};

// ── Export ────────────────────────────────────────────────────────────────
type ExportFormat = "csv" | "markdown" | "tsv";

function buildMatrix(rows: Row[], cols: CompareColumn[]): { header: string[]; body: string[][] } {
  return {
    header: ["", ...cols.map((c) => c.name)],
    body: rows.map((r) => [r.label, ...cols.map((c) => r.csv(c))]),
  };
}

function toDelimited(rows: Row[], cols: CompareColumn[], sep: string): string {
  const { header, body } = buildMatrix(rows, cols);
  const esc = (v: string) =>
    sep === "," && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [header, ...body].map((line) => line.map(esc).join(sep)).join("\n");
}

function toMarkdown(rows: Row[], cols: CompareColumn[]): string {
  const { header, body } = buildMatrix(rows, cols);
  const esc = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const fmt = (line: string[]) => `| ${line.map(esc).join(" | ")} |`;
  const divider = `| ${header.map(() => "---").join(" | ")} |`;
  return [fmt(header), divider, ...body.map(fmt)].join("\n");
}

// ── Picker entity ───────────────────────────────────────────────────────────
// A selectable entity in the picker: a real competitor or one of the org's own
// products. Products resolve to their self-competitor id — the compare endpoint
// scopes to org-owned competitors regardless of type, so "you" columns just work.
type PickKind = "you" | "competitor";
interface PickEntity {
  id: string;
  name: string;
  kind: PickKind;
}

function PickItem({
  entity,
  on,
  full,
  onToggle,
}: {
  entity: PickEntity;
  on: boolean;
  full: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <CommandItem
      value={entity.name}
      disabled={!on && full}
      onSelect={() => {
        if (on || !full) onToggle(entity.id);
      }}
      className="gap-2"
    >
      <Check size={14} className={cn(on ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{entity.name}</span>
    </CommandItem>
  );
}

// "You" marker — cyan fill, ink text, sentence case. Same component in the chips
// and the table header so it always reads aligned and identical. Cyan is the
// brand's selection/current accent, spent here on the one or two "your product"
// columns the page frames everything against.
function YouTag() {
  return (
    <span className="bg-primary text-primary-foreground inline-flex shrink-0 items-center rounded-[4px] px-1.5 py-0.5 text-meta font-semibold leading-none">
      You
    </span>
  );
}

// ── Summary band ─────────────────────────────────────────────────────────────
// One-glance "where you stand" verdicts above the matrix. Only the comparisons
// that are unambiguous get a tone: cheapest entry price and best average rating
// win/lose; hiring volume is shown as neutral context (more openings ≠ "better").
type Tone = "good" | "bad" | "neutral";
interface Takeaway {
  key: string;
  text: string;
  tone: Tone;
}

function buildTakeaways(you: CompareColumn, comps: CompareColumn[]): Takeaway[] {
  const out: Takeaway[] = [];

  const youEntry = you.pricing?.entry ?? null;
  const entries = comps.map((c) => c.pricing?.entry).filter((v): v is number => v != null);
  if (youEntry != null && entries.length) {
    const cheaper = entries.filter((e) => youEntry < e).length;
    if (youEntry <= Math.min(...entries))
      out.push({ key: "pricing", text: "Lowest entry price", tone: "good" });
    else if (youEntry >= Math.max(...entries))
      out.push({ key: "pricing", text: "Highest entry price", tone: "bad" });
    else
      out.push({
        key: "pricing",
        text: `Cheaper than ${cheaper} of ${entries.length}`,
        tone: "neutral",
      });
  }

  const youAvg = avgReview(you);
  const avgs = comps.map(avgReview).filter((v): v is number => v != null);
  if (youAvg != null && avgs.length) {
    if (youAvg >= Math.max(...avgs))
      out.push({ key: "reviews", text: `Best rated · ${youAvg.toFixed(1)}/5`, tone: "good" });
    else if (youAvg <= Math.min(...avgs))
      out.push({ key: "reviews", text: `Lowest rated · ${youAvg.toFixed(1)}/5`, tone: "bad" });
    else
      out.push({ key: "reviews", text: `Rated ${youAvg.toFixed(1)}/5 · mid-pack`, tone: "neutral" });
  }

  const youOpen = you.hiring?.totalOpen ?? null;
  const opens = comps.map((c) => c.hiring?.totalOpen).filter((v): v is number => v != null);
  if (youOpen != null && opens.length) {
    out.push({
      key: "hiring",
      text: youOpen > Math.max(...opens) ? "Most active hiring" : `${youOpen} open roles`,
      tone: "neutral",
    });
  }

  return out;
}

const TONE_DOT: Record<Tone, string> = {
  good: "bg-positive",
  bad: "bg-destructive",
  neutral: "bg-muted-foreground",
};
const TONE_TEXT: Record<Tone, string> = {
  good: "text-positive",
  bad: "text-destructive",
  neutral: "",
};

function SummaryBand({ you, comps }: { you: CompareColumn; comps: CompareColumn[] }) {
  const items = buildTakeaways(you, comps);
  if (items.length === 0) return null;
  return (
    <div className="border-border bg-card flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border px-3 py-2.5">
      <span className="text-muted-foreground text-dense">
        How <span className="text-foreground font-medium">{you.name}</span> stacks up
      </span>
      {items.map((t) => (
        <span
          key={t.key}
          className="bg-background border-border inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-dense"
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[t.tone])} aria-hidden />
          <span className={TONE_TEXT[t.tone]}>{t.text}</span>
        </span>
      ))}
    </div>
  );
}

const ROWS_STORAGE = "compare:rows";
const EXPORT_STORAGE = "compare:export";

// Derive the entity pick-list + the default "you vs them" selection from the
// raw products/competitors. Shared by the server-seeded initial state and the
// client fetch so both produce the exact same list.
function buildPickList(
  products: ProductSummary[],
  competitors: Competitor[],
): { entities: PickEntity[]; selected: string[] } {
  const you: PickEntity[] = products
    .filter((pr) => pr.status !== "archived")
    .map((pr): PickEntity => ({ id: pr.selfCompetitorId, name: pr.name, kind: "you" }));
  const comps: PickEntity[] = competitors.map(
    (co): PickEntity => ({ id: co.id, name: co.name, kind: "competitor" }),
  );
  const seed = you.length
    ? [...you.slice(0, 1), ...comps.slice(0, 2)]
    : comps.slice(0, 3);
  return { entities: [...you, ...comps], selected: seed.map((e) => e.id) };
}

export function CompareView() {
  // Server-seeded on first paint (compare/page.tsx): the picker inputs (products +
  // competitors). useState lazy-inits from the hydrated cache; a sync effect fills
  // them in when the seed was missing and the queries resolve client-side.
  // patch-28 — active product scope (?product=): the picker offers only that
  // product's competitors; absent → all org competitors (unchanged).
  const productId = useSearchParams().get("product") ?? undefined;
  const productsQ = useQuery(productsListQuery());
  const competitorsQ = useQuery(competitorsQuery(productId));
  const [entities, setEntities] = useState<PickEntity[] | null>(() =>
    productsQ.data && competitorsQ.data
      ? buildPickList(productsQ.data, competitorsQ.data).entities
      : null,
  );
  const [selected, setSelected] = useState<string[]>(() =>
    productsQ.data && competitorsQ.data
      ? buildPickList(productsQ.data, competitorsQ.data).selected
      : [],
  );
  // True once the picker has been built, so a later refetch can't clobber the
  // user's live selection. Seeded → already built on the first render.
  const initializedRef = useRef(productsQ.data != null && competitorsQ.data != null);
  const [matrix, setMatrix] = useState<CompareColumn[] | null>(null);
  // A refetch keeps the prior matrix on screen (no full-table blank); this just
  // drives per-column shimmer for ids not yet present in `matrix`. Seeded true
  // when a selection exists at mount so the first paint shows the shimmer table,
  // not a "Nothing to compare" flash before the fetch effect runs.
  const [isFetching, setIsFetching] = useState(() => selected.length > 0);
  // Columns mid-removal: still in `selected` (so they stay mounted) but rendered
  // with the exit animation; dropped from `selected` once it finishes.
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  // Columns just added by the user: rendered with the enter animation until it
  // finishes. Only ever populated by addColumn — the seeded/initial set never is,
  // so the first paint has no enter animation (animation = list change only).
  const [enteringIds, setEnteringIds] = useState<Set<string>>(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  // View state.
  const [visibleRows, setVisibleRows] = useState<string[]>(ALL_ROW_KEYS);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // "Differences only" (NN/g comparison-table pattern): hide rows where every
  // column matches, so the rows that actually distinguish competitors stand out.
  const [diffOnly, setDiffOnly] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [exportVisibleOnly, setExportVisibleOnly] = useState(true);
  const [exportIncludeYou, setExportIncludeYou] = useState(true);
  const [exportDone, setExportDone] = useState(false);

  // Hydrate persisted view prefs (post-mount → no SSR mismatch).
  useEffect(() => {
    try {
      const rows = JSON.parse(localStorage.getItem(ROWS_STORAGE) ?? "null");
      if (Array.isArray(rows)) {
        const kept = ALL_ROW_KEYS.filter((k) => rows.includes(k));
        if (kept.length) setVisibleRows(kept);
      }
      const ex = JSON.parse(localStorage.getItem(EXPORT_STORAGE) ?? "null");
      if (ex && typeof ex === "object") {
        if (["csv", "markdown", "tsv"].includes(ex.format)) setExportFormat(ex.format);
        if (typeof ex.visibleOnly === "boolean") setExportVisibleOnly(ex.visibleOnly);
        if (typeof ex.includeYou === "boolean") setExportIncludeYou(ex.includeYou);
      }
    } catch {
      /* corrupt prefs — ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ROWS_STORAGE, JSON.stringify(visibleRows));
    } catch {
      /* storage blocked — ignore */
    }
  }, [visibleRows]);

  useEffect(() => {
    try {
      localStorage.setItem(
        EXPORT_STORAGE,
        JSON.stringify({
          format: exportFormat,
          visibleOnly: exportVisibleOnly,
          includeYou: exportIncludeYou,
        }),
      );
    } catch {
      /* storage blocked — ignore */
    }
  }, [exportFormat, exportVisibleOnly, exportIncludeYou]);

  // Build the picker once the inputs are available (covers the non-seeded path);
  // guarded so a later refetch can't clobber the user's live selection.
  useEffect(() => {
    if (initializedRef.current || !productsQ.data || !competitorsQ.data) return;
    initializedRef.current = true;
    const { entities, selected } = buildPickList(productsQ.data, competitorsQ.data);
    setEntities(entities);
    setSelected(selected);
  }, [productsQ.data, competitorsQ.data]);

  useEffect(() => {
    if (selected.length === 0) {
      setMatrix([]);
      setIsFetching(false);
      return;
    }
    let cancelled = false;
    // Keep the prior matrix rendered while refetching — columns already loaded
    // stay put; only newly-added ids shimmer (driven by isFetching) until they
    // arrive. This is what replaces the old full-table skeleton on every change.
    setIsFetching(true);
    api
      .compareCompetitors(selected)
      .then((r) => {
        if (cancelled) return;
        setMatrix(r.competitors);
        setIsFetching(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMatrix([]);
        setIsFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function addColumn(id: string) {
    if (selected.includes(id) || selected.length >= MAX) return;
    setSelected((prev) =>
      prev.includes(id) || prev.length >= MAX ? prev : [...prev, id],
    );
    if (prefersReducedMotion()) return;
    setEnteringIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setEnteringIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, COLUMN_ENTER_MS);
  }

  // Deferred so the exit animation can play before the column unmounts.
  function removeColumn(id: string) {
    if (prefersReducedMotion()) {
      setSelected((prev) => prev.filter((x) => x !== id));
      return;
    }
    setExitingIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setSelected((prev) => prev.filter((x) => x !== id));
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, COLUMN_EXIT_MS);
  }

  function toggle(id: string) {
    if (selected.includes(id)) removeColumn(id);
    else addColumn(id);
  }

  function toggleRow(key: string) {
    setVisibleRows((prev) =>
      prev.includes(key)
        ? prev.length > 1
          ? prev.filter((k) => k !== key) // keep at least one row visible
          : prev
        : ALL_ROW_KEYS.filter((k) => prev.includes(k) || k === key),
    );
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const cols = useMemo(() => matrix ?? [], [matrix]);
  const youIds = useMemo(
    () => new Set((entities ?? []).filter((e) => e.kind === "you").map((e) => e.id)),
    [entities],
  );
  // Pin "your" products to the left — the "you vs them" read.
  const orderedCols = useMemo(() => {
    const mine = cols.filter((c) => youIds.has(c.id));
    const theirs = cols.filter((c) => !youIds.has(c.id));
    return [...mine, ...theirs];
  }, [cols, youIds]);
  // Reference "you" column (the leftmost, pinned + frozen) and everyone it's
  // measured against — drives the summary band.
  const youCol = useMemo(
    () => orderedCols.find((c) => youIds.has(c.id)) ?? null,
    [orderedCols, youIds],
  );
  const compCols = useMemo(
    () => orderedCols.filter((c) => !youIds.has(c.id)),
    [orderedCols, youIds],
  );
  const youGroup = useMemo(
    () => (entities ?? []).filter((e) => e.kind === "you"),
    [entities],
  );
  const compGroup = useMemo(
    () => (entities ?? []).filter((e) => e.kind === "competitor"),
    [entities],
  );

  // The columns actually rendered (incl. pending/exiting), derived from `selected`
  // so add/remove reflects instantly. `orderedCols` above stays the loaded-data
  // source for the summary band / winners / diff / export.
  const matrixById = useMemo(
    () => new Map((matrix ?? []).map((c) => [c.id, c])),
    [matrix],
  );
  const nameById = useMemo(
    () => new Map((entities ?? []).map((e) => [e.id, e.name])),
    [entities],
  );
  const displayCols = useMemo<DisplayCol[]>(() => {
    // Same you-first ordering as orderedCols, but over `selected` (instant).
    const order = [
      ...selected.filter((id) => youIds.has(id)),
      ...selected.filter((id) => !youIds.has(id)),
    ];
    return order.map((id) => {
      const data = matrixById.get(id) ?? null;
      return {
        id,
        name: data?.name ?? nameById.get(id) ?? "—",
        mine: youIds.has(id),
        data,
        pending: !data && isFetching,
        entering: enteringIds.has(id),
        exiting: exitingIds.has(id),
      };
    });
  }, [selected, youIds, matrixById, nameById, isFetching, enteringIds, exitingIds]);

  const visibleRowSet = useMemo(() => new Set(visibleRows), [visibleRows]);
  const rows = useMemo(() => ROWS.filter((r) => visibleRowSet.has(r.key)), [visibleRowSet]);
  // Rows actually rendered: when "Differences only" is on, drop rows whose
  // canonical value (csv) is identical across every column.
  const displayRows = useMemo(() => {
    if (!diffOnly) return rows;
    return rows.filter(
      (r) => new Set(orderedCols.map((c) => r.csv(c))).size > 1,
    );
  }, [rows, diffOnly, orderedCols]);
  // Winning column ids per row (only rows that define `best`).
  const winnersByRow = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) if (r.best) m.set(r.key, r.best(orderedCols));
    return m;
  }, [rows, orderedCols]);

  // Only the leftmost "you" column is frozen (the primary reference); any extra
  // "you" columns scroll like the rest. Based on the rendered columns so the
  // freeze tracks the live (optimistic) leftmost column.
  const firstCol = displayCols[0];
  const stickyYouId = firstCol && firstCol.mine ? firstCol.id : null;

  const full = selected.length >= MAX;
  const hasCompetitors = (entities ?? []).some((e) => e.kind === "competitor");
  const canExport = Boolean(matrix && matrix.length > 0);

  async function runExport() {
    if (!matrix || matrix.length === 0) return;
    const exRows = exportVisibleOnly ? rows : ROWS;
    const exCols = exportIncludeYou ? orderedCols : orderedCols.filter((c) => !youIds.has(c.id));
    if (exRows.length === 0 || exCols.length === 0) return;

    try {
      if (exportFormat === "csv") {
        const blob = new Blob([toDelimited(exRows, exCols, ",")], {
          type: "text/csv;charset=utf-8",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `compare-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (exportFormat === "markdown") {
        await navigator.clipboard.writeText(toMarkdown(exRows, exCols));
      } else {
        await navigator.clipboard.writeText(toDelimited(exRows, exCols, "\t"));
      }
      setExportDone(true);
      setTimeout(() => setExportDone(false), 1500);
    } catch {
      /* clipboard/download blocked — no-op */
    }
  }

  const exportIsCopy = exportFormat !== "csv";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-title md:text-title-lg font-semibold">
            <Columns3 size={18} className="text-muted-foreground" aria-hidden />
            Compare
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Put your product and competitors side by side on positioning, pricing,
            hiring, reviews and tech.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Row visibility */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Rows3 size={14} />
                Rows
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-2">
              <p className="text-muted-foreground px-1 pb-1.5 text-xs">Show rows</p>
              <div className="space-y-0.5">
                {ROWS.map((r) => {
                  const on = visibleRowSet.has(r.key);
                  return (
                    <label
                      key={r.key}
                      className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm"
                    >
                      <Checkbox
                        checked={on}
                        disabled={on && visibleRows.length === 1}
                        onCheckedChange={() => toggleRow(r.key)}
                      />
                      {r.label}
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {/* Export split button: [ Export ][▼] */}
          <div className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              className="rounded-r-none border-r-0"
              onClick={runExport}
              disabled={!canExport}
            >
              {exportDone ? (
                <Check size={12} />
              ) : exportIsCopy ? (
                <Copy size={12} />
              ) : (
                <Download size={12} />
              )}
              {exportDone ? (exportIsCopy ? "Copied" : "Saved") : "Export"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-l-none px-2"
                  disabled={!canExport}
                  aria-label="Export options"
                >
                  <ChevronDown size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Format</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={exportFormat}
                  onValueChange={(v) => setExportFormat(v as ExportFormat)}
                >
                  <DropdownMenuRadioItem value="csv">CSV file</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="markdown">Markdown (copy)</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="tsv">Table (copy)</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={exportVisibleOnly}
                  onCheckedChange={(v) => setExportVisibleOnly(Boolean(v))}
                >
                  Visible rows only
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={exportIncludeYou}
                  onCheckedChange={(v) => setExportIncludeYou(Boolean(v))}
                >
                  Include your product
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {entities === null ? (
        <Skeleton className="h-9 w-full" />
      ) : !hasCompetitors ? (
        <p className="text-muted-foreground text-sm">
          Add competitors first, then compare them against your product.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* The selected set lives in the table header (name + remove-X) — this
              toolbar is just add + count, so names aren't listed twice. */}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              {/* Stays enabled at MAX so the picker can still be opened to
                  deselect — only adding a new item is blocked (per-item below). */}
              <Button variant="outline" size="sm">
                <Plus size={14} />
                Add to compare
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <Command>
                <CommandInput placeholder="Search to compare…" />
                <CommandList>
                  <CommandEmpty>No matches.</CommandEmpty>
                  {youGroup.length > 0 && (
                    <CommandGroup heading="Your products">
                      {youGroup.map((e) => (
                        <PickItem
                          key={e.id}
                          entity={e}
                          on={selected.includes(e.id)}
                          full={full}
                          onToggle={toggle}
                        />
                      ))}
                    </CommandGroup>
                  )}
                  <CommandGroup heading="Competitors">
                    {compGroup.map((e) => (
                      <PickItem
                        key={e.id}
                        entity={e}
                        on={selected.includes(e.id)}
                        full={full}
                        onToggle={toggle}
                      />
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <span className="text-muted-foreground ml-1 font-mono text-meta tabular-nums">
            {selected.length}/{MAX}
          </span>

          {selected.length > 1 && (
            <Button
              variant={diffOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setDiffOnly((v) => !v)}
              className="ml-auto"
              aria-pressed={diffOnly}
            >
              <Rows3 size={14} />
              Differences only
            </Button>
          )}
        </div>
      )}

      {entities !== null && hasCompetitors && (
        <>
          {selected.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Pick competitors above to compare.
            </p>
          ) : !isFetching && (matrix?.length ?? 0) === 0 ? (
            // Fetch settled with nothing (e.g. all ids dropped server-side); while
            // it's still loading we render the table with pending shimmer columns.
            <p className="text-muted-foreground text-sm">Nothing to compare.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {youCol && compCols.length > 0 && <SummaryBand you={youCol} comps={compCols} />}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="bg-background sticky left-0 z-20 w-36 border-b border-r border-border px-3 py-2.5 text-left" />
                      {displayCols.map((d) => {
                        const stuck = d.id === stickyYouId;
                        return (
                          <th
                            key={d.id}
                            className={cn(
                              "group/col min-w-[10rem] border-b border-border px-3 py-2.5 text-left font-semibold tracking-tight",
                              d.mine && !stuck && "bg-primary/5",
                              stuck && cn(YOU_STICKY_BG, "sticky left-36 z-10 border-r border-border"),
                              colAnimClass(d),
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <span className="truncate">{d.name}</span>
                              {d.mine && <YouTag />}
                              <button
                                type="button"
                                onClick={() => toggle(d.id)}
                                aria-label={`Remove ${d.name}`}
                                className="text-muted-foreground hover:text-foreground ml-auto shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity group-hover/col:opacity-100 focus-visible:opacity-100"
                              >
                                <X size={13} />
                              </button>
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let prevGroup = "";
                      const out: ReactNode[] = [];
                      // Columns to span on caption rows after the (frozen) label and
                      // "you" cells — keeps the frozen you column continuous.
                      const restCols = displayCols.length - (stickyYouId ? 1 : 0);
                      if (diffOnly && displayRows.length === 0) {
                        out.push(
                          <tr key="no-diff">
                            <td
                              colSpan={displayCols.length + 1}
                              className="bg-background px-3 py-6 text-center text-sm text-muted-foreground"
                            >
                              No differences across the tracked fields — these
                              competitors match on everything compared.
                            </td>
                          </tr>,
                        );
                      }
                      for (const r of displayRows) {
                        const group = ROW_GROUP[r.key] ?? "";
                        if (group && group !== prevGroup) {
                          out.push(
                            // Section band: a continuous raised strip across every
                            // column — no per-cell vertical dividers (border-r) and a
                            // uniform bg-background-2 fill, so it reads as a header band
                            // breaking the column grid, not as a data row with empty cells.
                            <tr key={`grp-${group}`}>
                              <td className="bg-background-2 sticky left-0 z-20 w-36 whitespace-nowrap border-b border-border px-3 pb-1.5 pt-4">
                                <span className="text-muted-foreground text-meta font-semibold">
                                  {group}
                                </span>
                              </td>
                              {stickyYouId && (
                                <td className="bg-background-2 sticky left-36 z-10 border-b border-border" />
                              )}
                              {restCols > 0 && (
                                <td
                                  colSpan={restCols}
                                  className="bg-background-2 border-b border-border"
                                />
                              )}
                            </tr>,
                          );
                        }
                        prevGroup = group;
                        const isOpen = expanded.has(r.key);
                        const winners = winnersByRow.get(r.key);
                        out.push(
                          <tr key={r.key} className="last:[&>td]:border-b-0">
                            <td className="bg-background sticky left-0 z-20 w-36 whitespace-nowrap border-b border-r border-border px-3 py-2.5 align-top">
                              {r.detail ? (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(r.key)}
                                  aria-expanded={isOpen}
                                  className="text-muted-foreground hover:text-foreground -ml-1 flex w-full items-center gap-1 rounded-sm text-left text-dense font-medium transition-colors"
                                >
                                  <ChevronRight
                                    size={13}
                                    className={cn(
                                      "shrink-0 transition-transform",
                                      isOpen && "rotate-90",
                                    )}
                                    aria-hidden
                                  />
                                  {r.label}
                                </button>
                              ) : (
                                <span className="text-muted-foreground pl-5 text-dense font-medium">
                                  {r.label}
                                </span>
                              )}
                            </td>
                            {displayCols.map((d) => {
                              const won = d.data ? winners?.has(d.id) : false;
                              const stuck = d.id === stickyYouId;
                              return (
                                <td
                                  key={d.id}
                                  className={cn(
                                    "border-b border-border px-3 py-2.5 align-top",
                                    d.mine && !stuck && "bg-primary/[0.03]",
                                    stuck &&
                                      cn(YOU_STICKY_BG, "sticky left-36 z-10 border-r border-border"),
                                    colAnimClass(d),
                                  )}
                                >
                                  {d.pending ? (
                                    <Skeleton className="h-4 w-2/3" />
                                  ) : !d.data ? (
                                    dash
                                  ) : isOpen && r.detail ? (
                                    <div className="space-y-1.5">
                                      {won && (
                                        <span className="text-positive text-meta font-medium">
                                          Best
                                        </span>
                                      )}
                                      {r.detail(d.data)}
                                    </div>
                                  ) : (
                                    <div className={cn(won && "text-positive font-medium")}>
                                      {r.compact(d.data)}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>,
                        );
                      }
                      return out;
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
