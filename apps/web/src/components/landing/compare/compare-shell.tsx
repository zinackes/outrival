import type { ReactNode } from "react";
import Link from "next/link";
import { CaretRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Footer } from "../footer";
import { BreadcrumbJsonLd, SoftwareAppJsonLd } from "./structured-data";

// Brand shell for the comparison / alternatives pages. Same register as the
// landing (.landing-canvas → Zodiak headings, deep dark canvas) but a static,
// wide header (logo + Start free) instead of the anchored client Nav, whose
// in-page section links don't resolve off the home page.
export function CompareShell({ children }: { children: ReactNode }) {
  return (
    <div className="landing-canvas min-h-dvh bg-background font-sans text-foreground antialiased">
      <SoftwareAppJsonLd />
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Out<span className="text-primary">rival</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/pricing"
              className="mr-2 hidden text-sm text-text-muted transition-colors hover:text-foreground sm:inline"
            >
              Pricing
            </Link>
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

// Visual breadcrumb + its BreadcrumbList JSON-LD in one place, so the two never
// drift. The last item is the current page (not a link).
export function Breadcrumbs({
  items,
}: {
  items: { name: string; path: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-dense">
      <BreadcrumbJsonLd items={items} />
      <ol className="flex flex-wrap items-center gap-1.5 text-text-subtle">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={it.path} className="flex items-center gap-1.5">
              {last ? (
                <span className="text-text-muted" aria-current="page">
                  {it.name}
                </span>
              ) : (
                <Link
                  href={it.path}
                  className="transition-colors hover:text-foreground"
                >
                  {it.name}
                </Link>
              )}
              {!last && (
                <CaretRightIcon
                  size={16}
                  className="text-text-subtle/60"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
