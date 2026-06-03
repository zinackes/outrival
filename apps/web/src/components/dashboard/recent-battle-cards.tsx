"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Swords } from "lucide-react";
import { api, type BattleCardSummary } from "@/lib/api";
import { Card } from "@/components/ui/card";

function cardTitle(c: BattleCardSummary): string {
  return c.productName ? `${c.productName} vs ${c.competitorName}` : c.competitorName;
}

// patch-29 — discreet "recent battle cards" surface on the overview. Battle cards
// no longer live in the sidebar; this links to the dedicated /dashboard/battle-cards
// page. Renders nothing when the org has no cards yet (keeps the overview clean).
export function RecentBattleCards() {
  const [cards, setCards] = useState<BattleCardSummary[] | null>(null);

  useEffect(() => {
    api
      .listBattleCards()
      .then((r) => setCards(r.battleCards))
      .catch(() => setCards([]));
  }, []);

  if (!cards || cards.length === 0) return null;
  const recent = cards.slice(0, 3);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="font-semibold text-[13px] tracking-tight">
            Recent battle cards
          </div>
          <div className="text-muted-foreground/80 text-[11px] font-mono">
            Strategic one-pagers comparing your products to competitors.
          </div>
        </div>
        <Link
          href="/dashboard/battle-cards"
          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          View all
          <ArrowRight size={12} />
        </Link>
      </div>
      <div className="divide-y divide-border">
        {recent.map((c) => (
          <Link
            key={c.id}
            href={`/dashboard/competitors/${c.competitorId}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              <Swords size={13} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
              {cardTitle(c)}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground/80 font-mono">
              {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
