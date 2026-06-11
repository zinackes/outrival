import type { ReactNode } from "react";

// Boxless section header (patch-30 overview redesign). Replaces the per-section
// <Card> chrome: a title + mono sub on the left, an optional action on the right,
// bounded by a single hairline rule. Depth comes from the rule + rhythm, not a box.
export function SectionHead({
  title,
  sub,
  icon,
  action,
  // Drop the hairline rule when the section's content is itself a bordered box —
  // otherwise the box's top edge doubles the header rule into a useless separator.
  divider = true,
}: {
  title: string;
  sub?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        divider ? "border-b border-border pb-2.5" : ""
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <span className="text-muted-foreground shrink-0" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-semibold text-lg tracking-tight leading-tight">
            {title}
          </h2>
          {sub && (
            <div className="text-muted-foreground text-dense font-mono mt-0.5 truncate">
              {sub}
            </div>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
