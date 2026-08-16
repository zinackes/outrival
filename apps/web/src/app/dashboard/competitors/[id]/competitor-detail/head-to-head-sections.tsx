"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { productsListQuery } from "@/lib/queries";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { useFx } from "@/lib/fx";
import { cn } from "@/lib/utils";
import { TabCard, TabSection } from "@/components/outrival/tab-shell";
import { SeenBadge } from "@/components/dashboard/seen-badge";
import { buildHeadToHead } from "@/components/dashboard/compare/head-to-head";
import type { Tone } from "@/components/dashboard/compare/derive";

/**
 * "How you compare" and "How to differentiate" on the competitor profile (OUT-194).
 *
 * The page used to compare them to your product with a two-row table of levels. This
 * is the same duel read as findings: which side each dimension favours, by how much,
 * and off which surface. Nothing is invented here — the whole reading is derived from
 * the same captured columns the /compare page draws its verdict from, so a line can
 * always be checked against the tab that owns the number.
 *
 * Renders nothing until both columns are in hand: a one-sided comparison is worse
 * than none, and a skeleton for a block that may turn out to be empty would reserve
 * space the page never fills.
 */

const TONE_VALUE: Record<Tone, string> = {
  good: "text-positive",
  bad: "text-critical",
  warn: "text-high",
  flat: "text-muted-foreground",
};

// How many moves the differentiation block will make before it stops being advice.
const MAX_MOVES = 4;

export function HeadToHeadSections({ competitorId }: { competitorId: string }) {
  const scope = useProductScope();
  const fx = useFx();
  const productsQ = useQuery(productsListQuery());

  // Which of your products this competitor is being read against: the scoped one,
  // else the primary. Same rule the compare page pins its "you" column with.
  const products = (productsQ.data ?? []).filter((p) => p.status !== "archived");
  const product = (scope ? products.find((p) => p.id === scope) : null) ?? products[0] ?? null;
  const selfId = product?.selfCompetitorId ?? null;

  const compareQ = useQuery({
    queryKey: ["compare", "head-to-head", selfId, competitorId] as const,
    queryFn: () => api.compareCompetitors([selfId as string, competitorId]),
    enabled: selfId != null && selfId !== competitorId,
    retry: false,
  });

  const cols = compareQ.data?.competitors ?? [];
  const you = cols.find((c) => c.id === selfId) ?? null;
  const them = cols.find((c) => c.id === competitorId) ?? null;
  if (!you || !them) return null;

  const { compare, differentiate } = buildHeadToHead(you, them, Date.now(), fx?.rates ?? null);
  if (compare.length === 0 && differentiate.length === 0) return null;

  return (
    <TabCard>
      {compare.length > 0 && (
        <TabSection
          title="How you compare"
          action={
            <span className="shrink-0 truncate text-xs text-muted-foreground">{you.name}</span>
          }
        >
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {compare.map((line) => (
              <li key={line.key} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold">{line.lead}</span>{" "}
                    <span className="text-muted-foreground">{line.rest}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 whitespace-nowrap text-dense tabular-nums",
                      TONE_VALUE[line.tone],
                    )}
                  >
                    {line.value}
                  </span>
                </div>
                <SeenBadge source={line.provenance.source} at={line.provenance.at} />
              </li>
            ))}
          </ul>
        </TabSection>
      )}

      {differentiate.length > 0 && (
        <TabSection title="How to differentiate">
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {differentiate.slice(0, MAX_MOVES).map((move) => (
              <li key={move.key} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm">
                  <span className="font-semibold">{move.action}</span>:{" "}
                  <span className="text-muted-foreground">{move.because}</span>
                </span>
                <SeenBadge source={move.provenance.source} at={move.provenance.at} />
              </li>
            ))}
          </ul>
        </TabSection>
      )}
    </TabCard>
  );
}
