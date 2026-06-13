"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "#sources", label: "Sources" },
  { href: "#pipeline", label: "Pipeline" },
  { href: "#signals", label: "Signals" },
  { href: "#compare", label: "Compare" },
  { href: "#pricing", label: "Pricing" },
] as const;

export function Nav() {
  const [open, setOpen] = useState(false);

  // Close the mobile menu on Escape, and lock body scroll while it's open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <a href="/" className="text-lg font-semibold tracking-tight">
          Out<span className="text-primary">rival</span>
        </a>
        <div className="hidden items-center gap-7 text-sm text-text-muted md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="max-sm:hidden">
            <Link href="/auth">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <a href="#cta">Start free</a>
          </Button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="-mr-1.5 inline-flex size-9 items-center justify-center rounded-md text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile menu: the section links + Sign in, which are otherwise hidden on
          phones. Closes on tap so the in-page anchor scroll lands cleanly. */}
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-16 z-40 cursor-default bg-background/40 md:hidden"
          />
          <div
            id="mobile-nav"
            className="absolute inset-x-0 top-16 z-50 border-b border-border bg-background px-6 py-4 md:hidden"
          >
            <div className="flex flex-col">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md py-2.5 text-sm text-text-muted transition-colors hover:text-foreground"
                >
                  {l.label}
                </a>
              ))}
              <div className="mt-3 border-t border-border pt-3">
                <Button asChild variant="outline" className="w-full">
                  <Link href="/auth" onClick={() => setOpen(false)}>
                    Sign in
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
