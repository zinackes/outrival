import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

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
    <Card className={cn("flex flex-col divide-y divide-border overflow-hidden rounded-lg", className)}>
      {children}
    </Card>
  );
}

// One block inside a TabCard. An optional heading gives the section a readable
// title; blocks are padded uniformly and separated by the card's dividers.
// No icon slot: an icon beside every heading turns a dense analytical page into a
// sticker sheet, and none of them carried meaning the words did not already.
export function TabSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 p-5", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && (
            <h3 className="text-content font-semibold leading-tight tracking-tight">
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
