"use client";

import { useEffect } from "react";
import { Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageHead } from "./page-head";
import {
  WHATS_NEW,
  LATEST_WHATS_NEW_DATE,
  WHATS_NEW_SEEN_KEY,
  type WhatsNewKind,
} from "@/lib/whats-new";
import { formatDate as formatDateIntl } from "@/lib/format-date";

function formatDate(iso: string): string {
  return formatDateIntl(iso, { month: "long", day: "numeric", year: "numeric" });
}

const KIND_LABEL: Record<WhatsNewKind, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

// Reuses the semantic palette: positive (added), brand accent (improved),
// medium severity amber (fixed). No hardcoded colors.
const KIND_CLASS: Record<WhatsNewKind, string> = {
  new: "bg-positive/12 text-positive border-positive/30",
  improved: "bg-primary/12 text-primary border-primary/30",
  fixed: "bg-medium/12 text-medium border-medium/30",
};

function KindLabel({ kind }: { kind: WhatsNewKind }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "min-w-[68px] text-meta font-medium tracking-wider uppercase",
        KIND_CLASS[kind],
      )}
    >
      {KIND_LABEL[kind]}
    </Badge>
  );
}

export function WhatsNewView() {
  // Visiting the page clears the unseen dot (covers direct navigation).
  useEffect(() => {
    try {
      localStorage.setItem(WHATS_NEW_SEEN_KEY, LATEST_WHATS_NEW_DATE);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <PageHead
        flush
        icon={<Megaphone size={18} className="text-muted-foreground" aria-hidden />}
        title="What's new"
        sub="Product updates and improvements, newest first."
      />

      <div className="relative flex flex-col">
        {/* Timeline rail behind the release nodes. */}
        <span
          className="bg-border absolute top-2 bottom-2 left-[3.5px] w-px"
          aria-hidden
        />
        {WHATS_NEW.map((release) => (
          <article key={release.date} className="relative pb-10 pl-7 last:pb-0">
            <span
              className="bg-primary ring-background absolute top-[5px] left-0 h-2 w-2 rounded-full ring-4"
              aria-hidden
            />
            <time className="text-muted-foreground font-mono text-meta tracking-wide">
              {formatDate(release.date)}
            </time>
            <h2 className="mt-1 text-lead font-semibold tracking-tight">
              {release.title}
            </h2>
            <ul className="mt-3 space-y-2.5">
              {release.changes.map((c, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-content leading-relaxed"
                >
                  <KindLabel kind={c.kind} />
                  <span className="text-foreground/90">{c.text}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
