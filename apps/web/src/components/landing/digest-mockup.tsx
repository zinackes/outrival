"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Signal = {
  sev: "critical" | "high" | "medium" | "low";
  cat: string;
  text: ReactNode;
  time: string;
};

const SIGNALS: Signal[] = [
  {
    sev: "critical",
    cat: "pricing",
    text: (
      <span>
        <b>Linear</b> drops Business from <b>$16 → $14/seat</b>. Old plan
        removed from the pricing page.
      </span>
    ),
    time: "2h ago",
  },
  {
    sev: "high",
    cat: "hiring",
    text: (
      <span>
        <b>Notion</b> opens 3 &quot;AI Research&quot; roles in Paris. First R&amp;D
        presence in the EU.
      </span>
    ),
    time: "6h ago",
  },
  {
    sev: "high",
    cat: "product",
    text: (
      <span>
        <b>Linear</b> ships &quot;Cycles 2.0&quot; — planning overhaul plus
        native GitHub integration.
      </span>
    ),
    time: "9h ago",
  },
  {
    sev: "medium",
    cat: "reviews",
    text: (
      <span>
        <b>Asana</b> drops 4.4 → 4.2 on G2 (38 new reviews, sentiment ≤ 0).
      </span>
    ),
    time: "yesterday",
  },
  {
    sev: "medium",
    cat: "content",
    text: (
      <span>
        <b>Notion</b> publishes &quot;The end of all-in-one&quot; — vertical
        repositioning.
      </span>
    ),
    time: "yesterday",
  },
  {
    sev: "low",
    cat: "funding",
    text: (
      <span>
        <b>Coda</b> announces Series E $200M, valuation $1.6B.
      </span>
    ),
    time: "2d",
  },
];

export function DigestMockup({ animate = true }: { animate?: boolean }) {
  const [visible, setVisible] = useState(SIGNALS.length);

  useEffect(() => {
    if (!animate) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;
    setVisible(0);
  }, [animate]);

  useEffect(() => {
    if (!animate || visible >= SIGNALS.length) return;
    const t = setTimeout(
      () => setVisible((n) => n + 1),
      visible === 0 ? 300 : 240,
    );
    return () => clearTimeout(t);
  }, [visible, animate]);

  return (
    <div
      className="digest-shell"
      role="img"
      aria-label="Outrival weekly digest"
    >
      <div className="digest-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="logo" style={{ fontSize: 15 }}>
            Out<span className="accent">rival</span>
          </span>
          <span
            style={{
              color: "var(--muted-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            / weekly digest
          </span>
        </div>
        <div className="digest-tabs">
          <span className="digest-tab active">This week</span>
          <span className="digest-tab">Previous</span>
        </div>
      </div>
      <div className="digest-meta-row">
        <div>
          <div className="digest-meta-title">Week 21 — 12 signals</div>
          <div className="digest-meta-date">
            May 19 → 25, 2026 · 4 competitors
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="#">See all</a>
        </Button>
      </div>
      <div className="digest-stats">
        <div className="stat">
          <div className="stat-label">Signals</div>
          <div className="stat-value">
            12<span className="stat-delta">+4</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Critical</div>
          <div className="stat-value">2</div>
        </div>
        <div className="stat">
          <div className="stat-label">Changes</div>
          <div className="stat-value">847</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sources</div>
          <div className="stat-value">36</div>
        </div>
      </div>
      <div
        className="signal-list scroll-mini"
        style={{ maxHeight: 290, overflowY: "auto" }}
      >
        {SIGNALS.slice(0, visible).map((s, i) => (
          <div key={i} className="signal">
            <span className={`signal-sev ${s.sev}`}></span>
            <span className="signal-cat">{s.cat}</span>
            <span className="signal-text">{s.text}</span>
            <span className="signal-time">{s.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
