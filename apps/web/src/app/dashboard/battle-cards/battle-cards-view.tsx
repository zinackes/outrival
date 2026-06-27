"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Download, Swords } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { api, type BattleCardSummary } from "@/lib/api";
import { battleCardsQuery } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { PageHead } from "@/components/dashboard/page-head";
import { ListRowsSkeleton } from "@/components/dashboard/skeletons";
import { ListError } from "@/components/outrival/list-error";

function cardTitle(c: BattleCardSummary): string {
  return c.productName ? `${c.productName} vs ${c.competitorName}` : c.competitorName;
}

export function BattleCardsView() {
  // Server-seeded on first paint (battle-cards/page.tsx) → useQuery reads the
  // hydrated cache; falls back to a client fetch when the seed is missing.
  const battleCardsQ = useQuery(battleCardsQuery());
  const cards = battleCardsQ.data ?? null;
  const err = battleCardsQ.error;
  const [product, setProduct] = useState<string>("all");
  const [competitor, setCompetitor] = useState<string>("all");

  const products = useMemo(() => {
    const m = new Map<string, string>();
    (cards ?? []).forEach((c) => {
      if (c.productId && c.productName) m.set(c.productId, c.productName);
    });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [cards]);

  const competitors = useMemo(() => {
    const m = new Map<string, string>();
    (cards ?? []).forEach((c) => m.set(c.competitorId, c.competitorName));
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);

  const filtered = useMemo(() => {
    return (cards ?? []).filter((c) => {
      if (product !== "all" && c.productId !== product) return false;
      if (competitor !== "all" && c.competitorId !== competitor) return false;
      return true;
    });
  }, [cards, product, competitor]);

  const productLabel =
    product === "all"
      ? "All products"
      : (products.find((p) => p.id === product)?.name ?? "All products");
  const competitorLabel =
    competitor === "all"
      ? "All competitors"
      : (competitors.find((c) => c.id === competitor)?.name ?? "All competitors");

  if (err && cards === null) {
    return (
      <div className="space-y-6">
        <PageHead title="Battle cards" sub="Strategic one-pagers per competitor." />
        <ListError error={err} onRetry={() => battleCardsQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHead
        title="Battle cards"
        sub={
          cards
            ? `${cards.length} card${cards.length === 1 ? "" : "s"} across your products.`
            : "Loading…"
        }
      />

      {products.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {productLabel}
                <ChevronDown size={11} className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup value={product} onValueChange={setProduct}>
                <DropdownMenuRadioItem value="all">All products</DropdownMenuRadioItem>
                {products.map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id}>
                    {p.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {competitorLabel}
                <ChevronDown size={11} className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-[400px] overflow-y-auto">
              <DropdownMenuRadioGroup value={competitor} onValueChange={setCompetitor}>
                <DropdownMenuRadioItem value="all">All competitors</DropdownMenuRadioItem>
                {competitors.map((c) => (
                  <DropdownMenuRadioItem key={c.id} value={c.id}>
                    {c.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {cards === null ? (
        <ListRowsSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Swords}
          title={cards.length === 0 ? "No battle cards yet" : "No matching battle cards"}
          description={
            cards.length === 0
              ? "Generate one from a competitor's page to compare it against your product."
              : "Adjust the filters to see results."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
              {filtered.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                    <Swords size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/competitors/${c.competitorId}?tab=battlecard`}
                      className="block truncate text-dense font-medium text-foreground hover:underline"
                    >
                      {cardTitle(c)}
                    </Link>
                    <div className="text-meta text-muted-foreground font-mono">
                      Updated {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
                    </div>
                  </div>
                  {c.hasPdf && (
                    <a
                      href={api.battleCardPdfUrl(c.competitorId, c.productId ?? undefined)}
                      className="shrink-0"
                    >
                      <Button variant="outline" size="sm">
                        <Download size={12} /> PDF
                      </Button>
                    </a>
                  )}
                </div>
              ))}
            </div>
        </Card>
      )}
    </div>
  );
}
