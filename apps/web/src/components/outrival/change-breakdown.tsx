"use client";

import { useState } from "react";
import { CaretRightIcon, ArrowElbowDownRightIcon } from "@/components/icons";
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
      {changes.map((ch, i) => (
        <li key={i}>
          <ChangeItem change={ch} />
        </li>
      ))}
    </ul>
  );
}

/** One typed change: what it is, how material it is, and what it went from and to. */
function ChangeItem({ change: ch }: { change: SignalChange }) {
  const nature = natureOf(ch);
  const variation =
    ch.kind === "numeric_claim_changed" ? variationLabel(ch.metadata) : null;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-foreground">
          {KIND_LABELS[ch.kind] ?? ch.kind}
        </span>
        {variation && (
          <span className="text-meta text-foreground tabular-nums">{variation}</span>
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
              <ArrowElbowDownRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
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
    </div>
  );
}

/* The fold groups by FAMILY, not by raw kind: five "Section content" rows beside
   one "New section" row is a list again, not a summary. */
function familyOf(kind: string): string {
  if (kind.startsWith("hero_")) return "Hero";
  if (kind.startsWith("section_")) return "Sections";
  if (kind === "navigation_changed") return "Navigation";
  if (kind === "meta_changed") return "Page metadata";
  if (
    kind === "social_proof_changed" ||
    kind.startsWith("customer_logo") ||
    kind.startsWith("testimonial")
  )
    return "Social proof";
  if (kind === "numeric_claim_changed") return "Business claims";
  if (kind === "visual_redesign") return "Visual";
  return "Other";
}

/**
 * The change set as a summary that holds its size, for the "Why this insight?"
 * panel.
 *
 * A homepage rewrite can produce forty typed changes, and forty of them in a
 * scroll is a wall nobody reads. The classifier already scores each change
 * major / minor / trivial, so the material ones are known: every major is listed
 * in full (there are rarely more than four, and they are the evidence for the
 * insight), and the rest folds to one row per family with a count. Nothing is
 * hidden, it is one click away and the count says how much is behind it.
 *
 * With no major at all the three most substantial changes lead instead, so the
 * summary never opens empty.
 */
export function GroupedChanges({ changes }: { changes: SignalChange[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const majors = changes.filter((c) => c.significance === "major");
  const rest = changes.filter((c) => c.significance !== "major");
  const lead = majors.length > 0 ? majors : rest.slice(0, 3);
  const folded = majors.length > 0 ? rest : rest.slice(3);

  const groups = new Map<string, SignalChange[]>();
  for (const ch of folded) {
    const family = familyOf(ch.kind);
    const bucket = groups.get(family);
    if (bucket) bucket.push(ch);
    else groups.set(family, [ch]);
  }
  // Biggest family first: it's the one carrying the noise the reader is deciding
  // whether to open.
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  function toggle(family: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }

  return (
    <div className="space-y-3.5">
      {lead.map((ch, i) => (
        <ChangeItem key={`lead-${i}`} change={ch} />
      ))}

      {ordered.length > 0 && (
        <div className={cn(lead.length > 0 && "border-t border-border pt-3")}>
          <p className="text-xs text-muted-foreground">Also changed</p>
          <div className="mt-1">
            {ordered.map(([family, items]) => {
              const open = expanded.has(family);
              const panelId = `changes-${family.replace(/\s+/g, "-").toLowerCase()}`;
              return (
                <div key={family}>
                  <button
                    type="button"
                    onClick={() => toggle(family)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className="flex w-full items-center gap-2 rounded-md py-1.5 pr-1.5 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <CaretRightIcon
                      className={cn(
                        "size-3 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-90",
                      )}
                      aria-hidden
                    />
                    {family}
                    <span className="ml-auto text-meta tabular-nums text-muted-foreground">
                      {items.length}
                    </span>
                  </button>
                  {open && (
                    <div id={panelId} className="space-y-3.5 py-1 pl-5">
                      {items.map((ch, i) => (
                        <ChangeItem key={`${family}-${i}`} change={ch} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
