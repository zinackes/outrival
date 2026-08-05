import { test, expect, describe } from "bun:test";
import { SERIES_TOKENS } from "../src/lib/competitor-color";
import { buildSeriesPalette, paintFor } from "../src/lib/series-color";

function entry(competitorId: string, color: string | null = null, isSelf = false) {
  return { competitorId, color, isSelf };
}

/** `{stroke, dash}` flattened, so "two series look the same" is one comparison. */
const markOf = (paint: { stroke: string; dash?: string }) =>
  `${paint.stroke}|${paint.dash ?? "solid"}`;

describe("buildSeriesPalette", () => {
  // The bug the whole change exists for: the old fallback cycled six colours by
  // array index, so the seventh competitor was drawn in the first one's hue and two
  // lines on the same plot were literally the same line twice.
  test("no two competitors share a mark, past the palette's hue count", () => {
    const roster = Array.from({ length: SERIES_TOKENS.length + 3 }, (_, i) =>
      entry(`c${String(i).padStart(2, "0")}`),
    );
    const palette = buildSeriesPalette(roster);

    const marks = roster.map((r) => markOf(paintFor(palette, r.competitorId)));
    expect(new Set(marks).size).toBe(roster.length);
  });

  test("past the hues, the dash is what tells the lap apart", () => {
    const roster = Array.from({ length: SERIES_TOKENS.length + 1 }, (_, i) =>
      entry(`c${String(i).padStart(2, "0")}`),
    );
    const palette = buildSeriesPalette(roster);
    const first = paintFor(palette, "c00");
    const lapped = paintFor(palette, `c${String(SERIES_TOKENS.length).padStart(2, "0")}`);

    // The hue is genuinely reused — there are only so many — so the second channel
    // has to be the one carrying the difference.
    expect(lapped.stroke).toBe(first.stroke);
    expect(first.dash).toBeUndefined();
    expect(lapped.dash).toBeDefined();
  });

  // The second bug: the palette was dealt per chart, by position in that chart's own
  // array. /market drops the competitors a metric never captured, so the pricing,
  // hiring and reviews arrays hold the same competitors in different positions — and
  // one competitor came out a different colour on each of the three plots on screen.
  // The page now deals once over the union, and the deal ignores arrival order.
  test("the deal does not depend on the order the roster was assembled in", () => {
    const ids = ["alpha", "bravo", "charlie", "delta", "echo"];
    const asPricing = buildSeriesPalette(ids.map((id) => entry(id)));
    const asHiring = buildSeriesPalette([...ids].reverse().map((id) => entry(id)));
    const asReviews = buildSeriesPalette(
      [ids[2]!, ids[0]!, ids[4]!, ids[1]!, ids[3]!].map((id) => entry(id)),
    );

    for (const id of ids) {
      const mark = markOf(paintFor(asPricing, id));
      expect(markOf(paintFor(asHiring, id))).toBe(mark);
      expect(markOf(paintFor(asReviews, id))).toBe(mark);
    }
  });

  test("a borrowed hue never lands on one somebody was assigned", () => {
    const assigned = SERIES_TOKENS[3]!;
    const palette = buildSeriesPalette([
      entry("picked", assigned),
      ...Array.from({ length: 4 }, (_, i) => entry(`plain${i}`)),
    ]);

    const pickedMark = markOf(paintFor(palette, "picked"));
    for (let i = 0; i < 4; i++) {
      expect(markOf(paintFor(palette, `plain${i}`))).not.toBe(pickedMark);
    }
  });

  test("your own product takes the reference stroke and spends no hue", () => {
    const roster = [
      entry("mine", null, true),
      ...Array.from({ length: SERIES_TOKENS.length }, (_, i) =>
        entry(`c${String(i).padStart(2, "0")}`),
      ),
    ];
    const palette = buildSeriesPalette(roster);

    expect(paintFor(palette, "mine").stroke).toBe("var(--foreground)");
    // Every competitor still fits inside the first lap: self did not eat one.
    const competitors = roster.filter((r) => !r.isSelf);
    for (const { competitorId } of competitors) {
      expect(paintFor(palette, competitorId).dash).toBeUndefined();
    }
    expect(new Set(competitors.map((r) => markOf(paintFor(palette, r.competitorId)))).size).toBe(
      SERIES_TOKENS.length,
    );
  });

  test("a competitor the palette never saw still gets a colour", () => {
    const palette = buildSeriesPalette([entry("known")]);
    // /trends/summary and /trends/market are different queries: a movement row can
    // exist with no plotted series, and an undefined stroke reads as broken.
    expect(paintFor(palette, "stranger").stroke).toBe("var(--muted-foreground)");
  });
});
