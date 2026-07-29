import { describe, expect, it } from "bun:test";
import { isExpandControlLabel } from "./expand-controls";

describe("isExpandControlLabel", () => {
  it("matches the labels real job boards ship", () => {
    // Workable's board — the case that shipped 10 of 56 openings to the Hiring tab.
    expect(isExpandControlLabel("Show more")).toBe(true);
    expect(isExpandControlLabel("Load more")).toBe(true);
    expect(isExpandControlLabel("Show more jobs")).toBe(true);
    expect(isExpandControlLabel("View all openings")).toBe(true);
    expect(isExpandControlLabel("Show 20 more")).toBe(true);
    expect(isExpandControlLabel("More")).toBe(true);
  });

  it("matches non-English labels", () => {
    expect(isExpandControlLabel("Voir plus")).toBe(true);
    expect(isExpandControlLabel("Afficher tout")).toBe(true);
    expect(isExpandControlLabel("Charger davantage")).toBe(true);
    expect(isExpandControlLabel("Mehr anzeigen")).toBe(true);
    expect(isExpandControlLabel("Ver más")).toBe(true);
    expect(isExpandControlLabel("Carica altri")).toBe(true);
  });

  it("normalises the whitespace of a wrapped button label", () => {
    expect(isExpandControlLabel("  Show\n  more  ")).toBe(true);
  });

  it("ignores numbered pagination — it replaces rows instead of appending them", () => {
    expect(isExpandControlLabel("Next")).toBe(false);
    expect(isExpandControlLabel("Next page")).toBe(false);
    expect(isExpandControlLabel("2")).toBe(false);
    expect(isExpandControlLabel("›")).toBe(false);
  });

  it("ignores controls that would collapse or navigate away", () => {
    expect(isExpandControlLabel("Show less")).toBe(false);
    expect(isExpandControlLabel("Voir moins")).toBe(false);
    expect(isExpandControlLabel("Apply now")).toBe(false);
    expect(isExpandControlLabel("Learn more about our culture")).toBe(false);
  });

  it("only matches at the start, so prose can never trip it", () => {
    expect(isExpandControlLabel("Read this to show more of what we do")).toBe(false);
    expect(isExpandControlLabel("")).toBe(false);
    expect(
      isExpandControlLabel("Show more than forty characters of marketing copy here"),
    ).toBe(false);
  });
});
