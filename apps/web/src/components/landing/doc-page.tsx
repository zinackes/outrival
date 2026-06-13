import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Footer } from "./footer";

// Shared shell for the standalone marketing/legal pages (terms, privacy, dpa,
// status, changelog, docs). Matches the landing's dark brand surface but uses a
// minimal header (logo + back link) instead of the anchored landing nav, whose
// in-page section links don't resolve off the home page.
export function DocPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated?: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dark min-h-screen bg-background font-sans text-foreground antialiased">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Out<span className="text-primary">rival</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} /> Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        {updated && (
          <p className="mt-3 font-mono text-xs text-text-subtle">
            Last updated {updated}
          </p>
        )}
        {intro && (
          <p className="mt-5 text-lg leading-relaxed text-text-muted">{intro}</p>
        )}
        <div className="mt-8 flex flex-col gap-4 leading-relaxed text-text-muted [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground">
          {children}
        </div>
      </main>

      <Footer />
    </div>
  );
}
