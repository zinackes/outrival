"use client";

import { useEffect, useState } from "react";
import { ProductBento } from "./product-bento";
import { ProductWindow } from "./product-window";

type Layout = "window" | "bento";
const STORE_KEY = "outrival.lp-showcase";

// Dark-body opening: the bento proof ("this is the product") and the stats
// strip. Two layouts are on trial behind a temporary switch — one app window
// (A) against a disciplined bento (B). Both render the same four screens from
// product-replicas.tsx. Once the direction is picked, keep the winner, delete
// the loser and the switch, and this goes back to a Server Component.
export function ProductShowcase() {
  const [layout, setLayout] = useState<Layout>("window");

  // The pick survives a reload, so the two can be compared over several passes
  // instead of from memory.
  useEffect(() => {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === "window" || saved === "bento") setLayout(saved);
  }, []);

  function pick(next: Layout) {
    setLayout(next);
    localStorage.setItem(STORE_KEY, next);
  }

  return (
    <>
      <div className="lp-dark-inner lp-bento-wide" id="product">
        <div className="lp-dark-head">
          <h2>
            This is <span className="lp-serif-accent">the product</span>.
          </h2>
          <p>
            No mockups. Every competitor move lands in one place: scored,
            explained, ready to act on.
          </p>
          {/* TEMP — layout A/B switch, remove with the losing layout. */}
          <div className="lp-ab" role="group" aria-label="Layout under test">
            <button
              type="button"
              aria-pressed={layout === "window"}
              onClick={() => pick("window")}
            >
              A · One window
            </button>
            <button
              type="button"
              aria-pressed={layout === "bento"}
              onClick={() => pick("bento")}
            >
              B · Bento
            </button>
          </div>
        </div>

        {layout === "window" ? <ProductWindow /> : <ProductBento />}
      </div>

      <div className="lp-stats">
        <div className="lp-stats-grid">
          <div className="lp-stat">
            <b>12:1</b>
            <span>changes per signal that needs action</span>
          </div>
          <div className="lp-stat">
            <b>17</b>
            <span>source types</span>
          </div>
          <div className="lp-stat">
            <b>≤5 min</b>
            <span>critical alert latency</span>
          </div>
          <div className="lp-stat">
            <b>EU</b>
            <span>data storage</span>
          </div>
        </div>
        <p className="lp-stats-note">Measured on production, July 2026.</p>
      </div>
    </>
  );
}
