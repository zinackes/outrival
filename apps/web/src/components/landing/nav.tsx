import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Nav() {
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <a href="#" className="logo">
          Out<span className="accent">rival</span>
        </a>
        <div className="nav-links">
          <a href="#sources">Sources</a>
          <a href="#pipeline">Pipeline</a>
          <a href="#signals">Signals</a>
          <a href="#compare">Compare</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="hide-mobile">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <a href="#cta">Start free</a>
          </Button>
        </div>
      </div>
    </nav>
  );
}
