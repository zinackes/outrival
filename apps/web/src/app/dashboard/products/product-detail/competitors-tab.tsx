"use client";

import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import type { ProductLinkedCompetitor } from "@/lib/api";
import { competitorNameColor } from "@/lib/competitor-color";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The competitors this product is measured against.
 *
 * Shared and specific are stated per row rather than sorted apart: which bucket a
 * competitor sits in matters when you are deciding, and hiding it in a section
 * header means reading the header to interpret every row.
 */
export function ProductCompetitors({
  productId,
  competitors,
}: {
  productId: string;
  competitors: ProductLinkedCompetitor[];
}) {
  if (competitors.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center">
        <p className="text-sm font-semibold">No competitors on this product yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Link competitors to it and its signals, battle cards and price comparison
          start filling in. Discovery suggests them from this product&apos;s positioning.
        </p>
        <Button asChild size="sm">
          <Link href="/dashboard/discovery">
            <Search size={14} />
            Find competitors
          </Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="divide-y divide-border p-0">
        {competitors.map((c) => (
          <div key={c.competitorId} className="flex items-center gap-3 px-4 py-2.5">
            <CompAvatar name={c.name} url={c.url} size={24} />
            <Link
              href={`/dashboard/competitors/${c.competitorId}`}
              className="min-w-0 flex-1 truncate rounded-sm text-dense font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {c.name}
            </Link>
            {c.relevanceScore != null && (
              <span className="hidden font-mono text-meta tabular-nums text-muted-foreground sm:inline">
                {c.relevanceScore} overlap
              </span>
            )}
            <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
              {c.isSpecific ? "Specific" : "Shared"}
            </span>
            {c.url && (
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Open ${c.name}`}
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        ))}
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/discovery">
            <Search size={14} />
            Find more
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/dashboard/signals?product=${encodeURIComponent(productId)}`}>
            See their signals
          </Link>
        </Button>
      </div>
      <p className="m-0 text-dense text-muted-foreground">
        Shared competitors are watched for every product. Specific ones only count
        here, and only they tag this product on a signal.
      </p>
    </div>
  );
}
