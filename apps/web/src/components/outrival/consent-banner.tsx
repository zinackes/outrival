"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import {
  getConsent,
  setConsent,
  COOKIE_PREFS_EVENT,
} from "@/lib/consent";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

// CNIL-compliant consent banner. First level offers Accept / Reject / Customize
// with equal prominence (choice symmetry); "Customize" reveals the categories.
// Outrival's only non-essential purpose today is product analytics (PostHog),
// so there are two categories: strictly necessary (always on) and analytics.
// UI copy is English (product language); the legal detail lives in /cookies.
export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    if (getConsent() === "unset") setOpen(true);
    // Allow re-opening from the footer "Cookie preferences" link at any time.
    const reopen = () => {
      setAnalytics(getConsent() === "granted");
      setCustomize(true);
      setOpen(true);
    };
    window.addEventListener(COOKIE_PREFS_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_PREFS_EVENT, reopen);
  }, []);

  if (!open) return null;

  const apply = (granted: boolean) => {
    setConsent(granted ? "granted" : "denied");
    if (granted) posthog.opt_in_capturing();
    else posthog.opt_out_capturing();
    setOpen(false);
    setCustomize(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="dark fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-md border border-[var(--border-strong)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)] shadow-lg sm:inset-x-auto sm:right-4 sm:left-auto"
    >
      <p>
        We use strictly necessary cookies to run Outrival and, with your consent,
        analytics cookies to improve it. You can accept, reject, or choose. See
        our{" "}
        <Link
          href="/cookies"
          className="underline underline-offset-2 hover:text-[var(--accent)]"
        >
          Cookie Policy
        </Link>
        .
      </p>

      {customize && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-md border border-[var(--border-strong)] p-3">
          <div className="flex items-start gap-2.5">
            <Checkbox checked disabled aria-label="Strictly necessary" className="mt-0.5" />
            <div>
              <div className="font-medium">Strictly necessary</div>
              <p className="text-xs text-[var(--foreground)]/70">
                Sign-in, security and preferences. Always active, required for
                the service to work.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox
              checked={analytics}
              onCheckedChange={(v) => setAnalytics(v === true)}
              aria-label="Analytics"
              className="mt-0.5"
            />
            <div>
              <div className="font-medium">Analytics</div>
              <p className="text-xs text-[var(--foreground)]/70">
                Pseudonymised product usage (PostHog, EU) to understand what to
                improve. Off by default.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {customize ? (
          <Button size="sm" onClick={() => apply(analytics)}>
            Save choices
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => apply(false)}>
              Reject all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCustomize(true)}>
              Customize
            </Button>
            <Button size="sm" onClick={() => apply(true)}>
              Accept all
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
