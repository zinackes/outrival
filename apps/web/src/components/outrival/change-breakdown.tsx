"use client";

import { CornerDownRight } from "lucide-react";
import type { SignalChange } from "@/lib/api";
import { cn } from "@/lib/utils";

// Readable label per structured change kind (patch-16). Falls back to the raw
// kind if a new kind ships before this map is updated.
export const KIND_LABELS: Record<string, string> = {
  hero_headline_changed: "Hero headline",
  hero_subheadline_changed: "Hero subheadline",
  hero_cta_changed: "Hero CTA",
  section_added: "New section",
  section_removed: "Removed section",
  section_renamed: "Renamed section",
  section_body_changed: "Section content",
  section_reordered: "Reordered sections",
  navigation_changed: "Navigation",
  meta_changed: "Page metadata",
  social_proof_changed: "Social proof",
  // patch-17 enrichments
  visual_redesign: "Visual redesign",
  numeric_claim_changed: "Business claim",
  customer_logo_added: "New customer logo",
  customer_logo_removed: "Removed customer logo",
  testimonial_added: "New testimonial",
  testimonial_removed: "Removed testimonial",
};

// patch-17: a signed percentage badge for a numeric-claim change ("+233%").
export function variationLabel(metadata: Record<string, unknown> | null): string | null {
  const v = metadata?.variation;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const pct = Math.round(v * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

// A change is an addition when only the new value exists, a removal when only the
// old one does, otherwise a replacement. Drives an explicit "Added/Removed" tag so
// the breakdown never falls back to a bare "∅", which read as noise to users.
type Nature = "added" | "removed" | "changed";
function natureOf(ch: SignalChange): Nature {
  if (ch.after && !ch.before) return "added";
  if (ch.before && !ch.after) return "removed";
  return "changed";
}

/**
 * Shared per-change breakdown for structured homepage signals (patch-16).
 * Rendered both inline in the Signals detail pane (signal-evidence) and in the
 * "Why this insight?" modal (why-insight-panel) — edit here only to keep them in
 * sync. Replaces the prior `before ∅ → after ∅` line, whose empty-set glyph and
 * easily-missed arrow made added/removed copy unreadable.
 */
export function ChangeBreakdown({ changes }: { changes: SignalChange[] }) {
  return (
    <ul className="space-y-3.5">
      {changes.map((ch, i) => {
        const nature = natureOf(ch);
        const variation =
          ch.kind === "numeric_claim_changed" ? variationLabel(ch.metadata) : null;

        return (
          <li key={i} className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-foreground">
                {KIND_LABELS[ch.kind] ?? ch.kind}
              </span>
              {variation && (
                <span className="font-mono text-meta text-foreground">{variation}</span>
              )}
              {ch.significance && (
                <span
                  className={cn(
                    "ml-auto text-meta capitalize",
                    ch.significance === "major"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {ch.significance}
                </span>
              )}
            </div>

            {nature === "changed" && (ch.before || ch.after) && (
              <div className="space-y-0.5 text-sm">
                {ch.before && <p className="text-muted-foreground">{ch.before}</p>}
                {ch.after && (
                  <p className="flex gap-1.5 text-foreground">
                    <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>{ch.after}</span>
                  </p>
                )}
              </div>
            )}

            {nature === "added" && ch.after && (
              <p className="text-sm text-foreground">
                <span className="mr-1.5 text-meta text-muted-foreground">Added</span>
                {ch.after}
              </p>
            )}

            {nature === "removed" && ch.before && (
              <p className="text-sm">
                <span className="mr-1.5 text-meta text-muted-foreground">Removed</span>
                <span className="text-muted-foreground line-through">{ch.before}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
