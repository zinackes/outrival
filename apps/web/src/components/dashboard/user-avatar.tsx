"use client";

import Avatar from "boring-avatars";
import { cn } from "@/lib/utils";

// Generated geometric avatar (boring-avatars "marble"), deterministic on a stable
// seed (the user's email) — the Vercel/Linear/GitHub pattern: every account gets a
// unique, consistent identity mark without an uploaded photo, and email sign-ups are
// no longer a blank "?" chip. The palette is a curated indigo→teal set harmonised
// with the Iris accent; SVG fills can't reference CSS vars, so these hexes are an
// intentional, single-source exception to the no-hardcoded-color rule.
const AVATAR_PALETTE = ["#5b4cf0", "#7d6fff", "#5aa9ff", "#37c8d9", "#34d399"];

export function UserAvatar({
  seed,
  size = 28,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-full border border-border",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Avatar name={seed} variant="marble" size={size} colors={AVATAR_PALETTE} />
    </span>
  );
}
