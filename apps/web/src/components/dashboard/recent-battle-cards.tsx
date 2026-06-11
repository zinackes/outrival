"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Swords } from "lucide-react";
import { api, type BattleCardSummary } from "@/lib/api";
import { SectionHead } from "./section-head";

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
    <section>
      <SectionHead
        title="Recent battle cards"
        sub="strategic one-pagers comparing your products to competitors"
        divider={false}
        action={
          <Link
            href="/dashboard/battle-cards"
            className="inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
            <ArrowRight size={12} />
          </Link>
        }
      />
      <div className="mt-3 overflow-hidden rounded-md border border-border">
        {recent.map((c) => (
          <Link
            key={c.id}
            href={`/dashboard/competitors/${c.competitorId}?tab=battlecard`}
            className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              <Swords size={13} />
            </span>
            <span className="min-w-0 flex-1 truncate text-dense text-foreground">
              {cardTitle(c)}
            </span>
            <span className="shrink-0 text-meta text-muted-foreground font-mono">
              {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
