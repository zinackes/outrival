import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CatPill } from "./cat-pill";
import type { DigestContent, DigestSection as DigestSectionData } from "@/lib/api";

function urgencyMeta(urgency: string) {
  if (urgency === "action_required") {
    return { title: "Action required", color: "var(--critical)" };
  }
  if (urgency === "watch") {
    return { title: "Watch", color: "var(--accent)" };
  }
  return { title: "FYI", color: "var(--muted)" };
}

// Presentational render of a digest body — the TL;DR card plus the urgency-grouped
// sections. Extracted from DigestReader so the in-app reader
// (/dashboard/digests/[id]) and the public sample page (/sample) render a digest
// identically from the same DigestContent. Pure: no hooks, no fetching, so it
// works in a server component too.
export function DigestView({ content }: { content: DigestContent }) {
  const sections = content.sections ?? [];
  const tldr = content.tldr ?? [];
  const crit = sections.filter((s) => s.urgency === "action_required");
  const watch = sections.filter((s) => s.urgency === "watch");
  const fyi = sections.filter((s) => s.urgency === "fyi");

  return (
    <div className="space-y-6">
      {tldr.length > 0 && (
        <Card className="px-5 py-5">
          <div className="text-xs font-semibold text-primary mb-3">TL;DR</div>
          <ul className="m-0 pl-5 text-content leading-relaxed">
            {tldr.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Card>
      )}

      {[crit, watch, fyi].map((items, idx) => {
        if (items.length === 0) return null;
        return (
          <DigestSection
            key={idx}
            meta={urgencyMeta(items[0]!.urgency)}
            items={items}
          />
        );
      })}
    </div>
  );
}

function DigestSection({
  meta,
  items,
}: {
  meta: { title: string; color: string };
  items: DigestSectionData[];
}) {
  return (
    <Card>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-sm"
            style={{ background: meta.color }}
            aria-hidden
          />
          <div className="font-semibold text-sm tracking-tight">{meta.title}</div>
        </div>
        <span className="text-muted-foreground tabular-nums font-mono text-xs">
          {items.length} signals
        </span>
      </div>
      <div>
        {items.map((s, i) => (
          <div key={i} className="p-5 border-b border-border last:border-b-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <CatPill>{s.category}</CatPill>
              <span className="font-semibold text-sm">{s.competitor}</span>
            </div>
            <p className="m-0 mb-1.5 text-content leading-snug font-medium">
              {s.insight}
            </p>
            {s.so_what && (
              <p className="m-0 flex gap-1 text-muted-foreground text-sm leading-snug">
                <ArrowRight className="size-3.5 mt-0.5 shrink-0" />
                {s.so_what}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
