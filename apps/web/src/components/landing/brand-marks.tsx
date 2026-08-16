import type { ReactNode } from "react";

// The four companies the bento tracks need a face. In the app that face is
// `CompAvatar`: a plate, a hairline, and the real favicon trimmed and recentred
// on it. The plate is there to normalise a *fetched* image — unknown ground,
// unknown padding — and none of that applies to a glyph we draw ourselves, so
// the landing keeps the sizes and drops the container.
//
// Three rules, each one taken from what the reference sites actually do:
//
//  - BARE at row scale. Vanta's vendor table, Trigger's cell titles, Supabase's
//    Vector card and Warp's model picker all set the mark at 18-20px with no
//    chip, no tile, no rounding — the brand simply occupies the icon slot. Tiles
//    only appear at 44px and up, where a logo grid is the content itself.
//  - SOLID, not line art. The sigils in the card titles are strokes; these are
//    fills. Different register, so a mark never reads as an illustration and an
//    illustration never reads as a brand.
//  - MONOCHROME, because the section is dark. Resend flattens every logo to one
//    white at one cap height, Statsig greys the rivals and keeps only its own
//    mark sharp; full-colour marks fight each other on black. Here it also
//    protects the doctrine: colour is the proof, so it stays on severity.
//
// Drawn on a 24 unit box and checked at 16px: no counter narrower than 2 units,
// nothing that closes up when it is scaled down onto a row.

const GLYPHS: Record<string, ReactNode> = {
  // A vantage point: the peak you watch the field from.
  Vantage: <path d="M12 2.6 22 21h-6.4L12 13.9 8.4 21H2z" />,
  // A meridian: the line drawn down a globe.
  Meridian: (
    <path
      fillRule="evenodd"
      d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 2.7c1.5 2 2.4 4.6 2.4 7.3s-.9 5.3-2.4 7.3c-1.5-2-2.4-4.6-2.4-7.3s.9-5.3 2.4-7.3"
    />
  ),
  // A beacon: the flare, not the lamp. Drawn as a burst rather than a ring so it
  // cannot be mistaken for the target that marks your own row in the ladder —
  // four marks on one card have to be told apart by silhouette alone.
  Beacon: <path d="M12 1.4 14.5 9.5 22.6 12l-8.1 2.5-2.5 8.1-2.5-8.1L1.4 12l8.1-2.5z" />,
  // Not a company: you, on a ladder of them. A pin rather than an initial, so
  // the row that matters is the one mark that is a target instead of a logo.
  You: (
    <>
      <circle cx="12" cy="12" r="4.6" />
      <path
        fillRule="evenodd"
        d="M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2m0 2.4a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4"
        opacity="0.4"
      />
    </>
  ),
  // Cobalt: the mineral, cut.
  Cobalt: (
    <path
      fillRule="evenodd"
      d="M12 1.7 21.5 7v10L12 22.3 2.5 17V7zm0 4.1L6.1 9.2v5.6l5.9 3.4 5.9-3.4V9.2z"
    />
  ),
};

// `size` follows the product's own scale: 15 inside a sentence, 18 on a dense
// row, 20 when the mark leads a card. Colour comes from the context — the board
// tints it by severity, the ladder ghosts the rivals — so the glyph is drawn in
// `currentColor` and never picks its own.
export function BrandMark({ name, size = 18 }: { name: string; size?: number }) {
  const glyph = GLYPHS[name];
  return (
    <span className="pb-mark" style={{ width: size, height: size }}>
      {glyph ? (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          {glyph}
        </svg>
      ) : (
        // Same fallback the product ships: the initial, never an empty tile.
        // `CompAvatar` sets it at 0.46 of the box because it has a plate to sit
        // on; bare, next to glyphs that fill their box edge to edge, that ratio
        // reads as a speck — so the letter takes 0.78 instead.
        <i style={{ fontSize: Math.round(size * 0.78) }}>{name.slice(0, 1)}</i>
      )}
    </span>
  );
}
