"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Check, Circle, X, Rocket } from "lucide-react";
import { type ChecklistStepKey } from "@/lib/api";
import { onboardingChecklistQuery } from "@/lib/queries";

const DISMISS_KEY = "onboardingChecklistDismissed";

const STEP_META: Record<ChecklistStepKey, { label: string; href: string }> = {
  product: { label: "Set up your product profile", href: "/dashboard/products" },
  competitor: { label: "Add your first competitor", href: "/dashboard/competitors" },
  monitoring: { label: "Enable monitoring on a competitor", href: "/dashboard/competitors" },
  notifications: { label: "Choose how you get notified", href: "/dashboard/settings/notifications" },
  signal: { label: "Receive your first signal", href: "/dashboard/signals" },
};

export function OnboardingChecklistCard() {
  const checklistQ = useQuery(onboardingChecklistQuery());
  const data = checklistQ.data ?? null;
  // Assume dismissed until the marker is checked — avoids a flash before the effect.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed || !data || data.complete) return null;

  const doneCount = data.steps.filter((s) => s.done).length;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Rocket size={15} className="text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight">Get set up</h2>
          <span className="text-muted-foreground font-mono text-meta">
            {doneCount}/{data.steps.length}
          </span>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>
      <ul className="mt-3 space-y-1.5">
        {data.steps.map((s) => {
          const meta = STEP_META[s.key];
          return (
            <li key={s.key} className="flex items-center gap-2.5">
              {s.done ? (
                <Check size={14} className="text-primary shrink-0" aria-hidden />
              ) : (
                <Circle size={14} className="text-muted-foreground/40 shrink-0" aria-hidden />
              )}
              {s.done ? (
                <span className="text-muted-foreground text-dense line-through">{meta.label}</span>
              ) : (
                <Link href={meta.href} className="text-dense hover:underline">
                  {meta.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
