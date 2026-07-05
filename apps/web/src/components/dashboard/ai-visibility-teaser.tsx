"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, ArrowRight } from "lucide-react";
import { aiVisibilityTeaserQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";

// AI Visibility onboarding teaser (Lever 7) — a free one-time "share of model" taste
// on the day-0 landscape: does the user's product show up in AI answer engines, and
// how often vs its top competitor? Renders when the worker's result lands; hides
// entirely when there's nothing to show (no engine key / empty roster / no answers).
export function AiVisibilityTeaser() {
  const { data, isLoading } = useQuery(aiVisibilityTeaserQuery());

  // Bounded patience: if the worker never writes a terminal row (a hard-kill leaves it
  // unwritten), the endpoint returns "pending" forever — stop showing the placeholder
  // past this window so the card can never spin indefinitely on the Overview.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 60_000);
    return () => clearTimeout(t);
  }, []);

  // Still computing (or first load): a quiet placeholder, never a hard blocker.
  if (!gaveUp && (isLoading || data?.status === "pending")) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Sparkles className="size-4 shrink-0 animate-pulse text-muted-foreground" />
        Checking how AI answer engines describe your market…
      </div>
    );
  }
  // Nothing to show (or we gave up waiting) → occupy no space.
  if (!data || data.status !== "ready") return null;

  const { self, topRival, leader, ratio, selfMentioned, promptsRun, engine } = data;
  const engineLabel = engine === "gemini" ? "Google’s AI answers" : "AI answer engines";

  // Headline framing by outcome (strongest hook first).
  let headline: string;
  let tone: "warn" | "good" | "neutral";
  if (leader === "rival" && !selfMentioned && topRival) {
    headline = `${engineLabel} recommend ${topRival.name} — ${self.name} isn’t showing up yet.`;
    tone = "warn";
  } else if (leader === "rival" && topRival && ratio) {
    headline = `${topRival.name} shows up ${ratio}× more often than ${self.name} in ${engineLabel}.`;
    tone = "warn";
  } else if (leader === "self") {
    headline = `${self.name} leads your market in ${engineLabel}.`;
    tone = "good";
  } else {
    headline = `No one owns ${engineLabel} in your space yet — an opening for ${self.name}.`;
    tone = "neutral";
  }

  const accent =
    tone === "warn" ? "text-high" : tone === "good" ? "text-positive" : "text-foreground";

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="size-4 text-link" />
        <span className="text-sm font-medium">Your AI visibility</span>
        <span className="ml-auto text-meta text-muted-foreground">
          Sampled from {promptsRun} buyer question{promptsRun === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-3 px-4 py-4">
        <p className={`text-lead font-medium ${accent}`}>{headline}</p>
        <p className="text-sm text-muted-foreground">
          We asked {engineLabel} the questions your buyers ask before choosing a tool, and
          counted who gets named. This is a one-time snapshot — the tracked version watches
          it across every engine, week over week.
        </p>
        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link href="/dashboard/ai-visibility">
            Track my AI visibility
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
