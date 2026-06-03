"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Download, Swords } from "lucide-react";
import { api, type BattleCardSummary } from "@/lib/api";
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

export default function BattleCardsPage() {
  const [cards, setCards] = useState<BattleCardSummary[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [product, setProduct] = useState<string>("all");
  const [competitor, setCompetitor] = useState<string>("all");

  const load = useCallback(() => {
    setErr(null);
    api
      .listBattleCards()
      .then((r) => setCards(r.battleCards))
      .catch((e) => setErr(e));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      <div className="space-y-[22px]">
        <PageHead title="Battle cards" sub="Strategic one-pagers per competitor." />
        <ListError error={err} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-[22px]">
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
      ) : (
        <Card className="overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-14 text-center text-muted-foreground">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-background border border-border flex items-center justify-center">
                <Swords size={16} className="text-muted-foreground/60" />
              </div>
              <div className="font-semibold text-base text-foreground mb-1.5 tracking-tight">
                {cards.length === 0 ? "No battle cards yet" : "No matching battle cards"}
              </div>
              <div className="text-[13px] max-w-[400px] mx-auto">
                {cards.length === 0
                  ? "Generate one from a competitor's page to compare it against your product."
                  : "Adjust the filters to see results."}
              </div>
            </div>
          ) : (
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
                      href={`/dashboard/competitors/${c.competitorId}`}
                      className="block truncate text-[13px] font-medium text-foreground hover:underline"
                    >
                      {cardTitle(c)}
                    </Link>
                    <div className="text-[11px] text-muted-foreground/80 font-mono">
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
          )}
        </Card>
      )}
    </div>
  );
}
