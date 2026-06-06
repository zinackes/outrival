import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type IconType = React.ComponentType<{ size?: number; className?: string }>;

// Outer frame shared by every competitor tab: a single card whose blocks are
// separated by dividers, so each tab opens identically (a framed card with a
// section heading) and never nests cards within cards.
export function TabCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col divide-y divide-border overflow-hidden", className)}>
      {children}
    </Card>
  );
}

// One block inside a TabCard. An optional heading + icon gives the section a
// readable title; blocks are padded uniformly and separated by the card's
// dividers. Replaces the old per-block cards.
export function TabSection({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title?: string;
  icon?: IconType;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 p-5", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && (
            <h3 className="flex items-center gap-2 text-content font-semibold tracking-tight leading-tight">
              {Icon && <Icon size={14} className="text-muted-foreground shrink-0" />}
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
