"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";

// Shown when a server layout can't get a definitive session answer from the API
// (a cold Neon / restarting API right after sign-up). Instead of bouncing to
// /auth — which would ping-pong the URL /auth↔/dashboard — the layout holds here
// and reloads the SAME url, so the render self-heals the moment the backend
// answers. A short bounded burst of reloads covers a transient hiccup; if the
// API is genuinely down it stops and hands control back to the user rather than
// reloading forever.
const KEY = "outrival.reconnect";
const MAX_ATTEMPTS = 4;
const RELOAD_DELAY_MS = 1500;
// A gap longer than this since the last reload means a NEW episode, so the count
// restarts — no explicit reset is needed when a reconnect eventually succeeds.
const EPISODE_GAP_MS = 10_000;

export function SessionReconnect() {
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let attempts = 0;
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const prev = JSON.parse(raw) as { attempts: number; lastAt: number };
        if (Date.now() - prev.lastAt < EPISODE_GAP_MS) attempts = prev.attempts;
      }
    } catch {
      // sessionStorage unavailable (privacy mode) → treat as a fresh episode.
    }
    attempts += 1;

    if (attempts > MAX_ATTEMPTS) {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        // ignore — the retry button starts a fresh episode either way.
      }
      setGaveUp(true);
      return;
    }

    try {
      sessionStorage.setItem(KEY, JSON.stringify({ attempts, lastAt: Date.now() }));
    } catch {
      // ignore — worst case the burst isn't capped, still no URL flap.
    }
    const t = setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  if (gaveUp) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t reach the server. It should pass in a moment.
        </p>
        <div className="flex items-center gap-2">
          <Button onClick={() => window.location.reload()}>Try again</Button>
          <Button variant="ghost" asChild>
            <a href="/auth">Sign in</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <CircleNotchIcon className="size-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Reconnecting…</p>
    </div>
  );
}
