"use client";

import { useEffect, useState } from "react";

// TEMPORARY (OUT-227) — hero color switcher. What is actually undecided is the
// CTA button and the supporting copy, so each preset moves the accent button
// (background, hover, label), the h1, the sub, the lane legend and the sample
// link. Applied as CSS vars on <html> so the fold re-colors live. Pick one,
// inline it in the .lp- rules and delete this component.
type Palette = {
  id: string;
  label: string;
  vars: Record<string, string>;
};

const PALETTES: Palette[] = [
  {
    id: "ink",
    label: "Ink button",
    vars: {
      "--lp-btn-bg": "oklch(0.22 0.01 260)",
      "--lp-btn-bg-hover": "oklch(0.3 0.01 260)",
      "--lp-btn-fg": "#faf8f3",
      "--lp-h1-color": "oklch(0.2 0.01 260)",
      "--lp-sub-color": "oklch(0.38 0.014 260)",
      "--lp-legend-color": "oklch(0.42 0.014 260)",
      "--lp-link-color": "oklch(0.22 0.01 260)",
    },
  },
  {
    id: "deep-cyan",
    label: "Deep cyan",
    vars: {
      "--lp-btn-bg": "oklch(0.44 0.12 205)",
      "--lp-btn-bg-hover": "oklch(0.38 0.12 205)",
      "--lp-btn-fg": "#ffffff",
      "--lp-h1-color": "oklch(0.21 0.012 240)",
      "--lp-sub-color": "oklch(0.39 0.02 240)",
      "--lp-legend-color": "oklch(0.43 0.02 240)",
      "--lp-link-color": "oklch(0.42 0.12 205)",
    },
  },
  {
    id: "iris",
    label: "Iris",
    vars: {
      "--lp-btn-bg": "#4b3ce0",
      "--lp-btn-bg-hover": "#3d2fd0",
      "--lp-btn-fg": "#ffffff",
      "--lp-h1-color": "oklch(0.23 0.02 275)",
      "--lp-sub-color": "oklch(0.41 0.03 275)",
      "--lp-legend-color": "oklch(0.45 0.025 275)",
      "--lp-link-color": "#4b3ce0",
    },
  },
  {
    id: "bordeaux",
    label: "Bordeaux",
    vars: {
      "--lp-btn-bg": "#8f2f10",
      "--lp-btn-bg-hover": "#7a2609",
      "--lp-btn-fg": "#fff6ef",
      "--lp-h1-color": "oklch(0.22 0.02 45)",
      "--lp-sub-color": "oklch(0.4 0.025 45)",
      "--lp-legend-color": "oklch(0.44 0.02 45)",
      "--lp-link-color": "#8f2f10",
    },
  },
  {
    id: "shipped",
    label: "Shipped cyan",
    vars: {
      "--lp-btn-bg": "oklch(0.53 0.14 200)",
      "--lp-btn-bg-hover": "oklch(0.49 0.15 200)",
      "--lp-btn-fg": "#ffffff",
      "--lp-h1-color": "oklch(0.22 0.01 260)",
      "--lp-sub-color": "oklch(0.4 0.015 260)",
      "--lp-legend-color": "oklch(0.5 0.014 260)",
      "--lp-link-color": "oklch(0.22 0.01 260)",
    },
  },
];

const KEY = "lp-hero-palette";

function apply(id: string) {
  const p = PALETTES.find((x) => x.id === id) ?? PALETTES[0];
  if (!p) return;
  for (const [k, v] of Object.entries(p.vars)) {
    document.documentElement.style.setProperty(k, v);
  }
}

export function HeroPalette() {
  const [id, setId] = useState("ink");

  useEffect(() => {
    const saved = localStorage.getItem(KEY) ?? "ink";
    setId(saved);
    apply(saved);
  }, []);

  function onPick(next: string) {
    setId(next);
    localStorage.setItem(KEY, next);
    apply(next);
  }

  return (
    <div className="lp-palette">
      <label htmlFor="lp-palette-select">Palette</label>
      <select
        id="lp-palette-select"
        value={id}
        onChange={(e) => onPick(e.target.value)}
      >
        {PALETTES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
