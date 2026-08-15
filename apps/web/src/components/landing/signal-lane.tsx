"use client";

import { useEffect, useRef } from "react";

// A week of monitoring replayed as one conveyor: 12 noise chips and the 5
// canonical fictional signals inline (~5:1 here — the real ratio is 12:1,
// compressed so the story fits a loop). Two identical halves and a
// translateX(-50%) keyframe make the loop seamless; the effect measures one
// half and pins the speed at ~55px/s whatever the rendered width. The CSS
// animation-duration (60s) stays as the JS-off fallback.
const NOISE = [
  "pricing page edited",
  "new changelog entry",
  "4 reviews added",
  "blog post published",
  "homepage headline changed",
  "docs updated",
  "job posting closed",
  "status page incident",
  "terms revised",
  "new landing page",
  "webinar announced",
  "footer links changed",
];

type LaneSignal = {
  who: string;
  cat: string;
  catColor: string;
  sev: string;
  what: string;
};

const SIGNALS: LaneSignal[] = [
  { who: "Vantage", cat: "pricing", catColor: "var(--cat-pricing)", sev: "var(--high)", what: "Business plan $16 → $14/seat" },
  { who: "Lumen", cat: "hiring", catColor: "var(--cat-hiring)", sev: "var(--medium)", what: "opens 3 AI Research roles" },
  { who: "Cobalt", cat: "reviews", catColor: "var(--cat-reviews)", sev: "var(--medium)", what: "Trustpilot slips 4.4 → 4.2" },
  { who: "Meridian", cat: "product", catColor: "var(--cat-product)", sev: "var(--critical)", what: "launches usage-based billing" },
  { who: "Beacon", cat: "funding", catColor: "var(--cat-funding)", sev: "var(--high)", what: "raises Series E, $200M" },
];

// Positive = noise index, negative = signal index (offset by one).
const ORDER = [0, 1, -1, 2, 3, 4, -2, 5, 6, -3, 7, 8, -4, 9, 10, 11, -5];

type LaneItem = { noise: string } | LaneSignal;

const STRIP: LaneItem[] = [];
for (const k of ORDER) {
  if (k >= 0) {
    const text = NOISE[k];
    if (text) STRIP.push({ noise: text });
  } else {
    const signal = SIGNALS[-k - 1];
    if (signal) STRIP.push(signal);
  }
}

export function SignalLane() {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const track = trackRef.current;
    const half = track?.firstElementChild;
    if (!track || !half) return;
    function setSpeed() {
      if (!track || !half) return;
      const halfW = half.getBoundingClientRect().width;
      if (halfW > 0) track.style.animationDuration = `${Math.round(halfW / 55)}s`;
    }
    setSpeed();
    // Re-measure once webfonts land — they change the strip's width.
    void document.fonts.ready.then(setSpeed);
  }, []);

  return (
    <div className="lp-lane" aria-hidden>
      <div ref={trackRef} className="lp-lane-track">
        {[0, 1].map((h) => (
          <div key={h} className="lp-lane-half">
            {STRIP.map((item, i) =>
              "noise" in item ? (
                <span key={i} className="lp-chip">
                  {item.noise}
                </span>
              ) : (
                <span key={i} className="lp-chip signal">
                  <span className="sev" style={{ background: item.sev }} />
                  <span className="who">{item.who}</span>
                  <span className="cat" style={{ color: item.catColor }}>
                    {item.cat}
                  </span>
                  <span className="what">{item.what}</span>
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
