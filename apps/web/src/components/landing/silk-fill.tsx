"use client";

import { useEffect, useRef, useState } from "react";
import Silk from "./silk";

// WebGL budget guard for the Silk fills: up to ~10 of them live on the landing
// (4 bento cards, 5 pipeline steps, the featured plan) next to the hero's
// Vanta instance, so each canvas mounts only near the viewport (±200px) and
// unmounts again when far. Under prefers-reduced-motion the canvas never
// mounts — the host card keeps its CSS tint glow as the still fill.
export function SilkFill({
  color,
  speed = 2.2,
  scale = 1,
  noiseIntensity = 1.5,
  rotation = 0,
}: {
  /** Silk needs a literal hex — pass the precomputed dark mix of the card's
      tint (see the lp- section of globals.css), not a var() reference. */
  color: string;
  speed?: number;
  scale?: number;
  noiseIntensity?: number;
  rotation?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setMounted(entry.isIntersecting);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="lp-silk" aria-hidden>
      {mounted && (
        <Silk
          color={color}
          speed={speed}
          scale={scale}
          noiseIntensity={noiseIntensity}
          rotation={rotation}
        />
      )}
    </div>
  );
}
