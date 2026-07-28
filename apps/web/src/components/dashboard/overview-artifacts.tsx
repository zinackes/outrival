"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, FileTextIcon, IdentificationCardIcon } from "@phosphor-icons/react/ssr";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { battleCardsQuery, digestsQuery } from "@/lib/queries";
import { formatDate, shortAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";

/**
 * The two documents the workspace produces, as two shelves in the page's footer.
 *
 * This block used to enumerate three specific cards as a run of plain text, which
 * read as a footnote and implied those three mattered more than the set. Each
 * destination is now stated once, with the facts that decide whether to open it: how
 * many cards there are and how stale the oldest one is, which week the brief covers
 * and how much it says.
 *
 * It is also the only visible entry point to `/dashboard/battle-cards` (patch-29 took
 * them out of the sidebar rail, and ⌘K is the only other route in), so it earns its
 * place by being reachable, not by being loud.
 *
 * Renders nothing when the org has neither.
 */
export function OverviewArtifacts() {
  const cardsQ = useQuery(battleCardsQuery());
  const digestsQ = useQuery(digestsQuery());
  const cards = cardsQ.data ?? [];
  // Weekly only: a daily digest is a delivery mechanism, not a document a user goes
  // back to read.
  const brief = (digestsQ.data ?? []).find((d) => d.period === "weekly") ?? null;

  if (cards.length === 0 && !brief) return null;

  // Staleness is the reason to look at the set at all, so the oldest card speaks for it.
  const oldest = cards.reduce<(typeof cards)[number] | null>(
    (acc, c) =>
      acc === null || new Date(c.updatedAt) < new Date(acc.updatedAt) ? c : acc,
    null,
  );
  const takeaways = brief?.content?.tldr?.length ?? 0;

  return (
    <div
      className={cn(
        "grid gap-2.5",
        cards.length > 0 && brief && "sm:grid-cols-2",
      )}
    >
      {oldest && (
        <Shelf
          href="/dashboard/battle-cards"
          icon={IdentificationCardIcon}
          label="Battle cards"
          meta={
            <>
              <Num>{cards.length}</Num> {cards.length === 1 ? "card" : "cards"},{" "}
              {cards.length === 1 ? "built" : "oldest built"}{" "}
              <Num>{shortAge(oldest.updatedAt)}</Num> ago
            </>
          }
        />
      )}
      {brief && (
        <Shelf
          href={`/dashboard/digests/${brief.id}`}
          icon={FileTextIcon}
          label="Weekly brief"
          meta={
            <>
              Week of {formatDate(brief.weekStart, { month: "short", day: "numeric" })}
              {takeaways > 0 && (
                <>
                  {" · "}
                  <Num>{takeaways}</Num> {takeaways === 1 ? "takeaway" : "takeaways"}
                </>
              )}
            </>
          }
        />
      )}
    </div>
  );
}

function Num({ children }: { children: ReactNode }) {
  return <span className="font-mono tabular-nums">{children}</span>;
}

function Shelf({
  href,
  icon: Icon,
  label,
  meta,
}: {
  href: string;
  icon: PhosphorIcon;
  label: string;
  meta: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group/shelf flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-2"
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background-2 text-muted-foreground"
        aria-hidden
      >
        <Icon size={15} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-dense font-semibold">{label}</span>
        <span className="mt-0.5 block truncate text-meta text-text-subtle">{meta}</span>
      </span>
      <ArrowRightIcon
        size={14}
        className="ms-auto shrink-0 text-text-subtle transition-transform group-hover/shelf:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
