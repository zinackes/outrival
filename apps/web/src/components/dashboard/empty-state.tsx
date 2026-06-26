import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Shared empty-state panel (Step 0 cold-start system). Left-aligned and dense
 * — the Linear/Sentry register, not the generic centered SaaS blank slate. One
 * surface holds an optional icon chip, a positive title, a contextual line, and
 * an action row. Reused across Overview, Signals, and competitor tabs so every
 * "nothing here yet" reads as one system (NN/g: contextualize · clear action ·
 * never feel like an error).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  tone = "default",
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** `positive` tints the icon chip for inbox-zero / "all caught up" states. */
  tone?: "default" | "positive";
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-card px-6 py-8 ${className}`}
    >
      <div className="flex flex-col gap-4 max-w-prose">
        {Icon && (
          <span
            className={`inline-flex size-9 items-center justify-center rounded-md border ${
              tone === "positive"
                ? "border-positive/25 bg-positive/10 text-positive"
                : "border-border bg-surface-2 text-muted-foreground"
            }`}
            aria-hidden
          >
            <Icon size={17} />
          </span>
        )}
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>
        )}
      </div>
    </section>
  );
}
