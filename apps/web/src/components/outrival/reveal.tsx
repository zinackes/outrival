"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// A gentle fade + rise, reusing the tailwindcss-animate idiom the tabs already
// use for their switch entrance (TAB_PANEL_CLASS) — just softer/slower, tuned for
// content that lands while the user is watching.
const ENTER = "animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out";

// Eases freshly-landed content into place instead of letting it pop — a battle
// card that just generated, an AI summary that just refreshed, extraction data
// arriving after a scrape. Two triggers:
//   • mount        → animates by default (`initial`), for content revealed behind
//     a skeleton/spinner (the placeholder makes the fade read as sequential, not
//     a collision with the page/tab entrance). Pass `initial={false}` for content
//     already on screen at first paint (e.g. an existing summary on page load),
//     so it stays still and only animates when it actually changes.
//   • `token` change → replays the entrance, for content that updates in place
//     without a remount (a summary refreshed to a newer value).
export function Reveal({
  token,
  initial = true,
  className,
  children,
}: {
  token?: string | number | null;
  initial?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [nonce, setNonce] = useState(initial ? 1 : 0);
  const prevToken = useRef(token);
  const mounted = useRef(false);

  useEffect(() => {
    // Skip the mount pass — `initial` already decided the first frame.
    if (!mounted.current) {
      mounted.current = true;
      prevToken.current = token;
      return;
    }
    if (token !== prevToken.current) {
      prevToken.current = token;
      setNonce((n) => n + 1); // bump the key → remount → replay the CSS entrance
    }
  }, [token]);

  return (
    <div key={nonce} className={cn(nonce > 0 && ENTER, className)}>
      {children}
    </div>
  );
}
