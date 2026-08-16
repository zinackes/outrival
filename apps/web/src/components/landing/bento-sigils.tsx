import type { ReactNode } from "react";

// One mark per bento card, set inside its title rather than above it. They are
// not icons and not mockups: each is the card's idea reduced to geometry — a
// diff is two rows, a board is three rules ranked by length, a quarter is a
// grid of days. The fragment below shows the real object; the mark says what
// kind of object it is before you have read the line.
//
// Drawn here rather than pulled from @/components/icons because these are
// illustration, not UI. They render at ~28px, which is what sets the budget:
// four or five strokes each, 2 units wide in a 40 unit box, nothing that turns
// to mush when it is scaled down against a line of text.
//
// Colour stays honest: `.hit` is the one stroke that carries meaning, and it
// only turns red where red is a fact (the anchor's critical diff). Everywhere
// else it is the same white, one notch brighter.

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      className="pb-sigil"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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
      <path d="M14 16h12" opacity="0.5" strokeDasharray="3 3.5" />
      <path className="hit" d="M14 25h19" />
    </Frame>
  );
}

// A board: who moved, ranked. The mark leads each row, the rule is the move.
export function SigilOverview() {
  return (
    <Frame>
      <circle className="hit" cx="8" cy="12" r="2.1" />
      <path d="M16 12h17" />
      <circle cx="8" cy="20" r="2.1" opacity="0.5" />
      <path d="M16 20h11" opacity="0.5" />
      <circle cx="8" cy="28" r="2.1" opacity="0.5" />
      <path d="M16 28h6" opacity="0.5" />
    </Frame>
  );
}

// A prompt bar with the caret still in it.
export function SigilAsk() {
  return (
    <Frame>
      <rect x="5" y="11" width="30" height="18" rx="4.5" opacity="0.5" />
      <path d="M11 20h11" opacity="0.5" />
      <path className="hit" d="M27 16v8" />
    </Frame>
  );
}

// Two sheets, the top one rewritten: the card is a document that keeps moving.
export function SigilBattle() {
  return (
    <Frame>
      {/* The sheet underneath is drawn as the bracket you can actually see:
          a full rect would cross the top one and read as a grid. */}
      <path d="M17 34H9a3 3 0 0 1-3-3V16a3 3 0 0 1 3-3h4" opacity="0.4" />
      <rect x="14" y="6" width="21" height="21" rx="3.5" />
      <path className="hit" d="M19 16h11" />
    </Frame>
  );
}

// A podium read left to right, with your own bar the one that is pinned.
export function SigilAiv() {
  return (
    <Frame>
      <path d="M8 32v-6" opacity="0.5" />
      {/* The pin is what makes this a rank rather than a chart: one bar is
          yours, and it is not the tallest. */}
      <circle className="hit" cx="17" cy="15" r="2.1" />
      <path className="hit" d="M17 32v-11" />
      <path d="M26 32v-15" opacity="0.5" />
      <path d="M35 32v-21" opacity="0.5" />
    </Frame>
  );
}

// A quarter, cropped: weeks across, weekdays down, one day that mattered.
const CELLS = Array.from({ length: 20 }, (_, i) => ({
  x: 8 + (i % 5) * 6.2,
  y: 10 + Math.floor(i / 5) * 6.2,
  hit: i === 12,
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
          width="4"
          height="4"
          rx="1"
          fill="currentColor"
          stroke="none"
          opacity={cell.hit ? 1 : 0.4}
        />
      ))}
    </Frame>
  );
}
