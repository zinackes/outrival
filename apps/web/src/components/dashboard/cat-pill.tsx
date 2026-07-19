import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* The twelve signal categories carry a wayfinding hue (a system separate from
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
  api_developer:
    "bg-cat-api-developer/12 text-cat-api-developer border-cat-api-developer/30 hover:bg-cat-api-developer/12",
  ma: "bg-cat-ma/12 text-cat-ma border-cat-ma/30 hover:bg-cat-ma/12",
  security_compliance:
    "bg-cat-security-compliance/12 text-cat-security-compliance border-cat-security-compliance/30 hover:bg-cat-security-compliance/12",
  ads: "bg-cat-ads/12 text-cat-ads border-cat-ads/30 hover:bg-cat-ads/12",
  partnerships:
    "bg-cat-partnerships/12 text-cat-partnerships border-cat-partnerships/30 hover:bg-cat-partnerships/12",
  leadership:
    "bg-cat-leadership/12 text-cat-leadership border-cat-leadership/30 hover:bg-cat-leadership/12",
};

/* Enum values are snake_case; a chip must not read "SECURITY_COMPLIANCE". Only
   the values that don't survive uppercasing are listed — the rest render as-is. */
const CAT_LABEL: Record<string, string> = {
  ma: "M&A",
  security_compliance: "Security",
  api_developer: "Developer",
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
  const label = CAT_LABEL[key] ?? children;

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
      {label}
    </Badge>
  );
}
