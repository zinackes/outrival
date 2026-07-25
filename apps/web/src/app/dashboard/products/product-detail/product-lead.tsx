"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { MyProduct, ProductSummary } from "@/lib/api";
import { sourceLabel } from "@/lib/source-labels";
import { shortAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * What this product IS, said as a sentence, with the numbers that describe its
 * position beside it.
 *
 * The page used to open on seven cards of equal weight, so the line that drives
 * discovery, battle cards and Ask sat at the same level as "Tech stack detected".
 * This is that line, promoted, with the reason it is worth filling stated rather
 * than implied, and the three counts that answer "where does this product stand"
 * on a rail (the shape the Overview's lead already uses).
 */
export function ProductLead({
  product,
  row,
  competitorCount,
  specificCount,
  onEdit,
  onRescan,
  canRescan,
}: {
  product: MyProduct;
  /** The portfolio row for this product, when the list is in cache. */
  row?: ProductSummary;
  competitorCount: number | null;
  specificCount: number | null;
  onEdit: () => void;
  onRescan: () => void;
  canRescan: boolean;
}) {
  const profile = product.profile ?? {};
  const valueProp = profile.valueProp?.value?.trim();
  const category = profile.category?.value?.trim();
  const audience = profile.audience?.value?.trim();

  // Which of the five profile fields we still do not have from them. Named, not
  // scored: "3 of 5" tells nobody what to type.
  const missing = [
    !category && "a category",
    !audience && "who it is for",
    !valueProp && "a value proposition",
    !(profile.features?.value?.length ?? 0) && "its features",
    !(profile.techStack?.value?.length ?? 0) && "its tech stack",
  ].filter(Boolean) as string[];

  const detected = profile.valueProp?.isFromAutoDetect ?? false;
  const editedAt = profile.valueProp?.lastEditedByUserAt;
  const stats = row?.stats;
  const cov = row?.coverage;

  return (
    <div className="grid overflow-hidden rounded-lg border border-border-strong bg-card lg:grid-cols-[minmax(0,1fr)_264px]">
      <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <span>Positioning</span>
          {category && (
            <>
              <span aria-hidden>·</span>
              <span>{category}</span>
            </>
          )}
          <span aria-hidden>·</span>
          {detected ? (
            <span className="inline-flex items-center gap-1">
              <Sparkles size={11} />
              read from your site
              {product.lastScanAt
                ? ` ${formatDistanceToNow(new Date(product.lastScanAt), { addSuffix: true })}`
                : ""}
            </span>
          ) : editedAt ? (
            <span>
              edited by you {formatDistanceToNow(new Date(editedAt), { addSuffix: true })}
            </span>
          ) : (
            <span>not set yet</span>
          )}
        </div>

        {valueProp ? (
          <p className="m-0 max-w-[46ch] text-lead font-medium leading-snug tracking-tight text-pretty lg:text-xl">
            {valueProp}
          </p>
        ) : (
          <p className="m-0 max-w-[46ch] text-lead font-medium leading-snug tracking-tight text-muted-foreground lg:text-xl">
            We have not read a value proposition for this product yet.
          </p>
        )}

        {audience && <p className="m-0 max-w-[62ch] text-sm text-muted-foreground">For {audience}.</p>}

        <p className="m-0 max-w-[66ch] border-t border-dashed border-border pt-3 text-sm text-muted-foreground">
          This is what everything else is measured against: discovery scores candidates
          on it, battle cards argue from it, and Ask answers from it.
          {missing.length > 0 && (
            <span className="text-foreground">
              {" "}
              Still missing {missing.slice(0, 2).join(" and ")}
              {missing.length > 2 ? `, and ${missing.length - 2} more` : ""}.
            </span>
          )}
        </p>

        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onEdit}>
            {missing.length > 0 ? "Complete the positioning" : "Edit positioning"}
          </Button>
          {canRescan && (
            <Button size="sm" variant="outline" onClick={onRescan}>
              Read it from the site again
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col border-border bg-background-2 max-lg:flex-row max-lg:border-t max-sm:flex-col lg:border-l">
        <LeadStat label="Competitors on this product">
          <StatValue value={competitorCount ?? 0} />
          <span className="text-xs text-muted-foreground">
            {competitorCount === null
              ? "loading"
              : competitorCount === 0
                ? "none linked yet"
                : specificCount
                  ? `${specificCount} specific to it`
                  : "all shared with your other products"}
          </span>
        </LeadStat>

        {stats && (
          <LeadStat
            label="Signals, 7 days"
            href={row ? `/dashboard/signals?product=${encodeURIComponent(row.id)}` : undefined}
          >
            <StatValue value={stats.signals7d} />
            <span className="text-xs text-muted-foreground">
              {stats.critical7d > 0
                ? `${stats.critical7d} critical`
                : stats.lastSignalAt
                  ? `last one ${shortAge(stats.lastSignalAt)} ago`
                  : "nothing yet"}
            </span>
          </LeadStat>
        )}

        {cov && cov.sources > 0 && (
          <LeadStat label="Sources reporting" href="/dashboard/activity">
            <StatValue value={cov.sources - cov.failing} />
            <span className="text-xs text-muted-foreground">of {cov.sources} watched</span>
            {cov.failing > 0 && (
              <span className="text-xs text-link">
                {sourceLabel(cov.failingSource)} stopped answering
              </span>
            )}
          </LeadStat>
        )}
      </div>
    </div>
  );
}

function LeadStat({
  label,
  href,
  children,
}: {
  label: string;
  href?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {label}
          {href && (
            <ArrowRight
              size={11}
              className="opacity-0 transition-opacity group-hover/stat:opacity-100"
              aria-hidden
            />
          )}
        </span>
      </div>
      {children}
    </>
  );
  const className = cn(
    "group/stat flex min-w-0 flex-1 flex-col gap-1 border-border px-4 py-3",
    "border-b last:border-b-0 max-lg:border-b-0 max-lg:border-r max-lg:last:border-r-0",
    "max-sm:border-b max-sm:border-r-0 max-sm:last:border-b-0",
    href && "outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40",
  );
  return href ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function StatValue({ value }: { value: number }) {
  return (
    <span className="font-mono text-xl font-semibold leading-none tracking-tight tabular-nums">
      {value}
    </span>
  );
}
