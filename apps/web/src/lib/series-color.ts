import { SERIES_TOKENS, competitorStroke } from "@/lib/competitor-color";

/**
 * How one competitor's series is drawn, everywhere on a page.
 *
 * The palette used to be dealt per chart, by a competitor's index in that chart's
 * own array. The three market arrays each drop the competitors their metric never
 * captured, so the same competitor landed on a different slot — and a different
 * colour — on the pricing, hiring and reviews charts. A colour that changes between
 * two charts on one screen is not an identity, so the page deals it once and hands
 * the same map to every chart.
 *
 * Lives outside the chart module on purpose: the chart lazy-loads recharts, and a
 * static import of anything inside it would pull recharts back into the route's
 * first-load bundle.
 */
export interface SeriesPaint {
  /** SVG-safe colour: an OKLCH expression whose lightness the theme still sets. */
  stroke: string;
  /** `stroke-dasharray`, set only past the first lap of the palette. */
  dash?: string;
}

// One mark per lap of the palette. Eleven hues cover most rosters, but the business
// plan tracks an unlimited number and two lines in the identical hue are not two
// lines. The dash is a second channel that survives greyscale and colour blindness,
// which a hue on its own does not.
const LAP_DASH: ReadonlyArray<string | undefined> = [undefined, "5 3", "1 4"];

/** Your own product is the reference every other line is read against, never a hue. */
const SELF_STROKE = "var(--foreground)";

/** A competitor the palette never saw — the two trends routes carry different sets. */
const UNKNOWN_STROKE = "var(--muted-foreground)";

/**
 * Deal one paint per competitor over the WHOLE roster, so a chart drawing a subset
 * still draws each competitor in its page colour. Call it ONCE per page and hand the
 * map to every chart: dealing per chart is what made one competitor three colours.
 *
 * Dealt in id order, not in the order the roster was assembled. The three market
 * arrays each omit the competitors their own metric never captured, so they arrive
 * in different orders; sorting first means the deal cannot depend on which array
 * happened to be read into the roster first.
 *
 * What that does NOT buy is a colour fixed for all time: the hues are handed out by
 * position, so adding a competitor shifts everyone sorted after it. That is the
 * right trade — the alternative is hashing the id, which holds still across roster
 * changes but collides at three competitors instead of at eleven, and two lines in
 * one hue is the exact complaint this function exists to answer. A roster changes
 * when a competitor is added or a scope is switched; a collision is on screen now.
 *
 * Not `assignSeriesColors` (competitor-color.ts), which the compare page uses: that
 * one returns tokens, and two competitors a lap apart share a token — the caller
 * cannot tell them apart, which is exactly what the dash is for here. It also leaves
 * your own product on its stored colour, where a chart wants it on the neutral
 * reference stroke.
 */
export function buildSeriesPalette(
  roster: ReadonlyArray<{ competitorId: string; color: string | null; isSelf: boolean }>,
): Map<string, SeriesPaint> {
  const ordered = [...roster].sort((a, b) => a.competitorId.localeCompare(b.competitorId));
  const taken = new Set(ordered.map((r) => r.color).filter((c): c is string => Boolean(c)));

  const out = new Map<string, SeriesPaint>();
  let dealt = 0;
  for (const row of ordered) {
    if (row.isSelf) {
      out.set(row.competitorId, { stroke: SELF_STROKE });
      continue;
    }
    if (row.color) {
      out.set(row.competitorId, { stroke: competitorStroke(row.color) ?? UNKNOWN_STROKE });
      continue;
    }
    // Step over the hues someone already owns, so a borrowed colour never collides
    // with an assigned one. First lap only: past it every hue is spoken for and the
    // skip would never terminate.
    let token = SERIES_TOKENS[dealt % SERIES_TOKENS.length]!;
    while (dealt < SERIES_TOKENS.length && taken.has(token)) {
      dealt++;
      token = SERIES_TOKENS[dealt % SERIES_TOKENS.length]!;
    }
    out.set(row.competitorId, {
      stroke: competitorStroke(token) ?? UNKNOWN_STROKE,
      dash: LAP_DASH[Math.floor(dealt / SERIES_TOKENS.length) % LAP_DASH.length],
    });
    dealt++;
  }
  return out;
}

/**
 * The paint for one competitor, never undefined. `/trends/summary` and
 * `/trends/market` are different queries with different limits, so a competitor can
 * carry a movement row without a plotted series; a row with no colour at all reads as
 * broken, a neutral one reads as "no series".
 */
export function paintFor(
  palette: Map<string, SeriesPaint>,
  competitorId: string,
): SeriesPaint {
  return palette.get(competitorId) ?? { stroke: UNKNOWN_STROKE };
}
