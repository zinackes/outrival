"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { PLAN_LABELS, type Plan } from "@outrival/shared";
import type { ProductSummary } from "@/lib/api";
import { productsSettingsQuery } from "@/lib/queries";
import { shortAge } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { prettyUrl, cn } from "@/lib/utils";
import { PageHead } from "@/components/dashboard/page-head";
import { ProductTile } from "@/components/dashboard/product-tile";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { ActivitySpark } from "@/components/dashboard/activity-spark";
import { DeltaPill, computeDelta } from "@/components/dashboard/delta-pill";
import { TableSkeleton } from "@/components/dashboard/skeletons";
import { AddProductWizard } from "@/components/outrival/add-product-wizard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The portfolio: every SKU on the axes that decide which one needs you today.
 *
 * It deliberately carries no summary card. The week's story is the Overview's
 * job, and a second lead here would make this page a smaller dashboard instead
 * of the one thing only it can be, a comparison between your own products. So it
 * opens straight on the line-up: who each product is up against, what moved
 * around it, where its entry price sits in that band, and whether we are still
 * capturing it.
 */

// The row's six slots, dropped from the right as the column narrows (the rail
// eats ~256px). Order follows the DOM: gutter, product, competitors, activity,
// price, coverage, chevron.
const GRID = cn(
  "grid items-center gap-x-3.5",
  "grid-cols-[0.375rem_minmax(0,1.4fr)_minmax(0,1fr)_1.75rem]",
  "@2xl:grid-cols-[0.375rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_1.75rem]",
  "@4xl:grid-cols-[0.375rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_9rem_1.75rem]",
  "@5xl:grid-cols-[0.375rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_9rem_8rem_1.75rem]",
);

export function ProductsPortfolio() {
  const queryClient = useQueryClient();
  const productsQ = useQuery(productsSettingsQuery());
  const products = productsQ.data?.products ?? null;
  const plan = (productsQ.data?.plan as Plan) ?? "free";
  const limit = productsQ.data?.limit ?? 1;
  const [addOpen, setAddOpen] = useState(false);

  const active = (products ?? []).filter((p) => p.status !== "archived");
  const atLimit = active.length >= limit;

  return (
    <div className="xl:px-6 2xl:px-12">
      <PageHead
        title="Products"
        sub="Each product carries its own competitors, price position and battle cards."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/settings/products">Manage products</Link>
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)} disabled={atLimit}>
              <Plus size={14} />
              Add product
            </Button>
          </div>
        }
      />

      {productsQ.isError && (
        <Card className="px-5 py-4 text-sm text-muted-foreground">
          Products could not be loaded. Refresh the page to try again.
        </Card>
      )}

      {!products && !productsQ.isError && <TableSkeleton rows={3} />}

      {products && active.length > 0 && (
        <div className="@container">
          <div
            className={cn(
              GRID,
              "border-b border-border px-2 pb-2 text-meta font-medium text-muted-foreground",
            )}
          >
            <span />
            <span>Product</span>
            <span>Competitors</span>
            <ColumnLabel
              className="hidden @2xl:flex"
              tip="Signals in the last 7 days against the 7 before, on this product's competitors. The bars are one per day over 14 days."
            >
              Activity
            </ColumnLabel>
            <ColumnLabel
              className="hidden @4xl:flex"
              tip="Your cheapest paid tier, marked on the band your priced competitors occupy."
            >
              Entry price
            </ColumnLabel>
            <ColumnLabel
              className="hidden @5xl:flex"
              tip="This product's own sources, and when the last one answered."
            >
              Capture
            </ColumnLabel>
            <span />
          </div>

          {active.map((p) => (
            <ProductRow key={p.id} product={p} />
          ))}
        </div>
      )}

      {/* The page only renders with two or more products (one redirects to its own
          page), so this covers a client refetch that archived the rest. */}
      {products && active.length === 0 && (
        <Card className="border-dashed px-5 py-6 text-center text-sm text-muted-foreground">
          Every product was removed. Add one to start watching it.
        </Card>
      )}

      {products && active.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong px-4 py-3 text-dense text-muted-foreground">
          <span>
            You are using{" "}
            <span className="font-mono tabular-nums text-foreground">{active.length}</span> of{" "}
            <span className="font-mono tabular-nums text-foreground">{limit}</span> products on{" "}
            {PLAN_LABELS[plan]}.
          </span>
          {atLimit ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/settings/billing">Upgrade to track more</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus size={14} />
              Add product
            </Button>
          )}
        </div>
      )}

      <AddProductWizard
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() =>
          queryClient.invalidateQueries({ queryKey: productsSettingsQuery().queryKey })
        }
      />
    </div>
  );
}

function ColumnLabel({
  children,
  tip,
  className,
}: {
  children: React.ReactNode;
  tip: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-help items-center", className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px]">{tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * One product. The gutter carries an open critical, which is the only state that
 * earns color before the user has read anything; everything else is neutral until
 * asked.
 */
function ProductRow({ product: p }: { product: ProductSummary }) {
  const stats = p.stats ?? { signals7d: 0, signalsPrev: 0, critical7d: 0, lastSignalAt: null };
  const cov = p.coverage ?? { sources: 0, failing: 0, failingSource: null };
  const delta = computeDelta(stats.signals7d, stats.signalsPrev);
  const href = `/dashboard/products/${p.id}`;

  return (
    <div
      className={cn(
        GRID,
        "group relative rounded-md border-b border-border px-2 py-2.5 transition-colors hover:bg-surface-2 focus-within:bg-surface-2",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-7 w-1 rounded-full",
          stats.critical7d > 0 ? "bg-critical" : "bg-transparent",
        )}
      />

      <div className="flex min-w-0 items-center gap-2.5">
        <ProductTile
          name={p.name}
          url={p.url}
          repoUrl={p.repoUrl}
          position={p.position}
          size={28}
          ring
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={href}
              // Stretched link: the whole row navigates without nesting anything
              // interactive inside an <a>.
              className="min-w-0 truncate rounded-sm text-dense font-semibold outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {p.name}
            </Link>
            {p.isPrimary && (
              <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                Primary
              </span>
            )}
            {p.stage === "idea" && (
              <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                Not live
              </span>
            )}
            {p.stage === "developing" && (
              <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                In development
              </span>
            )}
          </div>
          <span className="truncate font-mono text-meta text-muted-foreground">
            {p.url
              ? prettyUrl(p.url)
              : p.repoUrl
                ? prettyUrl(p.repoUrl)
                : "No site or repo yet"}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {p.topCompetitors?.length ? (
          <>
            <span className="flex items-center">
              {p.topCompetitors.map((c) => (
                <span key={c.id} className="-ml-1.5 first:ml-0">
                  <CompAvatar name={c.name} url={c.url} size={20} />
                </span>
              ))}
            </span>
            <span className="truncate text-dense text-muted-foreground">
              {p.competitorCount > (p.topCompetitors?.length ?? 0)
                ? `+${p.competitorCount - (p.topCompetitors?.length ?? 0)} more`
                : p.topCompetitors.map((c) => c.name).join(", ")}
            </span>
          </>
        ) : (
          <span className="text-dense text-muted-foreground">None linked yet</span>
        )}
      </div>

      <div className="hidden min-w-0 flex-col gap-1.5 @2xl:flex">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-dense font-semibold tabular-nums">
            {stats.signals7d}
          </span>
          {stats.signals7d > 0 ? (
            <DeltaPill delta={delta} />
          ) : (
            <span className="font-mono text-xs text-muted-foreground">—</span>
          )}
        </span>
        <ActivitySpark
          values={p.activity ?? []}
          label={`${stats.signals7d} signals in the last 7 days`}
        />
      </div>

      <div className="hidden min-w-0 @4xl:flex">
        <PriceBand pricing={p.pricing} />
      </div>

      <div className="hidden min-w-0 flex-col gap-0.5 text-xs @5xl:flex">
        {cov.failing > 0 ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-high">
              <span className="size-1.5 shrink-0 rounded-full bg-high" />
              <span className="truncate">{sourceLabel(cov.failingSource)} blocked</span>
            </span>
            <span className="font-mono text-meta tabular-nums text-muted-foreground">
              {cov.sources - cov.failing} of {cov.sources} live
            </span>
          </>
        ) : cov.sources > 0 ? (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-positive" />
              {cov.sources} source{cov.sources > 1 ? "s" : ""} live
            </span>
            <span className="font-mono text-meta tabular-nums text-muted-foreground">
              {p.lastScanAt ? `${shortAge(p.lastScanAt)} ago` : "never scanned"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Nothing watched yet</span>
        )}
      </div>

      <ChevronRight
        size={15}
        aria-hidden
        className="justify-self-end text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
}

/**
 * Your entry price marked on the band your priced competitors occupy.
 *
 * The band needs two rivals to be a band at all: with one, the marker would imply
 * a market from a single point, so the cell says what is missing instead. The gap
 * is stated against the median, since one enterprise list price would drag a mean
 * far above anything a buyer chooses between.
 */
function PriceBand({ pricing }: { pricing: ProductSummary["pricing"] }) {
  const entry = pricing?.entry ?? null;
  const { entryMonthly = null, median, low, high, rivalsPriced = 0 } = pricing ?? {};

  // The band is a monthly axis, so our own number has to be read on it too (an
  // annual plan ÷12, marked "≈"). A one-time price reaches no monthly axis at all.
  if (!entry || entryMonthly === null) {
    return (
      <span className="text-dense text-muted-foreground">
        {entry ? "One-time price" : rivalsPriced > 0 ? "No price of your own" : "Not priced"}
      </span>
    );
  }

  const rounded = Math.round(entryMonthly);
  const amount = `${entry.billingPeriod === "monthly" ? "" : "≈"}${
    entry.currency === "USD" ? "$" : ""
  }${rounded}${entry.currency === "USD" ? "" : ` ${entry.currency}`}`;

  if (median == null || low == null || high == null || rivalsPriced < 2) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-dense font-semibold tabular-nums">{amount}</span>
        <span className="text-meta text-muted-foreground">
          {rivalsPriced === 1 ? "1 rival priced" : "no priced rival"}
        </span>
      </div>
    );
  }

  // Position on the band, clamped so a price outside the rivals' range still
  // renders at an edge rather than escaping the track.
  const span = Math.max(1, high - low);
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - low) / span) * 100));
  const gap = Math.round(((entryMonthly - median) / median) * 100);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="relative block h-[5px] rounded-sm bg-surface-3">
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-sm bg-muted-foreground/30"
          style={{ left: "0%", right: "0%" }}
        />
        <span
          aria-hidden
          className="absolute top-[-2px] h-[9px] w-px bg-muted-foreground"
          style={{ left: `${pct(median)}%` }}
        />
        <span
          aria-hidden
          className="absolute top-[-3px] h-[11px] w-[2px] rounded-sm bg-primary"
          style={{ left: `${pct(entryMonthly)}%` }}
        />
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="font-mono text-dense font-semibold tabular-nums">{amount}</span>
        <span className="truncate text-meta text-muted-foreground">
          {gap === 0
            ? "at median"
            : `${Math.abs(gap)}% ${gap < 0 ? "under" : "over"} median`}
        </span>
      </span>
    </div>
  );
}
