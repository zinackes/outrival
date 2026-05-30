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
  low: "bg-white/5 text-muted-foreground border-border hover:bg-white/5",
};

export function SeverityPill({
  severity,
  children,
}: {
  severity: Severity;
  children?: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider font-medium", SEV_CLASS[severity])}>
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
        "w-[7px] h-[7px] rounded-full inline-block shrink-0",
        SEV_DOT[severity],
      )}
      aria-hidden
    />
  );
}
