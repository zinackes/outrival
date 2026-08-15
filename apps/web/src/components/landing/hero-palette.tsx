"use client";

import { useEffect, useState } from "react";

// TEMPORARY (OUT-227) — hero text color switcher. Five candidate palettes for
// the h1 / cycling verb / "Monday" / sub, applied as CSS vars on <html> so the
// hero re-colors live. Pick one, then hardcode it in .lp-h1 & friends and
// delete this component along with the vars' fallback chain.
type Palette = {
  id: string;
  label: string;
  /** h1, cycling verb, "Monday" italic, caret, sub */
  vars: Record<string, string>;
};

const PALETTES: Palette[] = [
  {
    id: "ink",
    label: "Ink (current)",
    vars: {
      "--lp-h1-color": "oklch(0.22 0.01 260)",
      "--lp-cycle-color": "oklch(0.22 0.01 260)",
      "--lp-monday-color": "oklch(0.22 0.01 260)",
      "--lp-caret-color": "oklch(0.53 0.14 200)",
      "--lp-sub-color": "oklch(0.4 0.015 260)",
    },
  },
  {
    id: "contrast",
    label: "High contrast",
    vars: {
      "--lp-h1-color": "oklch(0.14 0.008 260)",
      "--lp-cycle-color": "oklch(0.14 0.008 260)",
      "--lp-monday-color": "oklch(0.47 0.15 200)",
      "--lp-caret-color": "oklch(0.47 0.15 200)",
      "--lp-sub-color": "oklch(0.36 0.014 260)",
    },
  },
  {
    id: "iris",
    label: "Iris accent",
    vars: {
      "--lp-h1-color": "oklch(0.24 0.02 275)",
      "--lp-cycle-color": "#5a49f0",
      "--lp-monday-color": "#5a49f0",
      "--lp-caret-color": "#5a49f0",
      "--lp-sub-color": "oklch(0.44 0.03 275)",
    },
  },
  {
    id: "warm",
    label: "Warm bordeaux",
    vars: {
      "--lp-h1-color": "oklch(0.23 0.02 45)",
      "--lp-cycle-color": "#a8380f",
      "--lp-monday-color": "#6d270c",
      "--lp-caret-color": "#a8380f",
      "--lp-sub-color": "oklch(0.43 0.025 50)",
    },
  },
  {
    id: "cool",
    label: "Cool slate",
    vars: {
      "--lp-h1-color": "oklch(0.26 0.035 250)",
      "--lp-cycle-color": "oklch(0.5 0.13 200)",
      "--lp-monday-color": "oklch(0.36 0.06 250)",
      "--lp-caret-color": "oklch(0.53 0.14 200)",
      "--lp-sub-color": "oklch(0.46 0.03 250)",
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
      <label htmlFor="lp-palette-select">Hero palette</label>
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
