import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Nav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <a href="#" className="text-lg font-semibold tracking-tight">
          Out<span className="text-primary">rival</span>
        </a>
        <div className="hidden items-center gap-7 text-sm text-text-muted md:flex">
          <a href="#sources" className="transition-colors hover:text-foreground">
            Sources
          </a>
          <a
            href="#pipeline"
            className="transition-colors hover:text-foreground"
          >
            Pipeline
          </a>
          <a href="#signals" className="transition-colors hover:text-foreground">
            Signals
          </a>
          <a href="#compare" className="transition-colors hover:text-foreground">
            Compare
          </a>
          <a href="#pricing" className="transition-colors hover:text-foreground">
            Pricing
          </a>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="max-sm:hidden">
            <Link href="/auth">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <a href="#cta">Start free</a>
          </Button>
        </div>
      </div>
    </nav>
  );
}
