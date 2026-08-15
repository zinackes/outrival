import type { ReactNode } from "react";

// One mark per bento card, sat above its title. They are not icons and not
// mockups: each is the card's idea reduced to geometry — a diff is two rows,
// a board is three rules ranked by length, a quarter is a grid of days. The
// fragment inside the card shows the real object; the sigil says what kind of
// object it is before you have read a word.
//
// Drawn here rather than pulled from @/components/icons because these are
// illustration, not UI: 40px, 1.5px stroke, one weight, no fills.
//
// Colour stays honest: `.hit` is the one stroke that carries meaning, and it
// only turns red where red is a fact (the anchor's critical diff). Everywhere
// else it is the same white, one notch brighter — emphasis by luminance, which
// is the rule the rest of the section follows.

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      className="pb-sigil"
      viewBox="0 0 40 40"
      width="40"
      height="40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

// A diff: the gutter bar, the line that was, the line that is.
export function SigilSignal() {
  return (
    <Frame>
      <path className="hit" d="M7 11v18" />
      <path d="M14 16h12" opacity="0.55" strokeDasharray="2.5 3" />
      <path className="hit" d="M14 25h19" />
    </Frame>
  );
}

// A board: who moved, ranked. The mark leads each row, the rule is the move.
export function SigilOverview() {
  return (
    <Frame>
      <circle className="hit" cx="8" cy="13" r="1.9" />
      <path d="M15 13h18" />
      <circle cx="8" cy="20" r="1.9" opacity="0.55" />
      <path d="M15 20h12" opacity="0.55" />
      <circle cx="8" cy="27" r="1.9" opacity="0.55" />
      <path d="M15 27h7" opacity="0.55" />
    </Frame>
  );
}

// A prompt bar with the caret still in it, and the answer starting underneath.
export function SigilAsk() {
  return (
    <Frame>
      <rect x="6" y="9" width="28" height="12" rx="3.5" opacity="0.55" />
      <path d="M11 15h9" opacity="0.55" />
      <path className="hit" d="M24 12.5v5" />
      <path d="M6 27h24" opacity="0.55" />
      <path d="M6 32h15" opacity="0.55" />
    </Frame>
  );
}

// Two sheets, the top one rewritten: the card is a document that keeps moving.
export function SigilBattle() {
  return (
    <Frame>
      {/* The sheet underneath is drawn as the bracket you can actually see:
          a full rect would cross the top one and read as a grid. */}
      <path d="M17 34H8a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3h5" opacity="0.4" />
      <rect x="13" y="6" width="22" height="22" rx="3" />
      <path className="hit" d="M18 14h12" />
      <path d="M18 20h8" opacity="0.55" />
    </Frame>
  );
}

// A podium read left to right, with your own bar the one that is called out.
export function SigilAiv() {
  return (
    <Frame>
      <path d="M8 31v-5" />
      {/* The pin is what makes this a rank rather than a chart: one bar is
          yours, and it is not the tallest. */}
      <circle className="hit" cx="17" cy="17" r="1.7" />
      <path className="hit" d="M17 31v-9" />
      <path d="M26 31v-13" opacity="0.55" />
      <path d="M35 31v-18" opacity="0.55" />
      <path d="M5 34h30" opacity="0.4" />
    </Frame>
  );
}

// A quarter, cropped: weeks across, weekdays down, one day that mattered.
const CELLS = Array.from({ length: 30 }, (_, i) => ({
  x: 7 + (i % 6) * 5.2,
  y: 10 + Math.floor(i / 6) * 5.2,
  hit: i === 16,
}));

export function SigilRecap() {
  return (
    <Frame>
      {CELLS.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          className={cell.hit ? "hit" : undefined}
          x={cell.x}
          y={cell.y}
          width="2.9"
          height="2.9"
          rx="0.7"
          fill="currentColor"
          stroke="none"
          opacity={cell.hit ? 1 : 0.4}
        />
      ))}
    </Frame>
  );
}
