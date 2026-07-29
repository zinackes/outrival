"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CaretDownIcon, CopyIcon, DownloadSimpleIcon } from "@/components/icons";
import { api, type Competitor, type CompareColumn, type ProductSummary } from "@/lib/api";
import { productsListQuery, competitorsQuery, compareRankingQuery } from "@/lib/queries";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { assignSeriesColors } from "@/lib/competitor-color";
import { PageHead } from "@/components/dashboard/page-head";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompareSetRail, type PickEntity } from "@/components/dashboard/compare/set-rail";
import { CompareVerdict } from "@/components/dashboard/compare/verdict";
import type { CompareEntity } from "@/components/dashboard/compare/lens";
import {
  HiringLens,
  MEASURE_LENSES,
  MovesLens,
  PositioningLens,
  PriceLens,
  RatingLens,
  StackLens,
  lensHasContent,
  type MeasureLensId,
} from "@/components/dashboard/compare/lenses";
import { agePhrase } from "@/components/dashboard/compare/derive";
import {
  EXPORT_BUTTON_LABEL,
  toDelimited,
  toMarkdown,
  type ExportFormat,
} from "@/components/dashboard/compare/export";

/**
 * Compare: one roster, read through five lenses, opening on the verdict.
 *
 * This view used to render a matrix — a competitor per column, a dimension per row,
 * two frozen columns and a sideways scroll no phone could hold. What it could not do
 * was compare: five price strings in five cells left the arithmetic to the reader.
 * Now every quantitative dimension is a lane on ONE shared scale, every lens lists
 * the same competitors in the same order, and the page states where you stand before
 * it shows the evidence. The grid still exists, as the export.
 */

/**
 * How many COMPETITORS can be compared at once. Your own products share the roster but
 * do not consume a slot: the page reads "you vs them", so spending one of the six on
 * yourself left a pro account (15 competitors) able to line up only five of them.
 */
const MAX_COMPETITORS = 6;
/**
 * Hard ceiling on the whole set, matching the API's own column cap (routes/compare.ts
 * MAX_COLUMNS). Past it the request is truncated silently, so the picker stops first.
 * Only reachable with several SKUs selected at once.
 */
const MAX_COLUMNS = 12;

/** id → kind. An id we don't know counts as a competitor, i.e. against the tighter cap. */
function kindsOf(entities: PickEntity[]): Map<string, PickEntity["kind"]> {
  return new Map(entities.map((e) => [e.id, e.kind]));
}

/**
 * Trim a selection to both caps, keeping the incoming order. Anything that would breach
 * a cap is dropped, so appending a candidate last is also how an add is refused.
 */
function capSelection(ids: string[], kinds: Map<string, PickEntity["kind"]>): string[] {
  const kept: string[] = [];
  let comps = 0;
  for (const id of ids) {
    if (kept.length >= MAX_COLUMNS) break;
    if (kinds.get(id) !== "you") {
      if (comps >= MAX_COMPETITORS) continue;
      comps += 1;
    }
    kept.push(id);
  }
  return kept;
}

const EXPORT_STORAGE = "compare:export";
// Persisted column selection. Keyed by the active product scope: with several SKUs the
// selection is a "this product vs these competitors" set, so one shared key would hand
// a scope the previous product's own column and out-of-scope competitors.
const SELECTION_STORAGE = "compare:selected";

function selectionKey(productId: string | undefined): string {
  return `${SELECTION_STORAGE}:${productId ?? "all"}`;
}

/**
 * The selection the user left behind, filtered to entities that still exist (a
 * competitor can be deleted, or belong to another product scope) and capped.
 * Null when nothing survives — the caller then seeds the ranked defaults, so a stale
 * selection can never leave the page with nothing to compare.
 */
function readStoredSelection(key: string, entities: PickEntity[]): string[] | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!Array.isArray(raw)) return null;
    const kinds = kindsOf(entities);
    const kept = capSelection(
      [...new Set(raw.filter((id): id is string => typeof id === "string" && kinds.has(id)))],
      kinds,
    );
    return kept.length ? kept : null;
  } catch {
    /* corrupt prefs — fall back to the defaults */
    return null;
  }
}

/**
 * The picker list + the default "you vs them" selection, derived from the raw
 * products/competitors. Shared by the server-seeded initial state and the client
 * fetch so both produce the same list.
 *
 * `dataScore` (competitor id → 0-6 completeness, from /api/compare/ranking) orders the
 * competitors so the ones actually worth comparing win the default rows and sit at the
 * top of the picker: most data first, best overlap on ties.
 */
function buildPickList(
  products: ProductSummary[],
  competitors: Competitor[],
  dataScore: Record<string, number>,
  scopedProductId?: string,
): { entities: PickEntity[]; selected: string[] } {
  const activeProducts = products.filter((pr) => pr.status !== "archived");
  const you: PickEntity[] = activeProducts.map(
    (pr): PickEntity => ({
      id: pr.selfCompetitorId,
      name: pr.name,
      kind: "you",
      color: null,
      // Same favicon source as the portfolio tiles: the site, else the watched repo.
      url: pr.url ?? pr.repoUrl ?? null,
    }),
  );
  // The self-competitor pinned first by default: the scoped product's, else the
  // primary (the API returns products primary-first).
  const scopedSelf = scopedProductId
    ? activeProducts.find((pr) => pr.id === scopedProductId)?.selfCompetitorId
    : undefined;
  // Stable sort: ties keep the incoming createdAt-desc order.
  const ranked = [...competitors].sort((a, b) => {
    const sa = dataScore[a.id] ?? 0;
    const sb = dataScore[b.id] ?? 0;
    if (sa !== sb) return sb - sa;
    return (b.overlapScore ?? -1) - (a.overlapScore ?? -1);
  });
  const comps: PickEntity[] = ranked.map(
    (co): PickEntity => ({
      id: co.id,
      name: co.name,
      kind: "competitor",
      color: co.color,
      url: co.url,
    }),
  );
  const pinned = you.find((e) => e.id === scopedSelf) ?? you[0];
  const seed = pinned
    ? [pinned, ...comps.slice(0, MAX_COMPETITORS)]
    : comps.slice(0, MAX_COMPETITORS);
  return { entities: [...you, ...comps], selected: seed.map((e) => e.id) };
}

/** The freshest capture time across every dimension of the compared set. */
function capturedUpTo(cols: CompareColumn[]): string | null {
  const stamps = cols.flatMap((c) => [
    c.pricing?.capturedAt ?? null,
    c.hiring?.capturedAt ?? null,
    ...c.reviews.map((r) => r.recordedAt),
  ]);
  const times = stamps
    .filter((s): s is string => Boolean(s))
    .map((s) => new Date(s).getTime())
    .filter((t) => Number.isFinite(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

export function CompareView() {
  // Server-seeded on first paint (compare/page.tsx): the picker inputs (products +
  // competitors + the ranking). patch-28 — the active product scope narrows the
  // competitor list; absent → every competitor in the org.
  const productId = useProductScope() ?? undefined;
  const productsQ = useQuery(productsListQuery());
  const competitorsQ = useQuery(competitorsQuery(productId));
  const rankingQ = useQuery(compareRankingQuery());

  const [entities, setEntities] = useState<PickEntity[] | null>(() =>
    productsQ.data && competitorsQ.data
      ? buildPickList(productsQ.data, competitorsQ.data, rankingQ.data ?? {}, productId).entities
      : null,
  );
  const [selected, setSelected] = useState<string[]>(() =>
    productsQ.data && competitorsQ.data
      ? buildPickList(productsQ.data, competitorsQ.data, rankingQ.data ?? {}, productId).selected
      : [],
  );
  // True once the picker has been built, so a later refetch can't clobber a live
  // selection. Seeded → already built on the first render.
  const initializedRef = useRef(
    productsQ.data != null && competitorsQ.data != null && !rankingQ.isLoading,
  );
  // True once the persisted selection has been read (applied or found absent). The
  // matrix fetch waits on it so the page never spends a request on the default rows
  // just to replace them a frame later.
  const [selectionRestored, setSelectionRestored] = useState(false);
  const restoredRef = useRef(false);
  const [matrix, setMatrix] = useState<CompareColumn[] | null>(null);
  const [matrixError, setMatrixError] = useState(false);
  const [matrixReloadKey, setMatrixReloadKey] = useState(0);
  const buildErr = productsQ.error ?? competitorsQ.error;
  // A refetch keeps the loaded rows on screen; this only drives the shimmer on rows
  // whose column has not arrived. Seeded true when a selection exists at mount so the
  // first paint shows the pending rows, not an empty state.
  const [isFetching, setIsFetching] = useState(() => selected.length > 0);

  // Expanded rows, keyed "<lens>:<competitorId>" so each lens expands independently.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [exportIncludeYou, setExportIncludeYou] = useState(true);
  const [exportDone, setExportDone] = useState(false);

  // Hydrate persisted export prefs (post-mount → no SSR mismatch).
  useEffect(() => {
    try {
      const ex = JSON.parse(localStorage.getItem(EXPORT_STORAGE) ?? "null");
      if (ex && typeof ex === "object") {
        if (["csv", "markdown", "tsv"].includes(ex.format)) setExportFormat(ex.format);
        if (typeof ex.includeYou === "boolean") setExportIncludeYou(ex.includeYou);
      }
    } catch {
      /* corrupt prefs — ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        EXPORT_STORAGE,
        JSON.stringify({ format: exportFormat, includeYou: exportIncludeYou }),
      );
    } catch {
      /* storage blocked — ignore */
    }
  }, [exportFormat, exportIncludeYou]);

  // Build the picker once the inputs are available (the non-seeded path); guarded so a
  // later refetch can't clobber a live selection. Waits for the ranking to settle
  // (success OR error) so the default rows are data-ranked; it's best-effort, so a
  // failure (isLoading→false, no data) still builds.
  useEffect(() => {
    if (initializedRef.current || !productsQ.data || !competitorsQ.data || rankingQ.isLoading)
      return;
    initializedRef.current = true;
    const built = buildPickList(
      productsQ.data,
      competitorsQ.data,
      rankingQ.data ?? {},
      productId,
    );
    setEntities(built.entities);
    // The user's own selection wins over the ranked default as soon as the entities it
    // names are known — done here too (not only in the effect below) because this path
    // can run after that one, and would otherwise reset the restored selection.
    setSelected(readStoredSelection(selectionKey(productId), built.entities) ?? built.selected);
    restoredRef.current = true;
    setSelectionRestored(true);
  }, [productsQ.data, competitorsQ.data, rankingQ.isLoading, rankingQ.data, productId]);

  // Restore the persisted selection on the server-seeded path, where the picker was
  // built during the first render and the effect above never runs. Post-mount (never in
  // the useState initializer) so the server HTML and the first client render match.
  useEffect(() => {
    if (restoredRef.current || !entities) return;
    restoredRef.current = true;
    const stored = readStoredSelection(selectionKey(productId), entities);
    if (stored) setSelected(stored);
    setSelectionRestored(true);
  }, [entities, productId]);

  // Persist every later change. Gated on the restore so the default seed can't
  // overwrite the stored selection before it has been read.
  useEffect(() => {
    if (!selectionRestored) return;
    try {
      localStorage.setItem(selectionKey(productId), JSON.stringify(selected));
    } catch {
      /* storage blocked — ignore */
    }
  }, [selected, selectionRestored, productId]);

  useEffect(() => {
    if (!selectionRestored) return;
    if (selected.length === 0) {
      setMatrix([]);
      setIsFetching(false);
      return;
    }
    let cancelled = false;
    // Keep the loaded rows rendered while refetching: only newly-added ids shimmer.
    setIsFetching(true);
    api
      .compareCompetitors(selected)
      .then((r) => {
        if (cancelled) return;
        setMatrix(r.competitors);
        setMatrixError(false);
        setIsFetching(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Keep what is on screen and flag the error, rather than showing a silent
        // "nothing to compare".
        setMatrixError(true);
        setIsFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, matrixReloadKey, selectionRestored]);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Appended last, so capSelection drops it (and only it) when a cap is reached.
      return capSelection([...prev, id], kindsOf(entities ?? []));
    });
  }

  function toggleRow(lens: string, id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      const key = `${lens}:${id}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const youIds = useMemo(
    () => new Set((entities ?? []).filter((e) => e.kind === "you").map((e) => e.id)),
    [entities],
  );
  const byId = useMemo(() => new Map((entities ?? []).map((e) => [e.id, e])), [entities]);
  const matrixById = useMemo(
    () => new Map((matrix ?? []).map((c) => [c.id, c])),
    [matrix],
  );

  /**
   * The rendered roster: derived from `selected` (so add/remove reflects instantly)
   * with your products pinned first. Every lens renders THIS list, in THIS order.
   */
  const rows = useMemo<CompareEntity[]>(() => {
    const order = [
      ...selected.filter((id) => youIds.has(id)),
      ...selected.filter((id) => !youIds.has(id)),
    ];
    const base = order.map((id) => {
      const data = matrixById.get(id) ?? null;
      const pick = byId.get(id);
      return {
        id,
        name: data?.name ?? pick?.name ?? "—",
        mine: youIds.has(id),
        color: pick?.color ?? null,
        url: data?.url ?? pick?.url ?? null,
        data,
        pending: !data && isFetching,
      };
    });
    // Compare is a chart before it is a list: a competitor who was never given a colour
    // still needs one here, or every bar on the page is the same grey.
    const series = assignSeriesColors(base);
    return base.map((row) => ({ ...row, color: series.get(row.id) ?? row.color }));
  }, [selected, youIds, matrixById, byId, isFetching]);

  const loadedCols = useMemo(
    () => rows.map((r) => r.data).filter((d): d is CompareColumn => d != null),
    [rows],
  );
  const youCol = useMemo(
    () => rows.find((r) => r.mine)?.data ?? null,
    [rows],
  );
  const compCols = useMemo(
    () => rows.filter((r) => !r.mine).map((r) => r.data).filter((d): d is CompareColumn => d != null),
    [rows],
  );
  const captured = useMemo(() => capturedUpTo(loadedCols), [loadedCols]);

  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const pickYou = useMemo(() => (entities ?? []).filter((e) => e.kind === "you"), [entities]);
  const pickComps = useMemo(
    () => (entities ?? []).filter((e) => e.kind === "competitor"),
    [entities],
  );
  const hasCompetitors = pickComps.length > 0;
  const canExport = loadedCols.length > 0;

  const lensProps = (lens: string) => ({
    entities: rows,
    expanded: new Set(
      [...expanded].filter((k) => k.startsWith(`${lens}:`)).map((k) => k.slice(lens.length + 1)),
    ),
    onToggle: (id: string) => toggleRow(lens, id),
  });

  /**
   * The measure lenses that will actually draw, dealt alternately into two columns.
   * Fixed slots (price+hiring left, rating+stack right) emptied the whole right half
   * whenever a set had no reviews and no detected stack; alternating keeps both
   * columns fed, and with a full roster it reproduces the original pairing exactly.
   */
  const visibleLenses = useMemo<MeasureLensId[]>(
    () => MEASURE_LENSES.filter((id) => lensHasContent[id](rows)),
    [rows],
  );

  const renderLens = (id: MeasureLensId) => {
    if (id === "price") return <PriceLens key={id} {...lensProps("price")} />;
    if (id === "rating") return <RatingLens key={id} {...lensProps("rating")} />;
    if (id === "hiring") return <HiringLens key={id} {...lensProps("hiring")} />;
    return <StackLens key={id} entities={rows} />;
  };

  async function runExport() {
    const cols = exportIncludeYou
      ? loadedCols
      : loadedCols.filter((c) => !youIds.has(c.id));
    if (cols.length === 0) return;
    try {
      if (exportFormat === "csv") {
        const blob = new Blob([toDelimited(cols, ",")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `compare-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (exportFormat === "markdown") {
        await navigator.clipboard.writeText(toMarkdown(cols));
      } else {
        await navigator.clipboard.writeText(toDelimited(cols, "\t"));
      }
      setExportDone(true);
      setTimeout(() => setExportDone(false), 1500);
    } catch {
      /* clipboard/download blocked — no-op */
    }
  }

  const exportIsCopy = exportFormat !== "csv";
  const compCount = rows.filter((r) => !r.mine).length;
  const subject = youCol?.name ?? rows.find((r) => r.mine)?.name ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        flush
        title="Compare"
        sub={
          hasCompetitors && compCount > 0 ? (
            <>
              {subject ? `${subject} against ` : "Comparing "}
              {compCount} competitor{compCount > 1 ? "s" : ""}
              {captured && (
                <>
                  {" · captured "}
                  <span className="font-mono tabular-nums">{agePhrase(captured)}</span>
                </>
              )}
            </>
          ) : (
            "Your product and its competitors, measured side by side."
          )
        }
        actions={
          <div className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              className="rounded-r-none border-r-0"
              onClick={runExport}
              disabled={!canExport}
            >
              {exportDone ? (
                <CheckIcon size={16} />
              ) : exportIsCopy ? (
                <CopyIcon size={16} />
              ) : (
                <DownloadSimpleIcon size={16} />
              )}
              {exportDone
                ? exportIsCopy
                  ? "Copied"
                  : "Saved"
                : EXPORT_BUTTON_LABEL[exportFormat]}
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
                  <CaretDownIcon size={16} />
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
                  checked={exportIncludeYou}
                  onCheckedChange={(v) => setExportIncludeYou(Boolean(v))}
                >
                  Include your product
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {entities === null ? (
        buildErr ? (
          <p className="text-muted-foreground text-sm">
            Couldn&apos;t load your competitors.{" "}
            <button
              type="button"
              onClick={() => {
                void productsQ.refetch();
                void competitorsQ.refetch();
              }}
              className="text-link underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        ) : (
          <Skeleton className="h-9 w-full" />
        )
      ) : !hasCompetitors ? (
        <p className="text-muted-foreground text-sm">
          Add competitors first, then compare them against your product.
        </p>
      ) : (
        <>
          <CompareSetRail
            chips={rows}
            pickYou={pickYou}
            pickComps={pickComps}
            selectedIds={selectedIds}
            maxCompetitors={MAX_COMPETITORS}
            maxTotal={MAX_COLUMNS}
            onToggle={toggle}
          />

          {selected.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Pick competitors above to compare.
            </p>
          ) : matrixError && loadedCols.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Couldn&apos;t load the comparison.{" "}
              <button
                type="button"
                onClick={() => {
                  setMatrixError(false);
                  setMatrixReloadKey((k) => k + 1);
                }}
                className="text-link underline underline-offset-2"
              >
                Retry
              </button>
            </p>
          ) : !isFetching && loadedCols.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing to compare.</p>
          ) : (
            <>
              {youCol && compCols.length > 0 && (
                <CompareVerdict you={youCol} comps={compCols} />
              )}

              {/* Two independent columns, not a two-column grid: a shared grid row
                  couples the heights, so expanding a row in Rating would leave a void
                  under Price. A lone lens takes the full width rather than sitting in
                  a half-empty grid. */}
              {visibleLenses.length <= 1 ? (
                visibleLenses.map(renderLens)
              ) : (
                <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-x-10">
                  <div className="flex min-w-0 flex-col gap-8">
                    {visibleLenses.filter((_, i) => i % 2 === 0).map(renderLens)}
                  </div>
                  <div className="flex min-w-0 flex-col gap-8">
                    {visibleLenses.filter((_, i) => i % 2 === 1).map(renderLens)}
                  </div>
                </div>
              )}

              <PositioningLens entities={rows} />
              <MovesLens entities={rows} />
            </>
          )}
        </>
      )}
    </div>
  );
}
