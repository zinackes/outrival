import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "ok" | "warn" | "error" | "neutral";

const STATUS_CLASS: Record<Status, string> = {
  ok: "bg-positive/15 text-positive border-positive/30 hover:bg-positive/15",
  warn: "bg-medium/15 text-medium border-medium/30 hover:bg-medium/15",
  error: "bg-critical/15 text-critical border-critical/30 hover:bg-critical/15",
  neutral: "bg-muted-foreground/10 text-muted-foreground border-border hover:bg-muted-foreground/10",
};

export function StatusPill({
  status = "neutral",
  children,
}: {
  status?: Status;
  children: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("text-meta uppercase tracking-wider font-medium", STATUS_CLASS[status])}>
      {children}
    </Badge>
  );
}
