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
    // The hero this canvas is about to cover: .lp-fog-live freezes and hides
    // the CSS fog banks under it, which are occluded from the moment the
    // effect paints (see the .lp-fog-live rule in globals.css).
    const hero = el.closest<HTMLElement>(".lp-hero, .lp-page-hero");
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
        // Vanta renders at devicePixelRatio / scale, and both scales default
        // to 1: on a retina screen that is 4x the pixels of a full-viewport
        // fragment shader, for fog whose whole subject is blur. The divisors
        // below cap the render at 1.5x (1.25x on mobile, weaker GPU) and the
        // max(1, …) keeps a DPR-1 screen at native rather than under it.
        scale: Math.max(1, devicePixelRatio / 1.5),
        scaleMobile: Math.max(1, devicePixelRatio / 1.25),
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
      hero?.classList.add("lp-fog-live");
    })();
    return () => {
      cancelled = true;
      hero?.classList.remove("lp-fog-live");
      effect?.destroy();
      effect = null;
    };
  }, []);

  return <div ref={ref} className="lp-vanta" aria-hidden />;
}
