"use client";

import { useEffect, useRef, useState } from "react";
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

// Same five slots as the landing, resolved absolutely: off the home page a
// bare "#product" scrolls nowhere, and Pricing now has a page of its own
// rather than an anchor.
const MARKETING_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#signals", label: "Signals" },
  { href: "/vs/crayon", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
] as const;

// Vertical centre of the floating pill, in px: .lp-nav.is-stuck sits at
// top: 0.85rem and is 3.5rem tall, so 13.6 + 28. Keep the two in step.
const PILL_CENTER = 42;

// tone="app" (default) is the fixed, blurred, theme-aware bar used on /sample
// and the doc pages. tone="landing" sits in flow inside the hero — transparent
// so the fog shows through, ink logo (the hero is pinned light), no theme
// toggle (the landing's rhythm is fixed, not a preference). As soon as it
// scrolls out of view the landing bar comes back as a floating pill
// (.lp-nav.is-stuck); the <nav> keeps its own height so nothing moves.
// tone="marketing" is that same bar on the pages around the landing
// (/pricing, /vs/*, /alternatives/*): identical behaviour, links resolved
// absolutely because there is no hero underneath them to anchor into.
export function Nav({ tone = "app" }: { tone?: "app" | "landing" | "marketing" }) {
  // Both landing tones share every visual and every observer; only the link
  // set differs, so the flag below stays a two-state thing.
  const landing = tone !== "app";
  const links =
    tone === "landing"
      ? LANDING_LINKS
      : tone === "marketing"
        ? MARKETING_LINKS
        : APP_LINKS;
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [onDark, setOnDark] = useState(false);
  const ref = useRef<HTMLElement>(null);
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

  // The pill takes over the moment the bar itself leaves the viewport, so the
  // page is never navless. The observed element is the <nav> placeholder, which
  // stays in flow and keeps its box in both states — the pill can't chase its
  // own trigger. An observer rather than a scroll listener: no work on frames
  // where nothing crosses.
  useEffect(() => {
    if (!landing) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!!entry && !entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [landing]);

  // The pill is fixed and the page is not one colour: paper hero, dark body,
  // paper again, dark footer. A paper pill over the dark body reads as a hole
  // and a dark one over paper reads as a bar, so the pill takes the tone of
  // whatever is under it. What it observes is the regions marked
  // data-lp-tone="dark" (see app/page.tsx), through a root shrunk to a 1px band
  // at the pill's own centre: the tone flips exactly when the boundary passes
  // behind the pill, not when the section enters the viewport.
  useEffect(() => {
    if (!landing || !stuck) return;
    const regions = document.querySelectorAll<HTMLElement>('[data-lp-tone="dark"]');
    if (regions.length === 0) return;
    const hits = new Set<Element>();
    let io: IntersectionObserver | undefined;
    // The band is viewport-relative, so it has to be rebuilt on resize —
    // rootMargin is fixed at construction time.
    function watch() {
      io?.disconnect();
      hits.clear();
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) hits.add(entry.target);
            else hits.delete(entry.target);
          }
          setOnDark(hits.size > 0);
        },
        {
          rootMargin: `-${PILL_CENTER}px 0px -${Math.max(0, window.innerHeight - PILL_CENTER - 1)}px 0px`,
        },
      );
      for (const region of regions) io.observe(region);
    }
    watch();
    window.addEventListener("resize", watch);
    return () => {
      io?.disconnect();
      window.removeEventListener("resize", watch);
    };
  }, [landing, stuck]);

  return (
    <nav
      ref={ref}
      className={
        landing
          ? "relative z-10 h-16"
          : "fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-sm"
      }
    >
      <div
        className={
          landing
            ? `lp-nav${stuck ? " is-stuck" : ""}${stuck && onDark ? " is-dark" : ""}`
            : "mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6"
        }
      >
        <a
          href="/"
          className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <LogoMark size={26} ink={landing && stuck && onDark ? "light" : landing} />
          {/* On the landing the wordmark is one ink text node: split across two
              spans it became two items of this gap-2 flex row, which opened a
              hole inside the word. */}
          {landing ? (
            <span>Outrival</span>
          ) : (
            <span>
              Out<span className="text-link">rival</span>
            </span>
          )}
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
          {/* Anchored to the bar it belongs to: under the <nav> in flow, and
              under the pill once the pill has left the flow. */}
          <div
            id="mobile-nav"
            className={`absolute inset-x-0 z-50 border-b border-border bg-background px-6 py-4 md:hidden ${
              landing ? (stuck ? "lp-mnav-float" : "top-full") : "top-16"
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
