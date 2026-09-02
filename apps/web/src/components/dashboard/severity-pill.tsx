import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low";

// Solid severity badge mirroring the competitor Activity tab badges (filled
// severity color, light ink). Uppercase is allowed here: it's a badge.
const SEV_BADGE: Record<Severity, string> = {
  critical: "bg-critical text-background",
  high: "bg-high text-background",
  medium: "bg-medium text-background",
  low: "bg-low text-background",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge
      className={cn(
        "uppercase tracking-wide text-meta font-bold px-1.5 py-0",
        SEV_BADGE[severity],
      )}
    >
      {severity}
    </Badge>
  );
}
