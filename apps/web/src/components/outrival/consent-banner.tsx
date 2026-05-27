"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { getConsent, setConsent } from "@/lib/consent";
import { Button } from "@/components/ui/button";

export function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (getConsent() === "unset") setOpen(true);
  }, []);

  if (!open) return null;

  const accept = () => {
    setConsent("granted");
    posthog.opt_in_capturing();
    setOpen(false);
  };

  const refuse = () => {
    setConsent("denied");
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Consentement analytics"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-md border border-[var(--border-strong)] bg-[var(--surface)] p-4 text-sm shadow-lg sm:inset-x-auto sm:right-4 sm:left-auto"
    >
      <p className="text-[var(--foreground)]">
        Nous utilisons des analytics pour améliorer Outrival. Vous pouvez
        accepter ou refuser. Détails dans notre{" "}
        <Link
          href="/privacy"
          className="underline underline-offset-2 hover:text-[var(--accent)]"
        >
          politique de confidentialité
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={refuse}>
          Refuser
        </Button>
        <Button size="sm" onClick={accept}>
          Accepter
        </Button>
      </div>
    </div>
  );
}
