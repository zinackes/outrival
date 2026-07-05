import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Footer } from "@/components/landing/footer";

// Shared shell for /blog and its articles. Same brand register as the comparison
// pages (landing-canvas, Zodiak headings, theme-aware surfaces) with a sticky
// header carrying the wordmark, a Blog breadcrumb, the theme toggle and a single
// conversion CTA. The anchored landing <Nav> is deliberately not reused — its
// in-page #section links don't resolve off the home page.
export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="landing-canvas min-h-dvh bg-background font-sans text-foreground antialiased">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Out<span className="text-primary">rival</span>
            </Link>
            <span className="text-text-subtle" aria-hidden>
              /
            </span>
            <Link
              href="/blog"
              className="text-sm text-text-muted transition-colors hover:text-foreground"
            >
              Blog
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm">
              <Link href="/auth">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {children}
      </main>

      <Footer />
    </div>
  );
}
