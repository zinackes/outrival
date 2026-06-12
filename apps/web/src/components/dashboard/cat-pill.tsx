import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* The six signal categories carry a wayfinding hue (a system separate from
   severity and from brand cyan). Any other value — e.g. a competitor's
   freeform industry category — falls back to the neutral chip. Class strings
   are spelled out in full so Tailwind keeps them in the build. */
const CAT_CLASS: Record<string, string> = {
  pricing: "bg-cat-pricing/12 text-cat-pricing border-cat-pricing/30 hover:bg-cat-pricing/12",
  product: "bg-cat-product/12 text-cat-product border-cat-product/30 hover:bg-cat-product/12",
  hiring: "bg-cat-hiring/12 text-cat-hiring border-cat-hiring/30 hover:bg-cat-hiring/12",
  reviews: "bg-cat-reviews/12 text-cat-reviews border-cat-reviews/30 hover:bg-cat-reviews/12",
  content: "bg-cat-content/12 text-cat-content border-cat-content/30 hover:bg-cat-content/12",
  funding: "bg-cat-funding/12 text-cat-funding border-cat-funding/30 hover:bg-cat-funding/12",
};

export function CatPill({
  children,
  size = "meta",
}: {
  children: React.ReactNode;
  // "compact" trims the box to sit flush beside the solid SeverityBadge (e.g. the
  // overview list); both render at 11px — 10px is below the label floor.
  size?: "meta" | "compact";
}) {
  const key = typeof children === "string" ? children.toLowerCase().trim() : "";
  const cat = CAT_CLASS[key];

  return (
    <Badge
      variant={cat ? "outline" : "secondary"}
      className={cn(
        // compact sits beside the solid SeverityBadge — match its box (px-1.5 py-0)
        // so the two read as one calibre and the same rounded-md radius shows alike.
        size === "compact" ? "text-meta px-1.5 py-0" : "text-meta",
        "uppercase tracking-wide font-medium",
        cat,
      )}
    >
      {children}
    </Badge>
  );
}
