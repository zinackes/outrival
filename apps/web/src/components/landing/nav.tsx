"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { LogoMark } from "@/components/outrival/logo";
import { useSession } from "@/lib/auth-client";

const APP_LINKS = [
  { href: "#sources", label: "Sources" },
  { href: "#product", label: "Product" },
  { href: "#signals", label: "Signals" },
  { href: "#compare", label: "Compare" },
  { href: "#pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
] as const;

const LANDING_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#signals", label: "Signals" },
  { href: "#compare", label: "Compare" },
  { href: "#pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
] as const;

// tone="app" (default) is the fixed, blurred, theme-aware bar used on /sample
// and the doc pages. tone="landing" sits in flow inside the hero — transparent
// so the fog shows through, ink logo (the hero is pinned light), no theme
// toggle (the landing's rhythm is fixed, not a preference).
export function Nav({ tone = "app" }: { tone?: "app" | "landing" }) {
  const landing = tone === "landing";
  const links = landing ? LANDING_LINKS : APP_LINKS;
  const [open, setOpen] = useState(false);
  const { data: session } = useSession();
  // While the session is still resolving, keep the signed-out CTAs (matches SSR)
  // so the bar doesn't flash; swap to "Go to dashboard" once we know there's a user.
  const isAuthed = !!session?.user;

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
    <nav
      className={
        landing
          ? "relative z-10"
          : "fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-sm"
      }
    >
      <div
        className={`mx-auto flex h-16 w-full items-center justify-between px-6 ${
          landing ? "max-w-[88rem]" : "max-w-6xl"
        }`}
      >
        <a
          href="/"
          className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <LogoMark size={26} ink={landing} />
          {/* On the landing the wordmark stays ink: the primary cyan sits too
              close to the paper background to read at 18px. */}
          Out<span className={landing ? undefined : "text-primary"}>rival</span>
        </a>
        <div className="hidden items-center gap-7 text-sm text-text-muted md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className={`flex items-center ${landing ? "gap-4" : "gap-2"}`}>
          {!landing && <ThemeToggle />}
          {landing ? (
            isAuthed ? (
              <Link href="/dashboard" className="lp-btn-accent">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/auth"
                  className="text-sm font-medium text-text-muted transition-colors hover:text-foreground max-sm:hidden"
                >
                  Sign in
                </Link>
                <Link href="/auth" className="lp-btn-accent">
                  Start free
                </Link>
              </>
            )
          ) : isAuthed ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="outline" size="sm" className="max-sm:hidden">
                <Link href="/auth">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/auth">Start free</Link>
              </Button>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="-mr-1.5 inline-flex size-11 items-center justify-center rounded-md text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          >
            {open ? <XIcon size={20} /> : <ListIcon size={20} />}
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
            className={`fixed inset-0 z-40 cursor-default bg-background/40 md:hidden ${
              landing ? "" : "top-16"
            }`}
          />
          <div
            id="mobile-nav"
            className={`absolute inset-x-0 z-50 border-b border-border bg-background px-6 py-4 md:hidden ${
              landing ? "top-full" : "top-16"
            }`}
          >
            <div className="flex flex-col">
              {links.map((l) => (
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
                {isAuthed ? (
                  <Button asChild className="w-full">
                    <Link href="/dashboard" onClick={() => setOpen(false)}>
                      Go to dashboard
                    </Link>
                  </Button>
                ) : (
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/auth" onClick={() => setOpen(false)}>
                      Sign in
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
