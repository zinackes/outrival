import { Badge } from "@/components/ui/badge";

export function CatPill({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className="text-[10px] uppercase tracking-wider font-medium">
      {children}
    </Badge>
  );
}
