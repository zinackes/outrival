"use client";

import { useEffect, useRef } from "react";
import type { VantaEffect } from "vanta/dist/vanta.fog.min";

// Which family of page this fog opens. The palette never changes — the same
// three brand hues (soft red, teal, iris) in every tone — only which of them
// leads. Anything stronger and /pricing stops looking like the same site as
// /, which is the whole reason these pages share a hero at all.
export type FogTone = "default" | "pricing" | "compare" | "editorial";

// Vanta's three colour slots, from brightest wisp to deepest pocket. Every
// variant keeps three distinct hues: the default's warm highlight, cool
// midtone and saturated lowlight average out to a neutral pastel, and taking
// any one hue OUT collapses that average onto the two that remain. Two cuts
// proved it — re-ranking all three turned /pricing into a saturated violet
// that ate the lead paragraph's contrast, and swapping the single midtone
// turned /vs/* entirely pink. So a variant SHIFTS one slot along the hue
// circle instead of replacing it, and the balance survives.
const FOG_TONES: Record<
  FogTone,
  { highlight: number; midtone: number; lowlight: number }
> = {
  default: { highlight: 0xffc2cb, midtone: 0x63c6ad, lowlight: 0x6c5dfd },
  // teal midtone carried toward iris: cooler fold, pink still counterweights
  pricing: { highlight: 0xffc2cb, midtone: 0x7bbcd8, lowlight: 0x6c5dfd },
  // iris pockets turn to brand red: warm depth on the pages about a rival
  compare: { highlight: 0xffc2cb, midtone: 0x63c6ad, lowlight: 0xff5c72 },
  // the one variant that moves all three, in lightness only: "quieter" is not
  // a hue change, and an article should not be fronted by a wall of colour
  editorial: { highlight: 0xf7ece2, midtone: 0xb8dcd1, lowlight: 0xa89dff },
};

// The hero's real fog — Vanta FOG on a single three.js WebGL instance for the
// whole hero. The canvas mounts at z -2 with an opaque paper base color, so it
// simply covers the CSS fog fallback (z -3) once loaded; under
// prefers-reduced-motion it never mounts and the frozen CSS fog stays. Both
// libraries load lazily on the client so they stay out of the entry chunks.
export function VantaFog({ tone = "default" }: { tone?: FogTone }) {
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
        // iris — the landing's three signal hues), re-ranked per page family
        // by FOG_TONES above. The CSS banks read the same ranking from the
        // --fog-a/b/c vars, so the fallback and the canvas never disagree.
        baseColor: 0xfaf8f3,
        highlightColor: FOG_TONES[tone].highlight,
        midtoneColor: FOG_TONES[tone].midtone,
        lowlightColor: FOG_TONES[tone].lowlight,
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
  }, [tone]);

  return <div ref={ref} className="lp-vanta" aria-hidden />;
}
