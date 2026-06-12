import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low";

const SEV_CLASS: Record<Severity, string> = {
  critical:
    "bg-critical/15 text-critical border-critical/30 hover:bg-critical/15",
  high:
    "bg-high/15 text-high border-high/30 hover:bg-high/15",
  medium:
    "bg-medium/15 text-medium border-medium/30 hover:bg-medium/15",
  low: "bg-muted-foreground/10 text-muted-foreground border-border hover:bg-muted-foreground/10",
};

export function SeverityPill({
  severity,
  children,
}: {
  severity: Severity;
  children?: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("text-meta uppercase tracking-wider font-medium", SEV_CLASS[severity])}>
      {children ?? severity}
    </Badge>
  );
}

const SEV_DOT: Record<Severity, string> = {
  critical: "bg-critical",
  high: "bg-high",
  medium: "bg-medium",
  low: "bg-muted-foreground/45",
};

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        "w-2 h-2 rounded-full inline-block shrink-0",
        SEV_DOT[severity],
      )}
      aria-hidden
    />
  );
}

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
