"use client";

import { useEffect, useRef } from "react";
import type { VantaEffect } from "vanta/dist/vanta.fog.min";

// The hero's real fog — Vanta FOG on a single three.js WebGL instance for the
// whole hero. The canvas mounts at z -2 with an opaque paper base color, so it
// simply covers the CSS fog fallback (z -3) once loaded; under
// prefers-reduced-motion it never mounts and the frozen CSS fog stays. Both
// libraries load lazily on the client so they stay out of the entry chunks.
export function VantaFog() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    let effect: VantaEffect | null = null;
    let cancelled = false;
    void (async () => {
      const [THREE, { default: FOG }] = await Promise.all([
        import("three"),
        import("vanta/dist/vanta.fog.min"),
      ]);
      if (cancelled) return;
      effect = FOG({
        el,
        THREE,
        mouseControls: false,
        touchControls: false,
        gyroControls: false,
        minHeight: 200,
        minWidth: 200,
        // 24-bit ints. Paper base keeps the canvas opaque over the fallback;
        // highlight/midtone/lowlight echo the CSS fog banks (soft red, teal,
        // iris — the landing's three signal hues).
        baseColor: 0xfaf8f3,
        highlightColor: 0xffc2cb,
        midtoneColor: 0x63c6ad,
        lowlightColor: 0x6c5dfd,
        blurFactor: 0.55,
        speed: 1.1,
        zoom: 0.7,
      });
    })();
    return () => {
      cancelled = true;
      effect?.destroy();
      effect = null;
    };
  }, []);

  return <div ref={ref} className="lp-vanta" aria-hidden />;
}
